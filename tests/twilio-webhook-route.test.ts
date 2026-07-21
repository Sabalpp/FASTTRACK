import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const routeHarness = vi.hoisted(() => ({
  getSupabaseAdminClient: vi.fn()
}));

vi.mock("@/lib/supabase-admin", () => ({
  getSupabaseAdminClient: routeHarness.getSupabaseAdminClient
}));

import { POST } from "@/app/api/webhooks/twilio/route";
import { createTwilioFormSignature } from "@/lib/twilio-webhooks";

const ACCOUNT_SID = `AC${"a".repeat(32)}`;
const MESSAGE_SID = `SM${"b".repeat(32)}`;
const AUTH_TOKEN = "primary-auth-token";
const PUBLIC_URL = "https://fasttrack.example.com/api/webhooks/twilio";
const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";
const NOTIFICATION_ID = "22222222-2222-4222-8222-222222222222";

describe("Twilio webhook route", () => {
  beforeEach(() => {
    routeHarness.getSupabaseAdminClient.mockReset();
    vi.stubEnv("TWILIO_ACCOUNT_SID", ACCOUNT_SID);
    vi.stubEnv("TWILIO_AUTH_TOKEN", AUTH_TOKEN);
    vi.stubEnv("TWILIO_WEBHOOK_PUBLIC_URL", PUBLIC_URL);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects unsigned and tampered requests before creating an admin client", async () => {
    const unsigned = request(new URLSearchParams({
      AccountSid: ACCOUNT_SID,
      OptOutType: "STOP",
      From: "+17035551212",
      MessageSid: MESSAGE_SID
    }), "not-a-valid-signature");

    const response = await POST(unsigned);

    expect(response.status).toBe(403);
    expect(await response.text()).toBe("Webhook signature is invalid.");
    expect(routeHarness.getSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it("fails closed when service-role Supabase configuration is unavailable", async () => {
    routeHarness.getSupabaseAdminClient.mockReturnValue(null);

    const response = await POST(signedRequest({
      OptOutType: "STOP",
      From: "+17035551212",
      MessageSid: MESSAGE_SID
    }));

    expect(response.status).toBe(503);
    expect(await response.text()).toBe("Webhook service is not configured.");
  });

  it.each(["STOP", "START"])("requires a valid MessageSid for Advanced Opt-Out %s", async (keyword) => {
    const database = createDatabase();
    routeHarness.getSupabaseAdminClient.mockReturnValue(database.client);

    const response = await POST(signedRequest({
      OptOutType: keyword,
      From: "+17035551212"
    }));

    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Invalid webhook payload.");
    expect(database.eventInsert).not.toHaveBeenCalled();
    expect(database.rpc).not.toHaveBeenCalled();
  });

  it("records STOP through a durable inbox event and marks it processed", async () => {
    const database = createDatabase();
    routeHarness.getSupabaseAdminClient.mockReturnValue(database.client);

    const response = await POST(signedRequest({
      OptOutType: "STOP",
      From: "+1 (703) 555-1212",
      Body: "STOP",
      MessageSid: MESSAGE_SID
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/xml; charset=utf-8");
    expect(await response.text()).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
    );
    expect(database.eventInsert).toHaveBeenCalledExactlyOnceWith({
      event_key: `optout:${MESSAGE_SID}:stop`,
      event_type: "advanced_opt_out",
      message_sid: MESSAGE_SID,
      status: "stop"
    });
    expect(database.rpc).toHaveBeenCalledWith(
      "record_customer_sms_consent_from_provider",
      {
        p_phone: "7035551212",
        p_status: "opted_out",
        p_source: "twilio_stop",
        p_customer_id: null
      }
    );
    expectProcessed(database, `optout:${MESSAGE_SID}:stop`);
  });

  it("records START and lets Twilio handle HELP without emitting a second reply", async () => {
    const database = createDatabase();
    routeHarness.getSupabaseAdminClient.mockReturnValue(database.client);

    const startResponse = await POST(signedRequest({
      OptOutType: "START",
      From: "+17035551212",
      MessageSid: MESSAGE_SID
    }));
    const helpResponse = await POST(signedRequest({
      OptOutType: "HELP",
      From: "+17035551212"
    }));

    expect(startResponse.status).toBe(200);
    expect(helpResponse.status).toBe(200);
    expect(await helpResponse.text()).not.toContain("Message");
    expect(database.rpc).toHaveBeenCalledWith(
      "record_customer_sms_consent_from_provider",
      {
        p_phone: "7035551212",
        p_status: "opted_in",
        p_source: "twilio_start",
        p_customer_id: null
      }
    );
    expectProcessed(database, `optout:${MESSAGE_SID}:start`);
  });

  it("stores a delivery callback and marks its inbox event processed", async () => {
    const database = createDatabase({
      notificationLookups: [notificationRow({ provider_status: "sent" })]
    });
    routeHarness.getSupabaseAdminClient.mockReturnValue(database.client);

    const response = await POST(signedRequest({
      MessageSid: MESSAGE_SID,
      MessageStatus: "delivered",
      ErrorCode: "0",
      To: "+17035551212"
    }));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
    expect(database.eventInsert).toHaveBeenCalledExactlyOnceWith({
      event_key: `status:${MESSAGE_SID}:delivered:0`,
      event_type: "message_status",
      message_sid: MESSAGE_SID,
      status: "delivered"
    });
    expect(database.notificationLookupEq).toHaveBeenNthCalledWith(1, "provider", "twilio");
    expect(database.notificationLookupEq).toHaveBeenNthCalledWith(2, "provider_message_id", MESSAGE_SID);
    expect(database.notificationUpdate).toHaveBeenCalledOnce();
    const update = database.notificationUpdate.mock.calls[0][0] as Record<string, unknown>;
    expect(update).toMatchObject({
      provider_status: "delivered",
      provider_error_code: null,
      status: "accepted",
      failed_at: null,
      last_error_code: null,
      error_message: null,
      last_error_at: null
    });
    expect(update.provider_status_at).toEqual(expect.any(String));
    expect(Number.isNaN(Date.parse(String(update.provider_status_at)))).toBe(false);
    expect(database.notificationUpdateEq).toHaveBeenCalledWith("id", NOTIFICATION_ID);
    expect(database.notificationUpdateEq).toHaveBeenCalledWith("provider_status", "sent");
    expectProcessed(database, `status:${MESSAGE_SID}:delivered:0`);
  });

  it("marks a failed delivery and records Twilio 21610 as an audited opt-out", async () => {
    const database = createDatabase({
      notificationLookups: [notificationRow({ provider_status: "sent" })]
    });
    routeHarness.getSupabaseAdminClient.mockReturnValue(database.client);

    const response = await POST(signedRequest({
      MessageSid: MESSAGE_SID,
      MessageStatus: "undelivered",
      ErrorCode: "21610",
      To: "+17035551212"
    }));

    expect(response.status).toBe(200);
    expect(database.rpc).toHaveBeenCalledWith(
      "record_customer_sms_consent_from_provider",
      {
        p_phone: "7035551212",
        p_status: "opted_out",
        p_source: "twilio_error_21610",
        p_customer_id: CUSTOMER_ID
      }
    );
    expect(database.notificationUpdate).toHaveBeenCalledWith(expect.objectContaining({
      provider_status: "undelivered",
      provider_error_code: "21610",
      status: "failed",
      last_error_code: "twilio_21610",
      error_message: "SMS delivery failed."
    }));
    expectProcessed(database, `status:${MESSAGE_SID}:undelivered:21610`);
  });

  it("keeps the inbox event pending and returns 503 when the notification acknowledgement is missing", async () => {
    const database = createDatabase({ notificationLookups: [null] });
    routeHarness.getSupabaseAdminClient.mockReturnValue(database.client);

    const response = await POST(signedRequest({
      MessageSid: MESSAGE_SID,
      MessageStatus: "failed",
      ErrorCode: "21610",
      To: "+1 703 555 1212"
    }));

    expect(response.status).toBe(503);
    expect(await response.text()).toBe("Notification acknowledgement is still pending.");
    expect(database.rpc).toHaveBeenCalledWith(
      "record_customer_sms_consent_from_provider",
      {
        p_phone: "7035551212",
        p_status: "opted_out",
        p_source: "twilio_error_21610",
        p_customer_id: null
      }
    );
    expect(database.notificationUpdate).not.toHaveBeenCalled();
    expectNotProcessed(database);
  });

  it("treats an already-processed duplicate event as a no-op", async () => {
    const database = createDatabase({
      eventInsertError: { code: "23505" },
      existingEvent: {
        received_at: "2026-07-21T13:00:00.000Z",
        processed_at: "2026-07-21T13:00:01.000Z"
      }
    });
    routeHarness.getSupabaseAdminClient.mockReturnValue(database.client);

    const response = await POST(signedRequest({
      MessageSid: MESSAGE_SID,
      MessageStatus: "delivered",
      To: "+17035551212"
    }));

    expect(response.status).toBe(200);
    expect(database.eventSelect).toHaveBeenCalledExactlyOnceWith("received_at,processed_at");
    expect(database.eventLookupEq).toHaveBeenCalledWith(
      "event_key",
      `status:${MESSAGE_SID}:delivered:0`
    );
    expect(database.notificationSelect).not.toHaveBeenCalled();
    expect(database.notificationUpdate).not.toHaveBeenCalled();
    expectNotProcessed(database);
  });

  it("returns 503 for a duplicate inbox event that is still being processed", async () => {
    const database = createDatabase({
      eventInsertError: { code: "23505" },
      existingEvent: {
        received_at: new Date(Date.now() - 1_000).toISOString(),
        processed_at: null
      }
    });
    routeHarness.getSupabaseAdminClient.mockReturnValue(database.client);

    const response = await POST(signedRequest({
      MessageSid: MESSAGE_SID,
      MessageStatus: "delivered",
      To: "+17035551212"
    }));

    expect(response.status).toBe(503);
    expect(await response.text()).toBe("Webhook event is already processing.");
    expect(database.notificationSelect).not.toHaveBeenCalled();
    expectNotProcessed(database);
  });

  it("refetches and retries when a compare-and-set status update loses a race", async () => {
    const database = createDatabase({
      notificationLookups: [
        notificationRow({ provider_status: "sent" }),
        notificationRow({ provider_status: "sending" })
      ],
      notificationUpdateResults: [
        { data: null, error: null },
        { data: { id: NOTIFICATION_ID }, error: null }
      ]
    });
    routeHarness.getSupabaseAdminClient.mockReturnValue(database.client);

    const response = await POST(signedRequest({
      MessageSid: MESSAGE_SID,
      MessageStatus: "delivered",
      To: "+17035551212"
    }));

    expect(response.status).toBe(200);
    expect(database.notificationLookupMaybeSingle).toHaveBeenCalledTimes(2);
    expect(database.notificationUpdate).toHaveBeenCalledTimes(2);
    expect(database.notificationUpdateEq).toHaveBeenCalledWith("provider_status", "sent");
    expect(database.notificationUpdateEq).toHaveBeenCalledWith("provider_status", "sending");
    expectProcessed(database, `status:${MESSAGE_SID}:delivered:0`);
  });

  it("does not regress an already terminal provider status and still completes the inbox event", async () => {
    const database = createDatabase({
      notificationLookups: [notificationRow({ provider_status: "delivered" })]
    });
    routeHarness.getSupabaseAdminClient.mockReturnValue(database.client);

    const response = await POST(signedRequest({
      MessageSid: MESSAGE_SID,
      MessageStatus: "sent",
      To: "+17035551212"
    }));

    expect(response.status).toBe(200);
    expect(database.notificationUpdate).not.toHaveBeenCalled();
    expectProcessed(database, `status:${MESSAGE_SID}:sent:0`);
  });

  it("rejects duplicate security-sensitive fields even when the request is signed", async () => {
    const database = createDatabase();
    routeHarness.getSupabaseAdminClient.mockReturnValue(database.client);
    const params = baseParams();
    params.append("AccountSid", ACCOUNT_SID);
    params.set("OptOutType", "STOP");
    params.set("From", "+17035551212");
    params.set("MessageSid", MESSAGE_SID);

    const response = await POST(request(params, signature(params)));

    expect(response.status).toBe(403);
    expect(database.rpc).not.toHaveBeenCalled();
    expect(database.from).not.toHaveBeenCalled();
  });
});

type QueryResult<T> = {
  data: T;
  error: { code?: string; message?: string } | null;
};

type DatabaseOptions = {
  notificationLookups?: Array<Record<string, unknown> | null>;
  notificationLookupError?: { code?: string; message?: string } | null;
  notificationUpdateResults?: Array<QueryResult<{ id: string } | null>>;
  eventInsertError?: { code?: string; message?: string } | null;
  existingEvent?: { received_at: string; processed_at: string | null } | null;
  eventLookupError?: { code?: string; message?: string } | null;
  markProcessedError?: { code?: string; message?: string } | null;
  rpcError?: { code?: string; message?: string } | null;
};

function createDatabase(options: DatabaseOptions = {}) {
  const notificationRows = [...(options.notificationLookups ?? [notificationRow()])];
  let lastNotification = notificationRows.at(-1) ?? null;
  const notificationLookupMaybeSingle = vi.fn(async () => {
    if (notificationRows.length > 0) lastNotification = notificationRows.shift() ?? null;
    return {
      data: lastNotification,
      error: options.notificationLookupError ?? null
    };
  });
  const notificationLookupEq = vi.fn();
  const notificationLookupQuery = {
    eq: notificationLookupEq,
    maybeSingle: notificationLookupMaybeSingle
  };
  notificationLookupEq.mockReturnValue(notificationLookupQuery);
  const notificationSelect = vi.fn(() => notificationLookupQuery);

  const notificationUpdateResults = [...(options.notificationUpdateResults ?? [{
    data: { id: NOTIFICATION_ID },
    error: null
  }])];
  let lastNotificationUpdateResult: QueryResult<{ id: string } | null> =
    notificationUpdateResults.at(-1) ?? { data: { id: NOTIFICATION_ID }, error: null };
  const notificationUpdateMaybeSingle = vi.fn(async () => {
    if (notificationUpdateResults.length > 0) {
      lastNotificationUpdateResult = notificationUpdateResults.shift()!;
    }
    return lastNotificationUpdateResult;
  });
  const notificationUpdateEq = vi.fn();
  const notificationUpdateIs = vi.fn();
  const notificationUpdateSelect = vi.fn();
  const notificationUpdateQuery = {
    eq: notificationUpdateEq,
    is: notificationUpdateIs,
    select: notificationUpdateSelect,
    maybeSingle: notificationUpdateMaybeSingle
  };
  notificationUpdateEq.mockReturnValue(notificationUpdateQuery);
  notificationUpdateIs.mockReturnValue(notificationUpdateQuery);
  notificationUpdateSelect.mockReturnValue(notificationUpdateQuery);
  const notificationUpdate = vi.fn((_values: Record<string, unknown>) => notificationUpdateQuery);

  const eventInsert = vi.fn(async (_values: Record<string, unknown>) => ({
    error: options.eventInsertError ?? null
  }));
  const eventLookupEq = vi.fn();
  const eventLookupMaybeSingle = vi.fn(async () => ({
    data: options.existingEvent ?? null,
    error: options.eventLookupError ?? null
  }));
  const eventLookupQuery = {
    eq: eventLookupEq,
    maybeSingle: eventLookupMaybeSingle
  };
  eventLookupEq.mockReturnValue(eventLookupQuery);
  const eventSelect = vi.fn(() => eventLookupQuery);

  const from = vi.fn((table: string) => {
    if (table === "appointment_notifications") {
      return { select: notificationSelect, update: notificationUpdate };
    }
    if (table === "twilio_webhook_events") {
      return { insert: eventInsert, select: eventSelect };
    }
    throw new Error(`Unexpected table: ${table}`);
  });
  const rpc = vi.fn(async (name: string) => name === "mark_twilio_webhook_event_processed"
    ? { data: null, error: options.markProcessedError ?? null }
    : {
        data: [{ updated_customer_id: CUSTOMER_ID }],
        error: options.rpcError ?? null
      });
  const client = { from, rpc } as unknown as SupabaseClient;

  return {
    client,
    from,
    rpc,
    notificationSelect,
    notificationLookupEq,
    notificationLookupMaybeSingle,
    notificationUpdate,
    notificationUpdateEq,
    notificationUpdateIs,
    notificationUpdateSelect,
    notificationUpdateMaybeSingle,
    eventInsert,
    eventSelect,
    eventLookupEq,
    eventLookupMaybeSingle
  };
}

function expectProcessed(
  database: ReturnType<typeof createDatabase>,
  eventKey: string
) {
  expect(database.rpc.mock.calls.filter(
    ([name]) => name === "mark_twilio_webhook_event_processed"
  )).toEqual([[
    "mark_twilio_webhook_event_processed",
    { p_event_key: eventKey }
  ]]);
}

function expectNotProcessed(database: ReturnType<typeof createDatabase>) {
  expect(database.rpc.mock.calls.some(
    ([name]) => name === "mark_twilio_webhook_event_processed"
  )).toBe(false);
}

function notificationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: NOTIFICATION_ID,
    customer_id: CUSTOMER_ID,
    status: "accepted",
    provider_status: null,
    ...overrides
  };
}

function baseParams(): URLSearchParams {
  return new URLSearchParams({ AccountSid: ACCOUNT_SID });
}

function signedRequest(values: Record<string, string>): Request {
  const params = baseParams();
  for (const [name, value] of Object.entries(values)) params.set(name, value);
  return request(params, signature(params));
}

function signature(params: URLSearchParams): string {
  return createTwilioFormSignature({
    authToken: AUTH_TOKEN,
    publicUrl: PUBLIC_URL,
    params
  });
}

function request(params: URLSearchParams, twilioSignature: string): Request {
  return new Request("http://localhost/api/webhooks/twilio", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Twilio-Signature": twilioSignature
    },
    body: params.toString()
  });
}
