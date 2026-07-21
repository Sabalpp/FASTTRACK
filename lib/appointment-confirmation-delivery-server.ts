import type { SupabaseClient } from "@supabase/supabase-js";
import { appointmentTextToHtml } from "@/lib/appointment-confirmations";
import {
  AppointmentProviderError,
  sendAppointmentEmail,
  sendAppointmentSms
} from "@/lib/appointment-providers";
import type { AppointmentNotification } from "@/lib/types";

if (typeof window !== "undefined" && process.env.NODE_ENV !== "test") {
  throw new Error("Appointment delivery can only run on the server.");
}

export type AppointmentDeliveryOutcome = {
  notificationId: string;
  status: "accepted" | "failed" | "ignored";
  providerErrorCode?: string;
  retryable?: boolean;
};

export async function deliverClaimedAppointmentNotification(
  client: SupabaseClient,
  notification: AppointmentNotification
): Promise<AppointmentDeliveryOutcome> {
  if (notification.status !== "processing") {
    return { notificationId: notification.id, status: "ignored" };
  }
  if (!notification.claimToken) {
    throw new AppointmentDeliveryPersistenceError("The notification claim is missing its fencing token.");
  }

  const subject = notification.messageSubject ?? "";
  const body = notification.messageBody ?? "";
  let providerResult: Awaited<ReturnType<typeof sendAppointmentEmail>>;

  try {
    providerResult = notification.channel === "email"
      ? await sendAppointmentEmail({
          to: notification.destination,
          subject,
          text: body,
          html: appointmentTextToHtml(body),
          idempotencyKey: notification.idempotencyKey
        })
      : await sendAppointmentSms({
          to: notification.destination,
          body
        });
  } catch (error) {
    const providerError = error instanceof AppointmentProviderError ? error : undefined;
    await completeNotification(client, notification, {
      status: "failed",
      provider: providerError?.provider ?? null,
      providerMessageId: null,
      errorCode: providerFailureCode(providerError),
      errorMessage: safeDeliveryError(notification.channel, error)
    });
    return {
      notificationId: notification.id,
      status: "failed",
      providerErrorCode: providerError?.code,
      retryable: providerError?.retryable
    };
  }

  // Keep persistence outside the provider catch. If this acknowledgement fails,
  // the provider already accepted the message and it must not be relabelled failed.
  await completeNotification(client, notification, {
    status: "accepted",
    provider: providerResult.provider,
    providerMessageId: providerResult.messageId,
    errorCode: null,
    errorMessage: null
  });
  return { notificationId: notification.id, status: "accepted" };
}

async function completeNotification(
  client: SupabaseClient,
  notification: AppointmentNotification,
  result: {
    status: "accepted" | "failed";
    provider: string | null;
    providerMessageId: string | null;
    errorCode:
      | "provider_temporary_failure"
      | "provider_permanent_failure"
      | "sms_recipient_opted_out"
      | "sms_delivery_state_unknown"
      | null;
    errorMessage: string | null;
  }
): Promise<void> {
  let lastCode: string | undefined;

  // A provider may already have accepted the message. Briefly retry the database
  // acknowledgement so a transient Supabase error does not leave it claimable again.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { error } = await client.rpc("complete_job_confirmation", {
      p_notification_id: notification.id,
      p_claim_token: notification.claimToken,
      p_status: result.status,
      p_provider: result.provider,
      p_provider_message_id: result.providerMessageId,
      p_message_subject: notification.messageSubject ?? "",
      p_message_body: notification.messageBody ?? "",
      p_error_message: result.errorMessage,
      p_error_code: result.errorCode
    });
    if (!error) return;
    lastCode = error.code;
  }

  throw new AppointmentDeliveryPersistenceError(
    "The provider result could not be recorded.",
    lastCode
  );
}

function providerFailureCode(
  error: AppointmentProviderError | undefined
): "provider_temporary_failure" | "provider_permanent_failure" | "sms_recipient_opted_out" | "sms_delivery_state_unknown" {
  if (error?.provider === "twilio" && error.code === "21610") return "sms_recipient_opted_out";
  if (
    error?.provider === "twilio"
    && (error.code === "timeout" || error.code === "network_error" || (error.status !== undefined && error.status >= 500))
  ) return "sms_delivery_state_unknown";
  return error?.retryable === false ? "provider_permanent_failure" : "provider_temporary_failure";
}

function safeDeliveryError(
  channel: AppointmentNotification["channel"],
  error: unknown
): string {
  if (error instanceof AppointmentProviderError) return error.message;
  return channel === "email"
    ? "Email delivery failed before it could be confirmed."
    : "Text-message delivery failed before it could be confirmed.";
}

export class AppointmentDeliveryPersistenceError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = "AppointmentDeliveryPersistenceError";
  }
}
