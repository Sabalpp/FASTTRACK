import {
  getTransactionalEmailProviderConfiguration,
  getTransactionalSmsProviderConfiguration,
  parseTransactionalEmailAddress,
  sendTransactionalEmail,
  sendTransactionalSms,
  TransactionalProviderError,
  type ProviderEnvironment,
  type ProviderFetch,
  type TransactionalProviderName,
  type TransactionalProviderResult
} from "@/lib/transactional-providers";

if (typeof window !== "undefined" && process.env.NODE_ENV !== "test") {
  throw new Error("Invoice delivery credentials can only be used by server modules.");
}

export const DEFAULT_INVOICE_SMS_LINK_TTL_SECONDS = 7 * 24 * 60 * 60;
const MIN_INVOICE_SMS_LINK_TTL_SECONDS = 5 * 60;
const MAX_INVOICE_SMS_LINK_TTL_SECONDS = 30 * 24 * 60 * 60;

export type InvoiceDeliveryChannel = "email" | "sms";
export type InvoiceDeliveryResult = TransactionalProviderResult;

export type InvoiceDeliveryConfiguration = {
  email: {
    configured: boolean;
    provider: "resend" | "sendgrid" | null;
    missing: string[];
  };
  sms: {
    configured: boolean;
    provider: "twilio" | null;
    credentialMode: "api_key" | "auth_token" | null;
    linkTtlSeconds: number | null;
    missing: string[];
  };
};

export class InvoiceDeliveryError extends Error {
  readonly channel?: InvoiceDeliveryChannel;
  readonly provider?: TransactionalProviderName;
  readonly code: string;
  readonly status?: number;
  readonly retryable: boolean;

  constructor(input: {
    message: string;
    code: string;
    channel?: InvoiceDeliveryChannel;
    provider?: TransactionalProviderName;
    status?: number;
    retryable?: boolean;
  }) {
    super(input.message);
    this.name = "InvoiceDeliveryError";
    this.channel = input.channel;
    this.provider = input.provider;
    this.code = input.code;
    this.status = input.status;
    this.retryable = input.retryable ?? false;
  }
}

export function getInvoiceDeliveryConfiguration(
  env: ProviderEnvironment = process.env
): InvoiceDeliveryConfiguration {
  const emailProvider = getTransactionalEmailProviderConfiguration(env);
  const emailMissing = [
    ...emailProvider.missing,
    !parseTransactionalEmailAddress(invoiceFromEmail(env))
      ? "INVOICE_FROM_EMAIL or TRANSACTIONAL_FROM_EMAIL"
      : undefined
  ].filter((name): name is string => Boolean(name));
  const smsProvider = getTransactionalSmsProviderConfiguration(env);
  const linkTtlSeconds = invoiceSmsLinkTtlSeconds(env);
  const smsMissing = [
    ...smsProvider.missing,
    linkTtlSeconds === null
      ? `INVOICE_SMS_LINK_TTL_SECONDS (integer ${MIN_INVOICE_SMS_LINK_TTL_SECONDS}-${MAX_INVOICE_SMS_LINK_TTL_SECONDS})`
      : undefined
  ].filter((name): name is string => Boolean(name));

  return {
    email: {
      configured: emailProvider.configured && emailMissing.length === 0,
      provider: emailProvider.provider,
      missing: emailMissing
    },
    sms: {
      configured: smsProvider.configured && smsMissing.length === 0,
      provider: smsProvider.provider,
      credentialMode: smsProvider.credentialMode,
      linkTtlSeconds,
      missing: smsMissing
    }
  };
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
    `Questions? Contact ${input.businessName} at ${input.businessPhone} or ${input.businessEmail}.`,
    "This is a transactional billing message, not a promotion."
  ].join("\n");
  const html = `<p>Hello ${escapeHtml(input.customerName)},</p>`
    + `<p>Your signed invoice <strong>${escapeHtml(input.invoiceNumber)}</strong> is attached as a PDF.</p>`
    + `<p><strong>Balance due: ${escapeHtml(input.balanceLabel)}</strong></p>`
    + `<p>Questions? Contact ${escapeHtml(input.businessName)} at ${escapeHtml(input.businessPhone)} or ${escapeHtml(input.businessEmail)}.</p>`
    + "<p>This is a transactional billing message, not a promotion.</p>";
  return { subject, text, html };
}

export function buildInvoiceSmsMessage(input: {
  invoiceNumber: string;
  balanceLabel: string;
  businessName: string;
  businessPhone: string;
  invoiceUrl: string;
}): string {
  return [
    `${cleanInline(input.businessName, 100)}: Signed invoice ${cleanInline(input.invoiceNumber, 80)} link: ${input.invoiceUrl.trim()}`,
    `Balance due: ${cleanInline(input.balanceLabel, 40)}.`,
    `Questions? ${cleanInline(input.businessPhone, 40)}.`,
    "Transactional billing message; not a promotion. Reply STOP to opt out."
  ].join(" ");
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
): Promise<InvoiceDeliveryResult> {
  const env = options.env ?? process.env;
  const configuration = getInvoiceDeliveryConfiguration(env);
  if (!configuration.email.configured) {
    throw deliveryError(
      "Invoice email delivery is not configured.",
      "not_configured",
      "email",
      configuration.email.provider ?? undefined
    );
  }

  try {
    return await sendTransactionalEmail({
      from: invoiceFromEmail(env),
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
      idempotencyKey: input.idempotencyKey,
      attachments: [{
        filename: safePdfFilename(input.filename),
        contentType: "application/pdf",
        bytes: input.pdfBytes
      }]
    }, options);
  } catch (error) {
    if (!(error instanceof TransactionalProviderError)) throw error;
    throw invoiceProviderError("email", error);
  }
}

export async function sendInvoiceSms(
  input: {
    to: string;
    body: string;
  },
  options: {
    env?: ProviderEnvironment;
    fetchImpl?: ProviderFetch;
    timeoutMs?: number;
  } = {}
): Promise<InvoiceDeliveryResult> {
  const env = options.env ?? process.env;
  const configuration = getInvoiceDeliveryConfiguration(env);
  if (!configuration.sms.configured) {
    throw deliveryError("Invoice SMS delivery is not configured.", "not_configured", "sms", "twilio");
  }

  try {
    // Invoice SMS does not attach the appointment-only status callback. Twilio's
    // Messaging Service still owns inbound STOP/START handling at the same
    // verified webhook configured for the account.
    return await sendTransactionalSms(input, options);
  } catch (error) {
    if (!(error instanceof TransactionalProviderError)) throw error;
    throw invoiceProviderError("sms", error);
  }
}

export function invoiceSmsLinkTtlSeconds(
  env: ProviderEnvironment = process.env
): number | null {
  const raw = readEnv(env, "INVOICE_SMS_LINK_TTL_SECONDS");
  if (!raw) return DEFAULT_INVOICE_SMS_LINK_TTL_SECONDS;
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value)
    && value >= MIN_INVOICE_SMS_LINK_TTL_SECONDS
    && value <= MAX_INVOICE_SMS_LINK_TTL_SECONDS
    ? value
    : null;
}

function invoiceProviderError(
  channel: InvoiceDeliveryChannel,
  error: TransactionalProviderError
): InvoiceDeliveryError {
  let message = error.message;
  if (channel === "email") {
    if (error.code === "invalid_recipient") message = "Enter a valid customer email.";
    else if (error.code === "invalid_idempotency_key") message = "The invoice delivery request is invalid.";
    else if (error.code === "invalid_attachment") message = "The invoice PDF is empty or too large to email.";
    else if (error.code === "not_configured") message = "Invoice email delivery is not configured.";
    else if (error.code === "network_error" || error.code === "timeout" || error.code === "unavailable") {
      message = "The email provider could not be reached.";
    } else if (error.status !== undefined) message = "The email provider rejected the invoice.";
    else if (error.code === "invalid_response") message = "The email provider returned an invalid response.";
  } else {
    if (error.code === "invalid_recipient") message = "The customer phone number is invalid.";
    else if (error.code === "not_configured") message = "Invoice SMS delivery is not configured.";
    else if (error.code === "network_error" || error.code === "timeout" || error.code === "unavailable") {
      message = "SMS delivery could not be confirmed. Review before sending another text.";
    } else if (error.status !== undefined) message = "The SMS provider rejected the invoice message.";
    else if (error.code === "invalid_response") message = "The SMS provider returned an invalid response.";
  }
  return deliveryError(message, error.code, channel, error.provider, error.status, error.retryable);
}

function safePdfFilename(value: string): string {
  const stem = value.replace(/\.pdf$/i, "").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "");
  return `${stem || "invoice"}.pdf`;
}

function cleanInline(value: string, maxLength: number): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    "\"": "&quot;"
  })[character] ?? character);
}

function invoiceFromEmail(env: ProviderEnvironment): string {
  return readEnv(env, "INVOICE_FROM_EMAIL") || readEnv(env, "TRANSACTIONAL_FROM_EMAIL");
}

function readEnv(env: ProviderEnvironment, name: string): string {
  return String(env[name] ?? "").trim();
}

function deliveryError(
  message: string,
  code: string,
  channel?: InvoiceDeliveryChannel,
  provider?: TransactionalProviderName,
  status?: number,
  retryable = false
): InvoiceDeliveryError {
  return new InvoiceDeliveryError({ message, code, channel, provider, status, retryable });
}
