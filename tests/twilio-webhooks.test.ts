import { createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  createTwilioFormSignature,
  getTwilioWebhookConfiguration,
  recordTwilioOptOut,
  recordTwilioSmsConsent,
  TwilioWebhookConfigurationError,
  TwilioWebhookPersistenceError,
  validateTwilioFormSignature
} from "@/lib/twilio-webhooks";

describe("Twilio form webhook signatures", () => {
  it("matches Twilio's published HMAC-SHA1 test vector", () => {
    const params = new URLSearchParams({
      CallSid: "CA1234567890ABCDE",
      Caller: "+14158675310",
      Digits: "1234",
      From: "+14158675310",
      To: "+18005551212"
    });

    expect(createTwilioFormSignature({
      authToken: "12345",
      publicUrl: "https://example.com/myapp.php?foo=1&bar=2",
      params
    })).toBe("L/OH5YylLD5NRKLltdqwSvS0BnU=");
  });

  it("sorts parameter names and unique duplicate values like Twilio's SDK", () => {
    const params = new URLSearchParams([
      ["Tags", "beta"],
      ["Alpha", "one"],
      ["Tags", "alpha"],
      ["Tags", "beta"]
    ]);
    const payload = "https://example.com/webhookAlphaoneTagsalphaTagsbeta";
    const expected = createHmac("sha1", "secret").update(payload).digest("base64");

    expect(createTwilioFormSignature({
      authToken: "secret",
      publicUrl: "https://example.com/webhook",
      params
    })).toBe(expected);
  });

  it("rejects missing, modified, and length-mismatched signatures", () => {
    const params = new URLSearchParams({ MessageSid: `SM${"a".repeat(32)}` });
    const signature = createTwilioFormSignature({
      authToken: "secret",
      publicUrl: "https://example.com/webhook",
      params
    });

    expect(validateTwilioFormSignature({
      authToken: "secret",
      publicUrl: "https://example.com/webhook",
      params,
      signature
    })).toBe(true);
    params.set("MessageSid", `SM${"b".repeat(32)}`);
    expect(validateTwilioFormSignature({
      authToken: "secret",
      publicUrl: "https://example.com/webhook",
      params,
      signature
    })).toBe(false);
    expect(validateTwilioFormSignature({
      authToken: "secret",
      publicUrl: "https://example.com/webhook",
      params,
      signature: "short"
    })).toBe(false);
    expect(validateTwilioFormSignature({
      authToken: "secret",
      publicUrl: "https://example.com/webhook",
      params,
      signature: null
    })).toBe(false);
  });
});

describe("Twilio webhook configuration", () => {
  it("requires an account SID, primary auth token, and explicit HTTPS public URL", () => {
    const accountSid = `AC${"a".repeat(32)}`;
    expect(getTwilioWebhookConfiguration({
      TWILIO_ACCOUNT_SID: accountSid,
      TWILIO_AUTH_TOKEN: "primary-auth-token",
      TWILIO_WEBHOOK_PUBLIC_URL: "https://fasttrack.example.com/api/webhooks/twilio"
    })).toEqual({
      accountSid,
      authToken: "primary-auth-token",
      publicUrl: "https://fasttrack.example.com/api/webhooks/twilio"
    });

    expect(() => getTwilioWebhookConfiguration({
      TWILIO_ACCOUNT_SID: accountSid,
      TWILIO_API_KEY_SECRET: "not-the-webhook-signing-key",
      TWILIO_WEBHOOK_PUBLIC_URL: "https://fasttrack.example.com/api/webhooks/twilio"
    })).toThrow(TwilioWebhookConfigurationError);
    expect(() => getTwilioWebhookConfiguration({
      TWILIO_ACCOUNT_SID: accountSid,
      TWILIO_AUTH_TOKEN: "primary-auth-token",
      TWILIO_WEBHOOK_PUBLIC_URL: "http://fasttrack.example.com/api/webhooks/twilio"
    })).toThrow(TwilioWebhookConfigurationError);
  });
});

describe("Twilio SMS consent persistence", () => {
  it("normalizes STOP phone numbers through the service-only consent RPC", async () => {
    const rpc = vi.fn(async () => ({
      data: [{ updated_customer_id: "11111111-1111-4111-8111-111111111111" }],
      error: null
    }));
    const admin = { rpc } as unknown as SupabaseClient;

    await expect(recordTwilioOptOut(admin, {
      phone: "+1 (703) 555-1212",
      source: "twilio_stop"
    })).resolves.toEqual(["11111111-1111-4111-8111-111111111111"]);
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "record_customer_sms_consent_from_provider",
      {
        p_phone: "7035551212",
        p_status: "opted_out",
        p_source: "twilio_stop",
        p_customer_id: null
      }
    );
  });

  it("supports START and targeted 21610 updates without leaking database errors", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "private database detail" } });
    const admin = { rpc } as unknown as SupabaseClient;

    await expect(recordTwilioSmsConsent(admin, {
      phone: "7035551212",
      status: "opted_in",
      source: "twilio_start"
    })).resolves.toEqual([]);
    await expect(recordTwilioOptOut(admin, {
      customerId: "22222222-2222-4222-8222-222222222222",
      source: "twilio_error_21610"
    })).rejects.toEqual(new TwilioWebhookPersistenceError());
    expect(rpc).toHaveBeenLastCalledWith(
      "record_customer_sms_consent_from_provider",
      {
        p_phone: null,
        p_status: "opted_out",
        p_source: "twilio_error_21610",
        p_customer_id: "22222222-2222-4222-8222-222222222222"
      }
    );
  });

});
