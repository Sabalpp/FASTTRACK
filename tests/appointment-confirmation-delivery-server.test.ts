import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const deliveryHarness = vi.hoisted(() => ({
  sendAppointmentEmail: vi.fn(),
  sendAppointmentSms: vi.fn()
}));

vi.mock("@/lib/appointment-providers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/appointment-providers")>();
  return {
    ...actual,
    sendAppointmentEmail: deliveryHarness.sendAppointmentEmail,
    sendAppointmentSms: deliveryHarness.sendAppointmentSms
  };
});

import {
  AppointmentDeliveryPersistenceError,
  deliverClaimedAppointmentNotification
} from "@/lib/appointment-confirmation-delivery-server";
import { AppointmentProviderError } from "@/lib/appointment-providers";
import type { AppointmentNotification } from "@/lib/types";

const NOTIFICATION_ID = "33333333-3333-4333-8333-333333333333";
const CLAIM_TOKEN = "66666666-6666-4666-8666-666666666666";

describe("claimed appointment notification delivery", () => {
  beforeEach(() => {
    deliveryHarness.sendAppointmentEmail.mockReset();
    deliveryHarness.sendAppointmentSms.mockReset();
  });

  it("persists provider acceptance with the exact claim fencing token", async () => {
    const database = createDatabase();
    deliveryHarness.sendAppointmentEmail.mockResolvedValue({
      provider: "resend",
      messageId: "email_accepted",
      status: "accepted"
    });

    const outcome = await deliverClaimedAppointmentNotification(
      database.client,
      notification()
    );

    expect(outcome).toEqual({ notificationId: NOTIFICATION_ID, status: "accepted" });
    expect(database.rpc).toHaveBeenCalledExactlyOnceWith("complete_job_confirmation", {
      p_notification_id: NOTIFICATION_ID,
      p_claim_token: CLAIM_TOKEN,
      p_status: "accepted",
      p_provider: "resend",
      p_provider_message_id: "email_accepted",
      p_message_subject: "Your Fast Track service appointment",
      p_message_body: "Your appointment window is 9:00 AM–12:00 PM.",
      p_error_message: null,
      p_error_code: null
    });
  });

  it("classifies an ambiguous Twilio network failure as an unknown delivery state", async () => {
    const database = createDatabase();
    deliveryHarness.sendAppointmentSms.mockRejectedValue(new AppointmentProviderError({
      provider: "twilio",
      message: "Text-message delivery failed before it could be confirmed.",
      code: "network_error",
      retryable: true
    }));

    const outcome = await deliverClaimedAppointmentNotification(
      database.client,
      notification({
        channel: "sms",
        destination: "+17035551212",
        messageSubject: "",
        messageBody: "Your appointment window is 9:00 AM–12:00 PM. Reply STOP to opt out.",
        idempotencyKey: "auto:job:1:confirmation:sms"
      })
    );

    expect(outcome).toEqual({
      notificationId: NOTIFICATION_ID,
      status: "failed",
      providerErrorCode: "network_error",
      retryable: true
    });
    expect(database.rpc).toHaveBeenCalledExactlyOnceWith("complete_job_confirmation", {
      p_notification_id: NOTIFICATION_ID,
      p_claim_token: CLAIM_TOKEN,
      p_status: "failed",
      p_provider: "twilio",
      p_provider_message_id: null,
      p_message_subject: "",
      p_message_body: "Your appointment window is 9:00 AM–12:00 PM. Reply STOP to opt out.",
      p_error_message: "Text-message delivery failed before it could be confirmed.",
      p_error_code: "sms_delivery_state_unknown"
    });
  });

  it("fails closed before contacting a provider when a processing claim has no fencing token", async () => {
    const database = createDatabase();

    await expect(deliverClaimedAppointmentNotification(
      database.client,
      notification({ claimToken: undefined })
    )).rejects.toBeInstanceOf(AppointmentDeliveryPersistenceError);

    expect(deliveryHarness.sendAppointmentEmail).not.toHaveBeenCalled();
    expect(deliveryHarness.sendAppointmentSms).not.toHaveBeenCalled();
    expect(database.rpc).not.toHaveBeenCalled();
  });
});

function createDatabase() {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
  return {
    rpc,
    client: { rpc } as unknown as SupabaseClient
  };
}

function notification(
  overrides: Partial<AppointmentNotification> = {}
): AppointmentNotification {
  return {
    id: NOTIFICATION_ID,
    jobId: "11111111-1111-4111-8111-111111111111",
    customerId: "22222222-2222-4222-8222-222222222222",
    jobRevision: 1,
    eventType: "confirmation",
    channel: "email",
    destination: "customer@example.com",
    customerName: "Customer Name",
    scheduledStartAt: "2026-07-21T13:00:00.000Z",
    scheduledEndAt: "2026-07-21T16:00:00.000Z",
    serviceAddress: "123 Main St",
    messageSubject: "Your Fast Track service appointment",
    messageBody: "Your appointment window is 9:00 AM–12:00 PM.",
    status: "processing",
    claimToken: CLAIM_TOKEN,
    idempotencyKey: "auto:job:1:confirmation:email",
    attemptCount: 1,
    queuedAt: "2026-07-21T12:59:00.000Z",
    processingAt: "2026-07-21T13:00:30.000Z",
    ...overrides
  };
}
