import { createHash } from "node:crypto";
import {
  normalizeEmailRecipient,
  toUsE164Phone
} from "@/lib/appointment-confirmations";

if (typeof window !== "undefined" && process.env.NODE_ENV !== "test") {
  throw new Error("Transactional provider credentials can only be used by server modules.");
}

const RESEND_EMAIL_ENDPOINT = "https://api.resend.com/emails";
const SENDGRID_GLOBAL_EMAIL_ENDPOINT = "https://api.sendgrid.com/v3/mail/send";
const SENDGRID_EU_EMAIL_ENDPOINT = "https://api.eu.sendgrid.com/v3/mail/send";
const TWILIO_API_ORIGIN = "https://api.twilio.com";
const DEFAULT_PROVIDER_TIMEOUT_MS = 15_000;
const MAX_RESEND_ATTACHMENT_BYTES = 25 * 1024 * 1024;
// SendGrid's complete JSON request must remain below 30 MB. Keep raw files at
// 20 MB so Base64 expansion plus message content cannot cross that boundary.
const MAX_SENDGRID_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export type ProviderEnvironment = Record<string, string | undefined>;
export type ProviderFetch = typeof fetch;
export type TransactionalDeliveryChannel = "email" | "sms";
export type TransactionalEmailProviderName = "resend" | "sendgrid";
export type TransactionalProviderName = TransactionalEmailProviderName | "twilio";

export type TransactionalProviderResult = {
  provider: TransactionalProviderName;
  messageId: string;
  status: string;
  channel: TransactionalDeliveryChannel;
  destination: string;
};

export type TransactionalEmailProviderConfiguration = {
  configured: boolean;
  provider: TransactionalEmailProviderName | null;
  missing: string[];
  region: "global" | "eu";
};

export type TransactionalSmsProviderConfiguration = {
  configured: boolean;
  provider: "twilio" | null;
  credentialMode: "api_key" | "auth_token" | null;
  missing: string[];
};

export class TransactionalProviderError extends Error {
  readonly provider: TransactionalProviderName;
  readonly code: string;
  readonly status?: number;
  readonly retryable: boolean;

  constructor(input: {
    provider: TransactionalProviderName;
    message: string;
    code: string;
    status?: number;
    retryable?: boolean;
  }) {
    super(input.message);
    this.name = "TransactionalProviderError";
    this.provider = input.provider;
    this.code = input.code;
    this.status = input.status;
    this.retryable = input.retryable ?? false;
  }
}

export function getTransactionalEmailProviderConfiguration(
  env: ProviderEnvironment = process.env
): TransactionalEmailProviderConfiguration {
  const requestedProvider = readEnv(env, "TRANSACTIONAL_EMAIL_PROVIDER").toLowerCase() || "auto";
  const sendgridKey = readEnv(env, "SENDGRID_API_KEY");
  const resendKey = readEnv(env, "RESEND_API_KEY");
  const requestedRegion = readEnv(env, "SENDGRID_REGION").toLowerCase() || "global";
  const validRegion = requestedRegion === "global" || requestedRegion === "eu";
  const region = requestedRegion === "eu" ? "eu" : "global";
  let provider: TransactionalEmailProviderName | null = null;
  const missing: string[] = [];

  if (requestedProvider === "auto") {
    // Prefer the Twilio-owned provider when both credentials are present. An
    // explicit selector remains available for deliberate Resend fallback.
    provider = sendgridKey ? "sendgrid" : resendKey ? "resend" : null;
    if (!provider) missing.push("SENDGRID_API_KEY or RESEND_API_KEY");
  } else if (requestedProvider === "sendgrid" || requestedProvider === "resend") {
    provider = requestedProvider;
    if (provider === "sendgrid" && !sendgridKey) missing.push("SENDGRID_API_KEY");
    if (provider === "resend" && !resendKey) missing.push("RESEND_API_KEY");
  } else {
    missing.push("TRANSACTIONAL_EMAIL_PROVIDER (use auto, sendgrid, or resend)");
  }

  if (provider === "sendgrid" && !validRegion) {
    missing.push("SENDGRID_REGION (use global or eu)");
  }

  return {
    configured: Boolean(provider) && missing.length === 0,
    provider,
    missing,
    region
  };
}

export function getTransactionalSmsProviderConfiguration(
  env: ProviderEnvironment = process.env,
  options: { requireWebhook?: boolean } = {}
): TransactionalSmsProviderConfiguration {
  const requireWebhook = options.requireWebhook ?? true;
  const accountSid = readEnv(env, "TWILIO_ACCOUNT_SID");
  const apiKeySid = readEnv(env, "TWILIO_API_KEY_SID");
  const apiKeySecret = readEnv(env, "TWILIO_API_KEY_SECRET");
  const authToken = readEnv(env, "TWILIO_AUTH_TOKEN");
  const messagingServiceSid = readEnv(env, "TWILIO_MESSAGING_SERVICE_SID");
  const fromNumber = readEnv(env, "TWILIO_FROM_NUMBER");
  const webhookPublicUrl = readEnv(env, "TWILIO_WEBHOOK_PUBLIC_URL");
  const hasApiKeyPair = Boolean(apiKeySid && apiKeySecret);
  const hasAuthToken = Boolean(authToken);
  const credentialMode = hasApiKeyPair ? "api_key" : hasAuthToken ? "auth_token" : null;
  const missing = [
    !accountSid ? "TWILIO_ACCOUNT_SID" : !/^AC[0-9a-fA-F]{32}$/.test(accountSid)
      ? "TWILIO_ACCOUNT_SID (invalid format)"
      : undefined,
    !credentialMode ? "TWILIO_API_KEY_SID/TWILIO_API_KEY_SECRET or TWILIO_AUTH_TOKEN" : undefined,
    apiKeySid && !/^SK[0-9a-fA-F]{32}$/.test(apiKeySid) ? "TWILIO_API_KEY_SID (invalid format)" : undefined,
    Boolean(apiKeySid) !== Boolean(apiKeySecret) ? "TWILIO_API_KEY_SID and TWILIO_API_KEY_SECRET (both required)" : undefined,
    requireWebhook && !authToken ? "TWILIO_AUTH_TOKEN (required for webhook verification)" : undefined,
    !messagingServiceSid && !fromNumber ? "TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM_NUMBER" : undefined,
    messagingServiceSid && !/^MG[0-9a-fA-F]{32}$/.test(messagingServiceSid)
      ? "TWILIO_MESSAGING_SERVICE_SID (invalid format)"
      : undefined,
    !messagingServiceSid && fromNumber && !/^\+[1-9]\d{7,14}$/.test(fromNumber)
      ? "TWILIO_FROM_NUMBER (use E.164 format)"
      : undefined,
    requireWebhook && !isSafeHttpsUrl(webhookPublicUrl) ? "TWILIO_WEBHOOK_PUBLIC_URL" : undefined
  ].filter((name): name is string => Boolean(name));

  return {
    configured: missing.length === 0,
    provider: missing.length === 0 ? "twilio" : null,
    credentialMode,
    missing
  };
}

export function parseTransactionalEmailAddress(
  input: string | null | undefined
): { email: string; name?: string } | undefined {
  const value = String(input ?? "").replace(/[\r\n]/g, " ").trim();
  const bracketed = value.match(/^(.+?)\s*<([^<>]+)>$/);
  if (bracketed) {
    const email = normalizeEmailRecipient(bracketed[2]);
    const name = bracketed[1].trim().replace(/^"|"$/g, "").trim();
    if (!email || !name || name.length > 100) return undefined;
    return { email, name };
  }
  const email = normalizeEmailRecipient(value);
  return email ? { email } : undefined;
}

export async function sendTransactionalEmail(
  input: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html: string;
    idempotencyKey: string;
    attachments?: Array<{
      filename: string;
      contentType: string;
      bytes: Uint8Array;
    }>;
  },
  options: {
    env?: ProviderEnvironment;
    fetchImpl?: ProviderFetch;
    timeoutMs?: number;
  } = {}
): Promise<TransactionalProviderResult> {
  const env = options.env ?? process.env;
  const configuration = getTransactionalEmailProviderConfiguration(env);
  const provider = configuration.provider ?? "sendgrid";
  if (!configuration.configured || !configuration.provider) {
    throw providerError(provider, "Email delivery is not configured.", "not_configured");
  }

  const to = normalizeEmailRecipient(input.to);
  const from = parseTransactionalEmailAddress(input.from);
  if (!to) throw providerError(provider, "A valid email recipient is required.", "invalid_recipient");
  if (!from) throw providerError(provider, "Email sender configuration is invalid.", "invalid_configuration");
  const subject = input.subject.trim();
  const text = input.text.trim();
  const html = input.html.trim();
  if (!subject || (!text && !html)) {
    throw providerError(provider, "Email content is invalid.", "invalid_content");
  }
  const idempotencyKey = input.idempotencyKey.trim();
  if (!idempotencyKey || idempotencyKey.length > 256) {
    throw providerError(provider, "A valid email idempotency key is required.", "invalid_idempotency_key");
  }

  const attachments = input.attachments ?? [];
  const attachmentBytes = attachments.reduce((total, attachment) => total + attachment.bytes.byteLength, 0);
  const maxAttachmentBytes = configuration.provider === "sendgrid"
    ? MAX_SENDGRID_ATTACHMENT_BYTES
    : MAX_RESEND_ATTACHMENT_BYTES;
  if (attachments.some((attachment) => attachment.bytes.byteLength === 0) || attachmentBytes > maxAttachmentBytes) {
    throw providerError(provider, "Email attachments are empty or too large.", "invalid_attachment");
  }

  const response = configuration.provider === "resend"
    ? await providerFetch("resend", RESEND_EMAIL_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${readEnv(env, "RESEND_API_KEY")}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey
        },
        body: JSON.stringify({
          from: input.from.trim(),
          to: [to],
          subject,
          text,
          html,
          ...(attachments.length ? {
            attachments: attachments.map((attachment) => ({
              filename: safeFilename(attachment.filename),
              content: Buffer.from(attachment.bytes).toString("base64"),
              content_type: attachment.contentType
            }))
          } : {})
        })
      }, options)
    : await providerFetch("sendgrid", sendgridEndpoint(configuration.region), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${readEnv(env, "SENDGRID_API_KEY")}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          personalizations: [{
            to: [{ email: to }],
            custom_args: {
              app_delivery_id: createHash("sha256").update(idempotencyKey).digest("hex")
            }
          }],
          from,
          subject,
          content: [
            text ? { type: "text/plain", value: text } : undefined,
            html ? { type: "text/html", value: html } : undefined
          ].filter(Boolean),
          ...(attachments.length ? {
            attachments: attachments.map((attachment) => ({
              content: Buffer.from(attachment.bytes).toString("base64"),
              type: attachment.contentType,
              filename: safeFilename(attachment.filename),
              disposition: "attachment"
            }))
          } : {})
        })
      }, options);

  const payload = await readProviderPayload(response);
  if (!response.ok) throw responseError(configuration.provider, response.status, payload);
  const rawMessageId = configuration.provider === "resend"
    ? payload?.id
    : response.headers.get("x-message-id");
  const messageId = safeIdentifier(rawMessageId);
  if (!messageId) {
    throw providerError(
      configuration.provider,
      "Email provider returned an invalid response.",
      "invalid_response",
      response.status,
      true
    );
  }

  return {
    provider: configuration.provider,
    messageId,
    status: "accepted",
    channel: "email",
    destination: to
  };
}

export async function sendTransactionalSms(
  input: {
    to: string;
    body: string;
    statusCallback?: string;
  },
  options: {
    env?: ProviderEnvironment;
    fetchImpl?: ProviderFetch;
    timeoutMs?: number;
  } = {}
): Promise<TransactionalProviderResult> {
  const env = options.env ?? process.env;
  const configuration = getTransactionalSmsProviderConfiguration(env);
  if (!configuration.configured) {
    throw providerError("twilio", "SMS delivery is not configured.", "not_configured");
  }

  const to = toUsE164Phone(input.to);
  if (!to) throw providerError("twilio", "A valid US SMS recipient is required.", "invalid_recipient");
  const body = input.body.trim();
  if (!body || body.length > 1_600) {
    throw providerError("twilio", "SMS content must contain between 1 and 1600 characters.", "invalid_content");
  }
  if (input.statusCallback && !isSafeHttpsUrl(input.statusCallback)) {
    throw providerError("twilio", "SMS status callback configuration is invalid.", "invalid_configuration");
  }

  const accountSid = readEnv(env, "TWILIO_ACCOUNT_SID");
  const apiKeySid = readEnv(env, "TWILIO_API_KEY_SID");
  const apiKeySecret = readEnv(env, "TWILIO_API_KEY_SECRET");
  const username = apiKeySid && apiKeySecret ? apiKeySid : accountSid;
  const password = apiKeySid && apiKeySecret ? apiKeySecret : readEnv(env, "TWILIO_AUTH_TOKEN");
  const messagingServiceSid = readEnv(env, "TWILIO_MESSAGING_SERVICE_SID");
  const form = new URLSearchParams({ To: to, Body: body });
  if (messagingServiceSid) form.set("MessagingServiceSid", messagingServiceSid);
  else form.set("From", readEnv(env, "TWILIO_FROM_NUMBER"));
  if (input.statusCallback) form.set("StatusCallback", input.statusCallback);

  const endpoint = `${TWILIO_API_ORIGIN}/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const response = await providerFetch("twilio", endpoint, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: form.toString()
  }, options);
  const payload = await readProviderPayload(response);
  if (!response.ok) throw responseError("twilio", response.status, payload);

  const messageId = safeIdentifier(payload?.sid);
  if (!messageId) {
    throw providerError("twilio", "SMS provider returned an invalid response.", "invalid_response", response.status, true);
  }
  return {
    provider: "twilio",
    messageId,
    status: safeIdentifier(payload?.status) ?? "accepted",
    channel: "sms",
    destination: to
  };
}

async function providerFetch(
  provider: TransactionalProviderName,
  url: string,
  init: RequestInit,
  options: { fetchImpl?: ProviderFetch; timeoutMs?: number }
): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) {
    throw providerError(provider, `${providerLabel(provider)} provider is unavailable.`, "unavailable", undefined, true);
  }

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = globalThis.setTimeout(() => {
      controller.abort();
      reject(providerError(provider, `${providerLabel(provider)} provider request timed out.`, "timeout", undefined, true));
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      fetchImpl(url, { ...init, signal: controller.signal }),
      timeout
    ]);
  } catch (error) {
    if (error instanceof TransactionalProviderError) throw error;
    throw providerError(provider, `${providerLabel(provider)} provider could not be reached.`, "network_error", undefined, true);
  } finally {
    if (timeoutId) globalThis.clearTimeout(timeoutId);
  }
}

async function readProviderPayload(response: Response): Promise<Record<string, unknown> | undefined> {
  try {
    const payload: unknown = await response.json();
    return payload && typeof payload === "object" && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function responseError(
  provider: TransactionalProviderName,
  status: number,
  payload: Record<string, unknown> | undefined
): TransactionalProviderError {
  const rawCode = provider === "twilio"
    ? payload?.code
    : provider === "resend"
      ? payload?.name ?? payload?.code
      : undefined;
  const code = safeErrorCode(rawCode) ?? "provider_rejected";
  const retryable = status === 408
    || status === 425
    || status === 429
    || status >= 500
    || (provider === "resend" && status === 409 && code === "concurrent_idempotent_requests");
  return providerError(
    provider,
    `${providerLabel(provider)} provider rejected the request.`,
    code,
    status,
    retryable
  );
}

function providerError(
  provider: TransactionalProviderName,
  message: string,
  code: string,
  status?: number,
  retryable = false
): TransactionalProviderError {
  return new TransactionalProviderError({ provider, message, code, status, retryable });
}

function readEnv(env: ProviderEnvironment, name: string): string {
  return String(env[name] ?? "").trim();
}

function safeFilename(value: string): string {
  const normalized = value.replace(/[\r\n/\\]/g, "-").replace(/[^a-z0-9._ -]+/gi, "-").trim();
  return normalized.slice(0, 180) || "attachment";
}

function safeIdentifier(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized && normalized.length <= 256 && /^[a-zA-Z0-9_.:-]+$/.test(normalized)
    ? normalized
    : undefined;
}

function safeErrorCode(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const normalized = String(value).trim();
  return /^[a-zA-Z0-9_-]{1,80}$/.test(normalized) ? normalized : undefined;
}

function isSafeHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) && !url.hostname.includes("_");
  } catch {
    return false;
  }
}

function sendgridEndpoint(region: "global" | "eu"): string {
  return region === "eu" ? SENDGRID_EU_EMAIL_ENDPOINT : SENDGRID_GLOBAL_EMAIL_ENDPOINT;
}

function providerLabel(provider: TransactionalProviderName): "Email" | "SMS" {
  return provider === "twilio" ? "SMS" : "Email";
}
