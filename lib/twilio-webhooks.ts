import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizePhone } from "@/lib/phone";

if (typeof window !== "undefined" && process.env.NODE_ENV !== "test") {
  throw new Error("Twilio webhook verification can only run on the server.");
}

type TwilioWebhookEnvironment = Record<string, string | undefined>;

export type TwilioWebhookConfiguration = {
  accountSid: string;
  authToken: string;
  publicUrl: string;
};

export type TwilioSmsConsentSource =
  | "twilio_stop"
  | "twilio_start"
  | "twilio_error_21610";

export class TwilioWebhookConfigurationError extends Error {
  constructor() {
    super("Twilio webhook verification is not configured.");
    this.name = "TwilioWebhookConfigurationError";
  }
}

export class TwilioWebhookPersistenceError extends Error {
  constructor() {
    super("Twilio webhook data could not be saved.");
    this.name = "TwilioWebhookPersistenceError";
  }
}

export function getTwilioWebhookConfiguration(
  env: TwilioWebhookEnvironment = process.env
): TwilioWebhookConfiguration {
  const accountSid = readEnv(env, "TWILIO_ACCOUNT_SID");
  const authToken = readEnv(env, "TWILIO_AUTH_TOKEN");
  const publicUrl = readEnv(env, "TWILIO_WEBHOOK_PUBLIC_URL");

  if (
    !/^AC[0-9a-fA-F]{32}$/.test(accountSid)
    || authToken.length === 0
    || authToken.length > 512
    || !isSafePublicHttpsUrl(publicUrl)
  ) {
    throw new TwilioWebhookConfigurationError();
  }

  return { accountSid, authToken, publicUrl };
}

/**
 * Implements Twilio's form-webhook signing algorithm. The URL must be the exact
 * public URL configured in Twilio, including its original query string.
 */
export function createTwilioFormSignature(input: {
  authToken: string;
  publicUrl: string;
  params: URLSearchParams;
}): string {
  let payload = input.publicUrl;
  const names = [...new Set(input.params.keys())].sort();

  for (const name of names) {
    const values = [...new Set(input.params.getAll(name))].sort();
    for (const value of values) payload += `${name}${value}`;
  }

  return createHmac("sha1", input.authToken)
    .update(payload, "utf8")
    .digest("base64");
}

export function validateTwilioFormSignature(input: {
  authToken: string;
  publicUrl: string;
  params: URLSearchParams;
  signature: string | null | undefined;
}): boolean {
  const signature = String(input.signature ?? "").trim();
  if (!signature) return false;

  const expected = createTwilioFormSignature(input);
  const expectedBytes = Buffer.from(expected, "utf8");
  const receivedBytes = Buffer.from(signature, "utf8");
  return expectedBytes.length === receivedBytes.length
    && timingSafeEqual(expectedBytes, receivedBytes);
}

export async function recordTwilioSmsConsent(
  admin: SupabaseClient,
  input: {
    status: "opted_in" | "opted_out";
    source: TwilioSmsConsentSource;
    phone?: string | null;
    customerId?: string | null;
  }
): Promise<string[]> {
  const customerId = normalizeUuid(input.customerId);
  const phone = input.phone == null || String(input.phone).trim() === ""
    ? null
    : normalizeUsPhone(input.phone);

  if (!customerId && !phone) throw new TwilioWebhookPersistenceError();

  const { data, error } = await admin.rpc("record_customer_sms_consent_from_provider", {
    p_phone: phone,
    p_status: input.status,
    p_source: input.source,
    p_customer_id: customerId
  });
  if (error) throw new TwilioWebhookPersistenceError();

  if (!Array.isArray(data)) return [];
  return data
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      return normalizeUuid((row as { updated_customer_id?: unknown }).updated_customer_id);
    })
    .filter((id): id is string => Boolean(id));
}

export function recordTwilioOptOut(
  admin: SupabaseClient,
  input: {
    source: "twilio_stop" | "twilio_error_21610";
    phone?: string | null;
    customerId?: string | null;
  }
): Promise<string[]> {
  return recordTwilioSmsConsent(admin, {
    ...input,
    status: "opted_out"
  });
}

function readEnv(env: TwilioWebhookEnvironment, name: string): string {
  return String(env[name] ?? "").trim();
}

function isSafePublicHttpsUrl(value: string): boolean {
  if (!value || value.length > 2_048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && Boolean(url.hostname)
      && !url.hostname.includes("_")
      && !url.username
      && !url.password
      && !url.hash;
  } catch {
    return false;
  }
}

function normalizeUsPhone(value: string): string | null {
  const digits = normalizePhone(value);
  return /^\d{10}$/.test(digits) ? digits : null;
}

function normalizeUuid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)
    ? normalized
    : null;
}
