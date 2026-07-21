import { normalizeEmailRecipient } from "@/lib/appointment-confirmations";

if (typeof window !== "undefined" && process.env.NODE_ENV !== "test") {
  throw new Error("Invoice delivery credentials can only be used by server modules.");
}

const RESEND_EMAIL_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_PDF_BYTES = 25 * 1024 * 1024;

type ProviderEnvironment = Record<string, string | undefined>;
type ProviderFetch = typeof fetch;

export class InvoiceDeliveryError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly retryable: boolean;

  constructor(input: { message: string; code: string; status?: number; retryable?: boolean }) {
    super(input.message);
    this.name = "InvoiceDeliveryError";
    this.code = input.code;
    this.status = input.status;
    this.retryable = input.retryable ?? false;
  }
}

export function getInvoiceDeliveryConfiguration(env: ProviderEnvironment = process.env) {
  const missing = [
    !readEnv(env, "RESEND_API_KEY") ? "RESEND_API_KEY" : undefined,
    !readEnv(env, "INVOICE_FROM_EMAIL") ? "INVOICE_FROM_EMAIL" : undefined
  ].filter((name): name is string => Boolean(name));
  return { configured: missing.length === 0, missing };
}

export function buildInvoiceEmailMessage(input: {
  customerName: string;
  invoiceNumber: string;
  balanceLabel: string;
  businessName: string;
  businessPhone: string;
  businessEmail: string;
}) {
  const subject = `${input.invoiceNumber} from ${input.businessName}`;
  const text = [
    `Hello ${input.customerName},`,
    "",
    `Your signed invoice ${input.invoiceNumber} is attached as a PDF.`,
    `Balance due: ${input.balanceLabel}`,
    "",
    `Questions? Contact ${input.businessName} at ${input.businessPhone} or ${input.businessEmail}.`
  ].join("\n");
  const html = `<p>Hello ${escapeHtml(input.customerName)},</p>`
    + `<p>Your signed invoice <strong>${escapeHtml(input.invoiceNumber)}</strong> is attached as a PDF.</p>`
    + `<p><strong>Balance due: ${escapeHtml(input.balanceLabel)}</strong></p>`
    + `<p>Questions? Contact ${escapeHtml(input.businessName)} at ${escapeHtml(input.businessPhone)} or ${escapeHtml(input.businessEmail)}.</p>`;
  return { subject, text, html };
}

export async function sendInvoiceEmail(
  input: {
    to: string;
    subject: string;
    text: string;
    html: string;
    idempotencyKey: string;
    filename: string;
    pdfBytes: Uint8Array;
  },
  options: {
    env?: ProviderEnvironment;
    fetchImpl?: ProviderFetch;
    timeoutMs?: number;
  } = {}
) {
  const env = options.env ?? process.env;
  if (!getInvoiceDeliveryConfiguration(env).configured) {
    throw deliveryError("Invoice email delivery is not configured.", "not_configured");
  }

  const to = normalizeEmailRecipient(input.to);
  if (!to) throw deliveryError("Enter a valid customer email.", "invalid_recipient");
  const idempotencyKey = input.idempotencyKey.trim();
  if (!idempotencyKey || idempotencyKey.length > 256) {
    throw deliveryError("The invoice delivery request is invalid.", "invalid_idempotency_key");
  }
  if (input.pdfBytes.byteLength === 0 || input.pdfBytes.byteLength > MAX_PDF_BYTES) {
    throw deliveryError("The invoice PDF is empty or too large to email.", "invalid_attachment");
  }

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await (options.fetchImpl ?? globalThis.fetch)(RESEND_EMAIL_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${readEnv(env, "RESEND_API_KEY")}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey
      },
      body: JSON.stringify({
        from: readEnv(env, "INVOICE_FROM_EMAIL"),
        to: [to],
        subject: input.subject,
        text: input.text,
        html: input.html,
        attachments: [{
          filename: safePdfFilename(input.filename),
          content: Buffer.from(input.pdfBytes).toString("base64"),
          content_type: "application/pdf"
        }]
      }),
      signal: controller.signal
    });
  } catch {
    throw deliveryError("The email provider could not be reached.", "network_error", undefined, true);
  } finally {
    globalThis.clearTimeout(timeoutId);
  }

  const payload = await response.json().catch(() => undefined) as Record<string, unknown> | undefined;
  if (!response.ok) {
    const code = safeCode(payload?.name ?? payload?.code) ?? "provider_rejected";
    const retryable = response.status === 408
      || response.status === 425
      || response.status === 429
      || response.status >= 500
      || (response.status === 409 && code === "concurrent_idempotent_requests");
    throw deliveryError("The email provider rejected the invoice.", code, response.status, retryable);
  }

  const messageId = safeIdentifier(payload?.id);
  if (!messageId) {
    throw deliveryError("The email provider returned an invalid response.", "invalid_response", response.status, true);
  }
  return { provider: "resend" as const, messageId, status: "accepted" as const };
}

function safePdfFilename(value: string) {
  const stem = value.replace(/\.pdf$/i, "").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "");
  return `${stem || "invoice"}.pdf`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    "\"": "&quot;"
  })[character] ?? character);
}

function readEnv(env: ProviderEnvironment, name: string) {
  return String(env[name] ?? "").trim();
}

function safeIdentifier(value: unknown) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized && normalized.length <= 256 && /^[a-zA-Z0-9_.:-]+$/.test(normalized)
    ? normalized
    : undefined;
}

function safeCode(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const normalized = String(value).trim();
  return /^[a-zA-Z0-9_-]{1,80}$/.test(normalized) ? normalized : undefined;
}

function deliveryError(message: string, code: string, status?: number, retryable = false) {
  return new InvoiceDeliveryError({ message, code, status, retryable });
}
