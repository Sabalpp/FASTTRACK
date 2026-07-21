import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppointmentConfirmationCard } from "@/components/AppointmentConfirmationCard";
import type { AppointmentNotificationSummary } from "@/lib/types";

describe("AppointmentConfirmationCard", () => {
  it("distinguishes provider acceptance from confirmed SMS delivery", () => {
    render(
      <AppointmentConfirmationCard
        notifications={[
          notification({ channel: "email", maskedDestination: "c***@example.com" }),
          notification({
            id: "sms-delivered",
            channel: "sms",
            maskedDestination: "***-***-1212",
            providerStatus: "delivered",
            providerStatusAt: "2026-07-21T13:02:00.000Z"
          })
        ]}
        loading={false}
        busy={false}
        canManage
        activeJob
        onRetry={vi.fn()}
        onResend={vi.fn()}
      />
    );

    expect(screen.getAllByText("Accepted").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Delivered").length).toBeGreaterThan(0);
    expect(screen.getByText("The delivery provider accepted the latest confirmation.")).toBeTruthy();
  });

  it("offers an explicit new send instead of a futile retry for a permanent provider failure", () => {
    const onResend = vi.fn();
    render(
      <AppointmentConfirmationCard
        notifications={[
          notification({
            status: "failed",
            lastErrorCode: "provider_permanent_failure",
            errorMessage: "SMS provider rejected the request.",
            failedAt: "2026-07-21T13:02:00.000Z"
          })
        ]}
        loading={false}
        busy={false}
        canManage
        activeJob
        onRetry={vi.fn()}
        onResend={onResend}
      />
    );

    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
    const resend = screen.getByRole("button", { name: "Send a new confirmation" });
    fireEvent.click(resend);
    expect(onResend).toHaveBeenCalledOnce();
    expect(screen.getAllByText("SMS provider rejected the request.").length).toBeGreaterThan(0);
  });

  it("suppresses actions while a request-level error is being shown", () => {
    render(
      <AppointmentConfirmationCard
        notifications={[]}
        loading={false}
        busy={false}
        error="Confirmation history could not be refreshed."
        canManage
        activeJob
        onRetry={vi.fn()}
        onResend={vi.fn()}
      />
    );

    expect(screen.getByRole("alert").textContent).toContain("Confirmation history could not be refreshed.");
    expect(screen.queryByRole("button", { name: /send confirmation/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
  });

  it("does not resend an SMS when the provider outcome is unknown", () => {
    render(
      <AppointmentConfirmationCard
        notifications={[
          notification({
            id: "sms-unknown",
            channel: "sms",
            maskedDestination: "***-***-1212",
            status: "failed",
            lastErrorCode: "sms_delivery_state_unknown",
            errorMessage: "Text-message delivery could not be confirmed.",
            failedAt: "2026-07-21T13:02:00.000Z"
          })
        ]}
        loading={false}
        busy={false}
        canManage
        activeJob
        onRetry={vi.fn()}
        onResend={vi.fn()}
      />
    );

    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /send|resend/i })).toBeNull();
    expect(screen.getAllByText("Text-message delivery could not be confirmed.").length).toBeGreaterThan(0);
  });

  it("retries a temporary email failure even when the SMS channel is permanently blocked", () => {
    const onRetry = vi.fn();
    render(
      <AppointmentConfirmationCard
        notifications={[
          notification({
            id: "email-temporary",
            channel: "email",
            status: "failed",
            lastErrorCode: "provider_temporary_failure",
            errorMessage: "Email delivery is temporarily unavailable.",
            failedAt: "2026-07-21T13:03:00.000Z",
            queuedAt: "2026-07-21T13:01:00.000Z"
          }),
          notification({
            id: "sms-opted-out",
            channel: "sms",
            maskedDestination: "***-***-1212",
            status: "failed",
            lastErrorCode: "sms_recipient_opted_out",
            errorMessage: "The customer opted out of text messages.",
            failedAt: "2026-07-21T13:02:00.000Z"
          })
        ]}
        loading={false}
        busy={false}
        canManage
        activeJob
        onRetry={onRetry}
        onResend={vi.fn()}
      />
    );

    const retry = screen.getByRole("button", { name: "Retry failed confirmation" });
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: /send a new confirmation/i })).toBeNull();
  });
});

function notification(
  overrides: Partial<AppointmentNotificationSummary> = {}
): AppointmentNotificationSummary {
  return {
    id: "email-accepted",
    jobRevision: 1,
    eventType: "confirmation",
    channel: "email",
    maskedDestination: "c***@example.com",
    status: "accepted",
    providerStatus: "accepted",
    providerStatusAt: "2026-07-21T13:01:00.000Z",
    attemptCount: 1,
    queuedAt: "2026-07-21T12:59:00.000Z",
    processingAt: "2026-07-21T13:00:00.000Z",
    acceptedAt: "2026-07-21T13:01:00.000Z",
    ...overrides
  };
}
