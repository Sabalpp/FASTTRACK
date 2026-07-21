import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import { normalizePhone } from "@/lib/phone";
import {
  getTwilioWebhookConfiguration,
  recordTwilioOptOut,
  recordTwilioSmsConsent,
  TwilioWebhookConfigurationError,
  validateTwilioFormSignature
} from "@/lib/twilio-webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_WEBHOOK_BYTES = 64 * 1024;
const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
const MESSAGE_SID_PATTERN = /^(?:SM|MM)[0-9a-fA-F]{32}$/;
const MESSAGE_STATUS_PATTERN = /^[a-z][a-z0-9_-]{0,39}$/;
const TERMINAL_MESSAGE_STATUSES = new Set([
  "canceled",
  "delivered",
  "failed",
  "read",
  "received",
  "undelivered"
]);
const FAILED_MESSAGE_STATUSES = new Set(["canceled", "failed", "undelivered"]);
const SUCCESS_MESSAGE_STATUSES = new Set(["delivered", "read"]);
const WEBHOOK_RECLAIM_AFTER_MS = 15_000;
const MESSAGE_STATUS_RANK: Record<string, number> = {
  accepted: 10,
  scheduled: 20,
  queued: 20,
  sending: 30,
  receiving: 30,
  sent: 40,
  delivered: 50,
  received: 50,
  undelivered: 50,
  failed: 50,
  canceled: 50,
  read: 60
};

type NotificationRow = {
  id: string;
  customer_id: string | null;
  status: string;
  provider_status: string | null;
};

type WebhookEventState = "process" | "processed" | "in_flight";
type WebhookEventRow = {
  received_at: string;
  processed_at: string | null;
};

export async function POST(request: Request): Promise<Response> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/x-www-form-urlencoded")) {
    return textResponse("Unsupported webhook content type.", 415);
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_WEBHOOK_BYTES) {
    return textResponse("Webhook payload is too large.", 413);
  }

  let configuration;
  try {
    configuration = getTwilioWebhookConfiguration();
  } catch (error) {
    if (error instanceof TwilioWebhookConfigurationError) {
      return textResponse("Webhook service is not configured.", 503);
    }
    return textResponse("Webhook service is unavailable.", 503);
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return textResponse("Invalid webhook payload.", 400);
  }
  if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BYTES) {
    return textResponse("Webhook payload is too large.", 413);
  }

  const params = new URLSearchParams(rawBody);
  if (!validateTwilioFormSignature({
    authToken: configuration.authToken,
    publicUrl: configuration.publicUrl,
    params,
    signature: request.headers.get("x-twilio-signature")
  })) {
    return textResponse("Webhook signature is invalid.", 403);
  }

  const accountSid = singleValue(params, "AccountSid");
  if (!accountSid.valid || accountSid.value !== configuration.accountSid) {
    return textResponse("Webhook signature is invalid.", 403);
  }

  let admin;
  try {
    admin = getSupabaseAdminClient();
  } catch {
    admin = null;
  }
  if (!admin) return textResponse("Webhook service is not configured.", 503);

  try {
    const optOutType = singleValue(params, "OptOutType");
    if (!optOutType.valid) return textResponse("Invalid webhook payload.", 400);
    if (optOutType.value) {
      const keyword = optOutType.value.toUpperCase();
      if (keyword === "STOP" || keyword === "START") {
        const from = singleValue(params, "From");
        const messageSid = singleValue(params, "MessageSid");
        const phone = from.valid ? normalizeUsPhone(from.value) : null;
        if (
          !from.valid
          || !phone
          || !messageSid.valid
          || !MESSAGE_SID_PATTERN.test(messageSid.value)
        ) return textResponse("Invalid webhook payload.", 400);

        const eventKey = `optout:${messageSid.value}:${keyword.toLowerCase()}`;
        const eventState = await beginWebhookEvent(admin, {
          eventKey,
          eventType: "advanced_opt_out",
          messageSid: messageSid.value,
          status: keyword.toLowerCase()
        });
        if (eventState === "processed") return twimlResponse();
        if (eventState === "in_flight") {
          return textResponse("Webhook event is already processing.", 503);
        }

        if (keyword === "STOP") {
          await recordTwilioOptOut(admin, { phone, source: "twilio_stop" });
        } else {
          await recordTwilioSmsConsent(admin, {
            phone,
            status: "opted_in",
            source: "twilio_start"
          });
        }
        await markWebhookEventProcessed(admin, eventKey);
        return twimlResponse();
      }

      if (keyword !== "HELP") return textResponse("Invalid webhook payload.", 400);
      return twimlResponse();
    }

    const messageStatusValue = singleValue(params, "MessageStatus");
    if (!messageStatusValue.valid) return textResponse("Invalid webhook payload.", 400);
    if (messageStatusValue.value) {
      return await handleStatusCallback(admin, params, messageStatusValue.value);
    }

    // Twilio has already handled Advanced Opt-Out confirmation replies. Normal
    // inbound messages also receive empty TwiML so this endpoint never emits a
    // second customer SMS.
    return twimlResponse();
  } catch {
    return textResponse("Webhook processing failed.", 500);
  }
}

async function handleStatusCallback(
  admin: NonNullable<ReturnType<typeof getSupabaseAdminClient>>,
  params: URLSearchParams,
  rawStatus: string
): Promise<Response> {
  const sidValue = singleValue(params, "MessageSid");
  const errorCodeValue = singleValue(params, "ErrorCode");
  const toValue = singleValue(params, "To");
  const status = rawStatus.trim().toLowerCase();

  if (
    !sidValue.valid
    || !MESSAGE_SID_PATTERN.test(sidValue.value)
    || !errorCodeValue.valid
    || !toValue.valid
    || !MESSAGE_STATUS_PATTERN.test(status)
  ) {
    return textResponse("Invalid webhook payload.", 400);
  }

  const errorCode = normalizeErrorCode(errorCodeValue.value);
  if (errorCodeValue.value && errorCode === undefined) {
    return textResponse("Invalid webhook payload.", 400);
  }

  const eventKey = `status:${sidValue.value}:${status}:${errorCode ?? "0"}`;
  const eventState = await beginWebhookEvent(admin, {
    eventKey,
    eventType: "message_status",
    messageSid: sidValue.value,
    status
  });
  if (eventState === "processed") return emptyResponse();
  if (eventState === "in_flight") {
    return textResponse("Webhook event is already processing.", 503);
  }

  let notification = await findNotificationByMessageSid(admin, sidValue.value);

  if (errorCode === "21610") {
    const phone = normalizeUsPhone(toValue.value);
    if (!phone) return textResponse("Invalid webhook payload.", 400);
    if (notification?.customer_id) {
      const updatedCustomerIds = await recordTwilioOptOut(admin, {
        customerId: notification.customer_id,
        phone,
        source: "twilio_error_21610"
      });
      if (updatedCustomerIds.length === 0 && phone) {
        await recordTwilioOptOut(admin, {
          phone,
          source: "twilio_error_21610"
        });
      }
    } else {
      if (phone) {
        await recordTwilioOptOut(admin, {
          phone,
          source: "twilio_error_21610"
        });
      }
    }
  }

  if (!notification) {
    // Twilio can callback before the provider SID acknowledgement is committed.
    // Keep this inbox event pending and return a retryable response.
    return textResponse("Notification acknowledgement is still pending.", 503);
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!shouldApplyStatus(notification.provider_status, status)) {
      await markWebhookEventProcessed(admin, eventKey);
      return emptyResponse();
    }

    const now = new Date().toISOString();
    const update: Record<string, string | null> = {
      provider_status: status,
      provider_error_code: errorCode ?? null,
      provider_status_at: now,
      updated_at: now
    };

    if (FAILED_MESSAGE_STATUSES.has(status)) {
      update.status = "failed";
      update.failed_at = now;
      update.last_error_code = `twilio_${errorCode ?? status}`;
      update.error_message = "SMS delivery failed.";
      update.last_error_at = now;
    } else if (SUCCESS_MESSAGE_STATUSES.has(status)) {
      update.status = "accepted";
      update.failed_at = null;
      update.last_error_code = null;
      update.error_message = null;
      update.last_error_at = null;
    }

    let updateQuery = admin
      .from("appointment_notifications")
      .update(update)
      .eq("id", notification.id);
    updateQuery = notification.provider_status == null
      ? updateQuery.is("provider_status", null)
      : updateQuery.eq("provider_status", notification.provider_status);

    const { data: updated, error: updateError } = await updateQuery
      .select("id")
      .maybeSingle();
    if (updateError) throw new Error("notification_update_failed");
    if (updated) {
      await markWebhookEventProcessed(admin, eventKey);
      return emptyResponse();
    }

    notification = await findNotificationByMessageSid(admin, sidValue.value);
    if (!notification) {
      return textResponse("Notification acknowledgement is still pending.", 503);
    }
  }

  throw new Error("notification_update_conflict");
}

async function findNotificationByMessageSid(
  admin: NonNullable<ReturnType<typeof getSupabaseAdminClient>>,
  messageSid: string
): Promise<NotificationRow | null> {
  const { data, error } = await admin
    .from("appointment_notifications")
    .select("id,customer_id,status,provider_status")
    .eq("provider", "twilio")
    .eq("provider_message_id", messageSid)
    .maybeSingle();
  if (error) throw new Error("notification_lookup_failed");
  return asNotificationRow(data);
}

async function beginWebhookEvent(
  admin: NonNullable<ReturnType<typeof getSupabaseAdminClient>>,
  input: {
    eventKey: string;
    eventType: string;
    messageSid: string;
    status: string;
  }
): Promise<WebhookEventState> {
  const { error: insertError } = await admin
    .from("twilio_webhook_events")
    .insert({
      event_key: input.eventKey,
      event_type: input.eventType,
      message_sid: input.messageSid,
      status: input.status
    });
  if (!insertError) return "process";
  if (insertError.code !== "23505") throw new Error("webhook_event_insert_failed");

  const { data, error } = await admin
    .from("twilio_webhook_events")
    .select("received_at,processed_at")
    .eq("event_key", input.eventKey)
    .maybeSingle();
  if (error || !isWebhookEventRow(data)) throw new Error("webhook_event_lookup_failed");
  if (data.processed_at) return "processed";

  const receivedAt = Date.parse(data.received_at);
  return Number.isFinite(receivedAt) && Date.now() - receivedAt >= WEBHOOK_RECLAIM_AFTER_MS
    ? "process"
    : "in_flight";
}

async function markWebhookEventProcessed(
  admin: NonNullable<ReturnType<typeof getSupabaseAdminClient>>,
  eventKey: string
): Promise<void> {
  const { error } = await admin.rpc("mark_twilio_webhook_event_processed", {
    p_event_key: eventKey
  });
  if (error) throw new Error("webhook_event_completion_failed");
}

function isWebhookEventRow(value: unknown): value is WebhookEventRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<WebhookEventRow>;
  return typeof row.received_at === "string"
    && (row.processed_at === null || typeof row.processed_at === "string");
}

function shouldApplyStatus(currentValue: string | null, next: string): boolean {
  const current = String(currentValue ?? "").trim().toLowerCase();
  if (!current) return true;
  if (current === next) return false;
  if (current === "delivered" && next === "read") return true;
  if (TERMINAL_MESSAGE_STATUSES.has(current)) return false;

  const currentRank = MESSAGE_STATUS_RANK[current];
  const nextRank = MESSAGE_STATUS_RANK[next];
  return currentRank === undefined || nextRank === undefined || nextRank >= currentRank;
}

function normalizeErrorCode(value: string): string | null | undefined {
  const normalized = value.trim();
  if (!normalized || normalized === "0") return null;
  return /^\d{1,10}$/.test(normalized) ? normalized : undefined;
}

function normalizeUsPhone(value: string): string | null {
  const digits = normalizePhone(value);
  return /^\d{10}$/.test(digits) ? digits : null;
}

function asNotificationRow(value: unknown): NotificationRow | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<NotificationRow>;
  if (
    typeof row.id !== "string"
    || (row.customer_id !== null && typeof row.customer_id !== "string")
    || typeof row.status !== "string"
    || (row.provider_status !== null && typeof row.provider_status !== "string")
  ) return null;
  return row as NotificationRow;
}

function singleValue(
  params: URLSearchParams,
  name: string
): { valid: boolean; value: string } {
  const values = params.getAll(name);
  if (values.length > 1) return { valid: false, value: "" };
  return { valid: true, value: values[0] ?? "" };
}

function twimlResponse(): Response {
  return new Response(EMPTY_TWIML, {
    status: 200,
    headers: webhookHeaders("text/xml; charset=utf-8")
  });
}

function emptyResponse(): Response {
  return new Response(null, {
    status: 200,
    headers: webhookHeaders()
  });
}

function textResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: webhookHeaders("text/plain; charset=utf-8")
  });
}

function webhookHeaders(contentType?: string): HeadersInit {
  return {
    ...(contentType ? { "Content-Type": contentType } : {}),
    "Cache-Control": "no-store, max-age=0",
    "X-Content-Type-Options": "nosniff"
  };
}
