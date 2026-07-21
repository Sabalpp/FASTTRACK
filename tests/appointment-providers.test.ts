import { describe, expect, it, vi } from "vitest";
import {
  AppointmentProviderError,
  getAppointmentProviderConfiguration,
  sendAppointmentEmail,
  sendAppointmentSms
} from "@/lib/appointment-providers";

const accountSid = `AC${"a".repeat(32)}`;
const messagingServiceSid = `MG${"b".repeat(32)}`;

describe("appointment provider configuration", () => {
  it("reports availability without returning any secret values", () => {
    const configuration = getAppointmentProviderConfiguration({
      RESEND_API_KEY: "re_private-secret",
      APPOINTMENT_FROM_EMAIL: "Fast Track <appointments@example.com>",
      TWILIO_ACCOUNT_SID: accountSid,
      TWILIO_AUTH_TOKEN: "primary-auth-token-for-webhooks",
      TWILIO_API_KEY_SID: `SK${"c".repeat(32)}`,
      TWILIO_API_KEY_SECRET: "twilio-private-secret",
      TWILIO_MESSAGING_SERVICE_SID: messagingServiceSid,
      TWILIO_WEBHOOK_PUBLIC_URL: "https://fasttrack.example.com/api/webhooks/twilio"
    });

    expect(configuration).toEqual({
      email: { configured: true, missing: [] },
      sms: { configured: true, credentialMode: "api_key", missing: [] }
    });
    expect(JSON.stringify(configuration)).not.toContain("private-secret");
  });

  it("lists missing server variables without treating partial credentials as configured", () => {
    const configuration = getAppointmentProviderConfiguration({
      TWILIO_ACCOUNT_SID: accountSid,
      TWILIO_API_KEY_SID: `SK${"c".repeat(32)}`
    });

    expect(configuration.email.configured).toBe(false);
    expect(configuration.sms.configured).toBe(false);
    expect(configuration.sms.missing).toContain("TWILIO_API_KEY_SID/TWILIO_API_KEY_SECRET or TWILIO_AUTH_TOKEN");
  });
});

describe("Resend appointment email adapter", () => {
  it("uses the official endpoint, bearer auth, JSON body, and idempotency header", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: "email_123" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    })) as unknown as typeof fetch;

    const result = await sendAppointmentEmail({
      to: "customer@example.com",
      subject: "Appointment confirmed",
      text: "Plain text",
      html: "<p>HTML</p>",
      idempotencyKey: "appointment/confirmation/email/job-1/abc"
    }, {
      env: {
        RESEND_API_KEY: "re_private-secret",
        APPOINTMENT_FROM_EMAIL: "Fast Track <appointments@example.com>"
      },
      fetchImpl
    });

    expect(result).toEqual({ provider: "resend", messageId: "email_123", status: "accepted" });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(url).toBe("https://api.resend.com/emails");
    expect(init?.method).toBe("POST");
    expect(headers.get("Authorization")).toBe("Bearer re_private-secret");
    expect(headers.get("Idempotency-Key")).toBe("appointment/confirmation/email/job-1/abc");
    expect(JSON.parse(String(init?.body))).toEqual({
      from: "Fast Track <appointments@example.com>",
      to: ["customer@example.com"],
      subject: "Appointment confirmed",
      text: "Plain text",
      html: "<p>HTML</p>"
    });
  });

  it("sanitizes provider errors and classifies throttling as retryable", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      name: "rate_limit_exceeded",
      message: "Secret provider details for customer@example.com"
    }), {
      status: 429,
      headers: { "Content-Type": "application/json" }
    })) as unknown as typeof fetch;

    const error = await sendAppointmentEmail({
      to: "customer@example.com",
      subject: "Appointment confirmed",
      text: "Text",
      html: "<p>Text</p>",
      idempotencyKey: "email-job-1"
    }, {
      env: { RESEND_API_KEY: "re_private-secret", APPOINTMENT_FROM_EMAIL: "appointments@example.com" },
      fetchImpl
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AppointmentProviderError);
    expect(error).toMatchObject({
      message: "Email provider rejected the request.",
      provider: "resend",
      code: "rate_limit_exceeded",
      status: 429,
      retryable: true
    });
    expect(JSON.stringify(error)).not.toContain("customer@example.com");
    expect(JSON.stringify(error)).not.toContain("re_private-secret");
  });

  it("only retries the concurrent form of Resend idempotency conflicts", async () => {
    const send = async (name: string): Promise<AppointmentProviderError> => {
      try {
        await sendAppointmentEmail({
          to: "customer@example.com",
          subject: "Appointment confirmed",
          text: "Text",
          html: "<p>Text</p>",
          idempotencyKey: "email-job-1"
        }, {
          env: { RESEND_API_KEY: "re_private-secret", APPOINTMENT_FROM_EMAIL: "appointments@example.com" },
          fetchImpl: vi.fn(async () => new Response(JSON.stringify({ name }), {
            status: 409,
            headers: { "Content-Type": "application/json" }
          })) as unknown as typeof fetch
        });
      } catch (caught) {
        expect(caught).toBeInstanceOf(AppointmentProviderError);
        return caught as AppointmentProviderError;
      }
      throw new Error("Expected Resend to reject the request.");
    };

    expect((await send("concurrent_idempotent_requests")).retryable).toBe(true);
    expect((await send("invalid_idempotent_request")).retryable).toBe(false);
  });
});

describe("Twilio appointment SMS adapter", () => {
  it("uses Basic auth and form encoding with a Messaging Service", async () => {
    const apiKeySid = `SK${"c".repeat(32)}`;
    const apiKeySecret = "twilio-private-secret";
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      sid: `SM${"d".repeat(32)}`,
      status: "accepted"
    }), {
      status: 201,
      headers: { "Content-Type": "application/json" }
    })) as unknown as typeof fetch;

    const result = await sendAppointmentSms({
      to: "(703) 555-1212",
      body: "Your appointment is confirmed. Reply STOP to opt out."
    }, {
      env: {
        TWILIO_ACCOUNT_SID: accountSid,
        TWILIO_AUTH_TOKEN: "primary-auth-token-for-webhooks",
        TWILIO_API_KEY_SID: apiKeySid,
        TWILIO_API_KEY_SECRET: apiKeySecret,
        TWILIO_MESSAGING_SERVICE_SID: messagingServiceSid,
        TWILIO_WEBHOOK_PUBLIC_URL: "https://fasttrack.example.com/api/webhooks/twilio"
      },
      fetchImpl
    });

    expect(result).toEqual({ provider: "twilio", messageId: `SM${"d".repeat(32)}`, status: "accepted" });
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0];
    const headers = new Headers(init?.headers);
    const form = new URLSearchParams(String(init?.body));
    expect(url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`);
    expect(init?.method).toBe("POST");
    expect(headers.get("Content-Type")).toBe("application/x-www-form-urlencoded");
    expect(Buffer.from(headers.get("Authorization")!.replace("Basic ", ""), "base64").toString("utf8")).toBe(`${apiKeySid}:${apiKeySecret}`);
    expect(form.get("To")).toBe("+17035551212");
    expect(form.get("MessagingServiceSid")).toBe(messagingServiceSid);
    expect(form.get("From")).toBeNull();
    expect(form.get("StatusCallback")).toBe(
      "https://fasttrack.example.com/api/webhooks/twilio#rc=3&rp=all&ct=2000&rt=5000&tt=15000"
    );
  });

  it("fails closed before fetch when SMS configuration is missing", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const error = await sendAppointmentSms({ to: "7035551212", body: "Confirmed" }, {
      env: {},
      fetchImpl
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      message: "SMS delivery is not configured.",
      provider: "twilio",
      code: "not_configured",
      retryable: false
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sanitizes Twilio response details while preserving a safe numeric code", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      code: 21610,
      message: "The recipient +17035551212 has opted out"
    }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    })) as unknown as typeof fetch;

    const error = await sendAppointmentSms({ to: "7035551212", body: "Confirmed" }, {
      env: {
        TWILIO_ACCOUNT_SID: accountSid,
        TWILIO_AUTH_TOKEN: "twilio-private-secret",
        TWILIO_MESSAGING_SERVICE_SID: messagingServiceSid,
        TWILIO_WEBHOOK_PUBLIC_URL: "https://fasttrack.example.com/api/webhooks/twilio"
      },
      fetchImpl
    }).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      message: "SMS provider rejected the request.",
      provider: "twilio",
      code: "21610",
      status: 400,
      retryable: false
    });
    expect(JSON.stringify(error)).not.toContain("+17035551212");
    expect(JSON.stringify(error)).not.toContain("twilio-private-secret");
  });
});
