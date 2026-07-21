import {
  normalizeEmailRecipient,
  toUsE164Phone
} from "@/lib/appointment-confirmations";

if (typeof window !== "undefined" && process.env.NODE_ENV !== "test") {
  throw new Error("Appointment provider credentials can only be used by server modules.");
}

const RESEND_EMAIL_ENDPOINT = "https://api.resend.com/emails";
const TWILIO_API_ORIGIN = "https://api.twilio.com";
const DEFAULT_PROVIDER_TIMEOUT_MS = 15_000;
const TWILIO_WEBHOOK_RETRY_OVERRIDES = "#rc=3&rp=all&ct=2000&rt=5000&tt=15000";

type ProviderEnvironment = Record<string, string | undefined>;
type ProviderFetch = typeof fetch;

export type AppointmentProviderName = "resend" | "twilio";

export type AppointmentProviderConfiguration = {
  email: {
    configured: boolean;
    missing: string[];
  };
  sms: {
    configured: boolean;
    credentialMode: "api_key" | "auth_token" | null;
    missing: string[];
  };
};

export type AppointmentProviderResult = {
  provider: AppointmentProviderName;
  messageId: string;
  status: string;
};

export class AppointmentProviderError extends Error {
  readonly provider: AppointmentProviderName;
  readonly code: string;
  readonly status?: number;
  readonly retryable: boolean;

  constructor(input: {
    provider: AppointmentProviderName;
    message: string;
    code: string;
    status?: number;
    retryable?: boolean;
  }) {
    super(input.message);
    this.name = "AppointmentProviderError";
    this.provider = input.provider;
    this.code = input.code;
    this.status = input.status;
    this.retryable = input.retryable ?? false;
  }
}

export function getAppointmentProviderConfiguration(
  env: ProviderEnvironment = process.env
): AppointmentProviderConfiguration {
  const resendKey = readEnv(env, "RESEND_API_KEY");
  const fromEmail = readEnv(env, "APPOINTMENT_FROM_EMAIL") || readEnv(env, "INVOICE_FROM_EMAIL");
  const emailMissing = [
    !resendKey ? "RESEND_API_KEY" : undefined,
    !fromEmail ? "APPOINTMENT_FROM_EMAIL" : undefined
  ].filter((name): name is string => Boolean(name));

  const accountSid = readEnv(env, "TWILIO_ACCOUNT_SID");
  const apiKeySid = readEnv(env, "TWILIO_API_KEY_SID");
  const apiKeySecret = readEnv(env, "TWILIO_API_KEY_SECRET");
  const authToken = readEnv(env, "TWILIO_AUTH_TOKEN");
  const messagingServiceSid = readEnv(env, "TWILIO_MESSAGING_SERVICE_SID");
  const fromNumber = readEnv(env, "TWILIO_FROM_NUMBER");
  const webhookPublicUrl = readEnv(env, "TWILIO_WEBHOOK_PUBLIC_URL");
  const hasApiKey = Boolean(apiKeySid && apiKeySecret);
  const hasAuthToken = Boolean(authToken);
  const credentialMode = hasApiKey ? "api_key" : hasAuthToken ? "auth_token" : null;
  const smsMissing = [
    !accountSid ? "TWILIO_ACCOUNT_SID" : undefined,
    !credentialMode ? "TWILIO_API_KEY_SID/TWILIO_API_KEY_SECRET or TWILIO_AUTH_TOKEN" : undefined,
    !authToken ? "TWILIO_AUTH_TOKEN (required for webhook verification)" : undefined,
    !messagingServiceSid && !fromNumber ? "TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM_NUMBER" : undefined,
    !isSafeHttpsUrl(webhookPublicUrl) ? "TWILIO_WEBHOOK_PUBLIC_URL" : undefined
  ].filter((name): name is string => Boolean(name));

  return {
    email: {
      configured: emailMissing.length === 0,
      missing: emailMissing
    },
    sms: {
      configured: smsMissing.length === 0,
      credentialMode,
      missing: smsMissing
    }
  };
}

export async function sendAppointmentEmail(
  input: {
    to: string;
    subject: string;
    text: string;
    html: string;
    idempotencyKey: string;
  },
  options: {
    env?: ProviderEnvironment;
    fetchImpl?: ProviderFetch;
    timeoutMs?: number;
  } = {}
): Promise<AppointmentProviderResult> {
  assertServerEnvironment("resend");
  const env = options.env ?? process.env;
  const configuration = getAppointmentProviderConfiguration(env);
  if (!configuration.email.configured) {
    throw providerError("resend", "Email delivery is not configured.", "not_configured");
  }

  const to = normalizeEmailRecipient(input.to);
  if (!to) throw providerError("resend", "A valid email recipient is required.", "invalid_recipient");
  const idempotencyKey = input.idempotencyKey.trim();
  if (idempotencyKey.length === 0 || idempotencyKey.length > 256) {
    throw providerError("resend", "A valid email idempotency key is required.", "invalid_idempotency_key");
  }

  const response = await providerFetch("resend", RESEND_EMAIL_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${readEnv(env, "RESEND_API_KEY")}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey
    },
    body: JSON.stringify({
      from: readEnv(env, "APPOINTMENT_FROM_EMAIL") || readEnv(env, "INVOICE_FROM_EMAIL"),
      to: [to],
      subject: input.subject,
      text: input.text,
      html: input.html
    })
  }, options);
  const payload = await readProviderPayload(response);
  if (!response.ok) throw responseError("resend", response.status, payload);

  const messageId = safeIdentifier(payload?.id);
  if (!messageId) {
    throw providerError("resend", "Email provider returned an invalid response.", "invalid_response", response.status, true);
  }
  return { provider: "resend", messageId, status: "accepted" };
}

export async function sendAppointmentSms(
  input: {
    to: string;
    body: string;
  },
  options: {
    env?: ProviderEnvironment;
    fetchImpl?: ProviderFetch;
    timeoutMs?: number;
  } = {}
): Promise<AppointmentProviderResult> {
  assertServerEnvironment("twilio");
  const env = options.env ?? process.env;
  const configuration = getAppointmentProviderConfiguration(env);
  if (!configuration.sms.configured) {
    throw providerError("twilio", "SMS delivery is not configured.", "not_configured");
  }

  const to = toUsE164Phone(input.to);
  if (!to) throw providerError("twilio", "A valid US SMS recipient is required.", "invalid_recipient");
  const body = input.body.trim();
  if (body.length === 0 || body.length > 1_600) {
    throw providerError("twilio", "SMS content must contain between 1 and 1600 characters.", "invalid_content");
  }

  const accountSid = readEnv(env, "TWILIO_ACCOUNT_SID");
  if (!/^AC[0-9a-fA-F]{32}$/.test(accountSid)) {
    throw providerError("twilio", "SMS delivery configuration is invalid.", "invalid_configuration");
  }
  const messagingServiceSid = readEnv(env, "TWILIO_MESSAGING_SERVICE_SID");
  const fromNumber = readEnv(env, "TWILIO_FROM_NUMBER");
  if (messagingServiceSid && !/^MG[0-9a-fA-F]{32}$/.test(messagingServiceSid)) {
    throw providerError("twilio", "SMS delivery configuration is invalid.", "invalid_configuration");
  }
  if (!messagingServiceSid && !/^\+[1-9]\d{7,14}$/.test(fromNumber)) {
    throw providerError("twilio", "SMS delivery configuration is invalid.", "invalid_configuration");
  }

  const apiKeySid = readEnv(env, "TWILIO_API_KEY_SID");
  const apiKeySecret = readEnv(env, "TWILIO_API_KEY_SECRET");
  const username = apiKeySid && apiKeySecret ? apiKeySid : accountSid;
  const password = apiKeySid && apiKeySecret ? apiKeySecret : readEnv(env, "TWILIO_AUTH_TOKEN");
  const form = new URLSearchParams({ To: to, Body: body });
  if (messagingServiceSid) form.set("MessagingServiceSid", messagingServiceSid);
  else form.set("From", fromNumber);

  form.set(
    "StatusCallback",
    `${readEnv(env, "TWILIO_WEBHOOK_PUBLIC_URL")}${TWILIO_WEBHOOK_RETRY_OVERRIDES}`
  );

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
    status: safeIdentifier(payload?.status) ?? "accepted"
  };
}

async function providerFetch(
  provider: AppointmentProviderName,
  url: string,
  init: RequestInit,
  options: { fetchImpl?: ProviderFetch; timeoutMs?: number }
): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) throw providerError(provider, `${providerLabel(provider)} provider is unavailable.`, "unavailable", undefined, true);

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
    if (error instanceof AppointmentProviderError) throw error;
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
  provider: AppointmentProviderName,
  status: number,
  payload: Record<string, unknown> | undefined
): AppointmentProviderError {
  const rawCode = provider === "twilio" ? payload?.code : payload?.name ?? payload?.code;
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
  provider: AppointmentProviderName,
  message: string,
  code: string,
  status?: number,
  retryable = false
): AppointmentProviderError {
  return new AppointmentProviderError({ provider, message, code, status, retryable });
}

function assertServerEnvironment(provider: AppointmentProviderName): void {
  if (typeof window !== "undefined" && process.env.NODE_ENV !== "test") {
    throw providerError(provider, `${providerLabel(provider)} delivery is only available on the server.`, "server_only");
  }
}

function readEnv(env: ProviderEnvironment, name: string): string {
  return String(env[name] ?? "").trim();
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

function providerLabel(provider: AppointmentProviderName): "Email" | "SMS" {
  return provider === "resend" ? "Email" : "SMS";
}
