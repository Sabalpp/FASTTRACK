import { describe, expect, it } from "vitest";
import {
  appointmentTextToHtml,
  buildAppointmentConfirmation,
  buildAppointmentIdempotencyKey,
  formatAppointmentWindow,
  maskAppointmentRecipient,
  normalizeEmailRecipient,
  summarizeAppointmentDeliveries,
  toUsE164Phone
} from "@/lib/appointment-confirmations";

describe("appointment confirmation copy", () => {
  it("formats summer arrival windows explicitly in the New York time zone", () => {
    expect(formatAppointmentWindow(
      "2026-07-21T13:00:00.000Z",
      "2026-07-21T16:00:00.000Z"
    )).toBe("Tuesday, July 21, 2026, 9:00 AM EDT–12:00 PM EDT");
  });

  it("formats cross-day windows using New York calendar dates", () => {
    expect(formatAppointmentWindow(
      "2026-07-22T03:00:00.000Z",
      "2026-07-22T05:00:00.000Z"
    )).toBe("Tuesday, July 21, 2026, 11:00 PM EDT–Wednesday, July 22, 2026, 1:00 AM EDT");
  });

  it("shows the DST offset change without relying on the server time zone", () => {
    expect(formatAppointmentWindow(
      "2026-11-01T05:30:00.000Z",
      "2026-11-01T07:30:00.000Z"
    )).toBe("Sunday, November 1, 2026, 1:30 AM EDT–2:30 AM EST");
  });

  it("builds safe email and SMS copy containing the window and policy", () => {
    const copy = buildAppointmentConfirmation({
      businessName: "Fast Track Repair Service",
      businessPhone: "(703) 899-5615",
      customerName: "Samira <Patel>",
      scheduledAt: "2026-07-21T13:00:00.000Z",
      arrivalWindowEndAt: "2026-07-21T16:00:00.000Z",
      serviceAddress: "123 Main & Oak St",
      policyText: "An adult must be present during the arrival window."
    });

    expect(copy.subject).toBe("Appointment confirmed | Fast Track Repair Service");
    expect(copy.text).toContain("Arrival window: Tuesday, July 21, 2026, 9:00 AM EDT–12:00 PM EDT");
    expect(copy.text).toContain("Policy: An adult must be present during the arrival window.");
    expect(copy.html).toContain("Samira &lt;Patel&gt;");
    expect(copy.html).toContain("123 Main &amp; Oak St");
    expect(copy.html).not.toContain("Samira <Patel>");
    expect(copy.sms).toContain("Reply STOP to opt out.");
  });

  it("converts stored plain-text snapshots to email HTML without trusting customer content", () => {
    expect(appointmentTextToHtml("Hello <script>alert(1)</script>\nSecond line")).toBe(
      "<p>Hello &lt;script&gt;alert(1)&lt;/script&gt;<br />Second line</p>"
    );
  });

  it("rejects invalid or reversed timestamps", () => {
    expect(() => formatAppointmentWindow("not-a-date", "2026-07-21T16:00:00.000Z")).toThrow("Appointment start time is invalid.");
    expect(() => formatAppointmentWindow("2026-07-21T16:00:00.000Z", "2026-07-21T13:00:00.000Z")).toThrow("must be after");
  });
});

describe("appointment delivery helpers", () => {
  it("normalizes only valid US phone numbers to E.164", () => {
    expect(toUsE164Phone("(703) 555-1212")).toBe("+17035551212");
    expect(toUsE164Phone("1-703-555-1212")).toBe("+17035551212");
    expect(toUsE164Phone("555-1212")).toBeUndefined();
  });

  it("validates and masks recipients without returning full contact details", () => {
    expect(normalizeEmailRecipient(" customer@example.com ")).toBe("customer@example.com");
    expect(normalizeEmailRecipient("not-an-email")).toBeUndefined();
    expect(maskAppointmentRecipient("email", "customer@example.com")).toBe("c*******@example.com");
    expect(maskAppointmentRecipient("sms", "703-555-1212")).toBe("***-***-1212");
  });

  it("creates deterministic payload-sensitive idempotency keys without recipient PII", () => {
    const input = {
      jobId: "job-123",
      channel: "email" as const,
      recipient: "customer@example.com",
      scheduledAt: "2026-07-21T13:00:00.000Z",
      arrivalWindowEndAt: "2026-07-21T16:00:00.000Z"
    };
    const first = buildAppointmentIdempotencyKey(input);
    const second = buildAppointmentIdempotencyKey(input);
    const rescheduled = buildAppointmentIdempotencyKey({ ...input, arrivalWindowEndAt: "2026-07-21T17:00:00.000Z" });
    const changedCopy = buildAppointmentIdempotencyKey({ ...input, messageBody: "Updated policy copy" });

    expect(first).toBe(second);
    expect(rescheduled).not.toBe(first);
    expect(changedCopy).not.toBe(first);
    expect(first).not.toContain("customer@example.com");
    expect(first.length).toBeLessThanOrEqual(256);
  });

  it("summarizes channels in a stable customer-service order", () => {
    expect(summarizeAppointmentDeliveries([
      { channel: "sms", status: "skipped" },
      { channel: "email", status: "accepted" }
    ])).toBe("Email accepted · Text skipped");
    expect(summarizeAppointmentDeliveries([])).toBe("No confirmation requested");
  });
});
