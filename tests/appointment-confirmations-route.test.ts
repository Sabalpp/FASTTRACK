import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const routeHarness = vi.hoisted(() => ({
  getAuthenticatedSupabase: vi.fn(),
  sendAppointmentEmail: vi.fn(),
  sendAppointmentSms: vi.fn(),
  getAppointmentProviderConfiguration: vi.fn(),
  getSupabaseAdminClient: vi.fn()
}));

vi.mock("@/lib/supabase-user-server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase-user-server")>();
  return {
    ...actual,
    getAuthenticatedSupabase: routeHarness.getAuthenticatedSupabase
  };
});

vi.mock("@/lib/appointment-providers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/appointment-providers")>();
  return {
    ...actual,
    getAppointmentProviderConfiguration: routeHarness.getAppointmentProviderConfiguration,
    sendAppointmentEmail: routeHarness.sendAppointmentEmail,
    sendAppointmentSms: routeHarness.sendAppointmentSms
  };
});

vi.mock("@/lib/supabase-admin", () => ({
  getSupabaseAdminClient: routeHarness.getSupabaseAdminClient
}));

import { GET, POST } from "@/app/api/jobs/[id]/confirmations/route";
import { AppointmentProviderError } from "@/lib/appointment-providers";
import { RequestAuthError } from "@/lib/supabase-user-server";

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const CUSTOMER_ID = "22222222-2222-4222-8222-222222222222";
const NOTIFICATION_ID = "33333333-3333-4333-8333-333333333333";
const REQUEST_ID = "44444444-4444-4444-8444-444444444444";
const AUTH_USER_ID = "55555555-5555-4555-8555-555555555555";
const ALLOWED_USER_ID = "77777777-7777-4777-8777-777777777777";

describe("appointment confirmation API route", () => {
  beforeEach(() => {
    routeHarness.getAuthenticatedSupabase.mockReset();
    routeHarness.sendAppointmentEmail.mockReset();
    routeHarness.sendAppointmentSms.mockReset();
    routeHarness.getAppointmentProviderConfiguration.mockReset();
    routeHarness.getSupabaseAdminClient.mockReset();
    routeHarness.getAppointmentProviderConfiguration.mockReturnValue({
      email: { configured: true, missing: [] },
      sms: { configured: false, credentialMode: null, missing: ["TWILIO_ACCOUNT_SID"] }
    });
  });

  it("returns the authentication status without touching the notification store", async () => {
    routeHarness.getAuthenticatedSupabase.mockRejectedValue(
      new RequestAuthError("A signed-in Fast Track session is required.", 401)
    );

    const response = await GET(request("GET"), context());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "A signed-in Fast Track session is required." });
    expect(response.headers.get("Cache-Control")).toBe("no-store, max-age=0");
  });

  it("forbids technicians from dispatching confirmations before queue access", async () => {
    const database = createDatabase();
    routeHarness.getAuthenticatedSupabase.mockResolvedValue(auth(database.client, "tech"));

    const response = await POST(request("POST", { mode: "pending" }), context());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Only owners and call-center staff can send customer confirmations."
    });
    expect(database.rpc).not.toHaveBeenCalled();
    expect(routeHarness.sendAppointmentEmail).not.toHaveBeenCalled();
    expect(routeHarness.sendAppointmentSms).not.toHaveBeenCalled();
  });

  it("forbids technicians from reading customer confirmation history", async () => {
    const database = createDatabase();
    routeHarness.getAuthenticatedSupabase.mockResolvedValue(auth(database.client, "tech"));

    const response = await GET(request("GET"), context());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Only owners and call-center staff can view customer confirmations."
    });
    expect(database.from).not.toHaveBeenCalled();
  });

  it("maps GET history through the database mapper and reports provider availability", async () => {
    const historyRow = notificationRow({
      status: "accepted",
      provider: "resend",
      provider_message_id: "email_123",
      provider_status: "delivered",
      provider_status_at: "2026-07-21T13:02:00.000Z",
      accepted_at: "2026-07-21T13:01:00.000Z"
    });
    const database = createDatabase({ history: [historyRow] });
    routeHarness.getAuthenticatedSupabase.mockResolvedValue(auth(database.client, "call_center"));

    const response = await GET(request("GET"), context());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store, max-age=0");
    expect(payload).toEqual({
      notifications: [{
        id: NOTIFICATION_ID,
        jobRevision: 1,
        eventType: "confirmation",
        channel: "email",
        maskedDestination: "c*******@example.com",
        status: "accepted",
        providerStatus: "delivered",
        providerStatusAt: "2026-07-21T13:02:00.000Z",
        attemptCount: 1,
        queuedAt: "2026-07-21T12:59:00.000Z",
        processingAt: "2026-07-21T13:00:30.000Z",
        acceptedAt: "2026-07-21T13:01:00.000Z"
      }],
      processedCount: 0,
      providerConfigured: { email: true, sms: false }
    });
    expect(database.from).toHaveBeenCalledWith("appointment_notifications");
    expect(database.query.select).toHaveBeenCalledWith(expect.not.stringContaining("*"));
    expect(database.query.eq).toHaveBeenCalledWith("job_id", JOB_ID);
    expect(database.query.order).toHaveBeenCalledWith("queued_at", { ascending: false });
    expect(database.query.limit).toHaveBeenCalledWith(100);
  });

  it("returns a service-unavailable response before queueing when the admin client is not configured", async () => {
    const database = createDatabase();
    const session = auth(database.client, "owner");
    routeHarness.getSupabaseAdminClient.mockReturnValue(null);
    routeHarness.getAuthenticatedSupabase.mockResolvedValue(session);

    const response = await POST(request("POST", { mode: "pending" }), context());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Customer confirmation delivery is not configured."
    });
    expect(database.rpc).not.toHaveBeenCalled();
    expect(routeHarness.sendAppointmentEmail).not.toHaveBeenCalled();
    expect(routeHarness.sendAppointmentSms).not.toHaveBeenCalled();
  });

  it("dispatches pending email strictly from the claimed server snapshot", async () => {
    const claimedRow = notificationRow();
    const acceptedHistory = notificationRow({
      status: "accepted",
      provider: "resend",
      provider_message_id: "email_accepted"
    });
    const database = createDatabase({ claimed: [claimedRow], history: [acceptedHistory] });
    routeHarness.getAuthenticatedSupabase.mockResolvedValue(auth(database.client, "owner"));
    routeHarness.sendAppointmentEmail.mockResolvedValue({
      provider: "resend",
      messageId: "email_accepted",
      status: "accepted"
    });

    const response = await POST(request("POST", {
      mode: "pending",
      recipient: "attacker@example.com",
      to: "+17035550000",
      subject: "Forged subject",
      content: "Forged content",
      messageBody: "Forged body"
    }), context());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.processedCount).toBe(1);
    expect(database.rpc).toHaveBeenNthCalledWith(1, "claim_job_confirmations", {
      p_job_id: JOB_ID,
      p_include_failed: false
    });
    expect(routeHarness.sendAppointmentEmail).toHaveBeenCalledExactlyOnceWith({
      to: "customer@example.com",
      subject: "Server appointment subject",
      text: "Server-owned body <do not trust as HTML>",
      html: "<p>Server-owned body &lt;do not trust as HTML&gt;</p>",
      idempotencyKey: "auto:job:1:confirmation:email"
    });
    expect(routeHarness.sendAppointmentSms).not.toHaveBeenCalled();
    expect(database.rpc).toHaveBeenNthCalledWith(2, "complete_job_confirmation", {
      p_notification_id: NOTIFICATION_ID,
      p_claim_token: "66666666-6666-4666-8666-666666666666",
      p_status: "accepted",
      p_provider: "resend",
      p_provider_message_id: "email_accepted",
      p_message_subject: "Server appointment subject",
      p_message_body: "Server-owned body <do not trust as HTML>",
      p_error_message: null,
      p_error_code: null
    });
    expect(JSON.stringify(routeHarness.sendAppointmentEmail.mock.calls)).not.toContain("attacker@example.com");
    expect(JSON.stringify(routeHarness.sendAppointmentEmail.mock.calls)).not.toContain("Forged");
  });

  it("records a sanitized failed completion when the provider rejects a claimed notification", async () => {
    const claimedRow = notificationRow({
      channel: "sms",
      destination: "+17035551212",
      message_subject: "",
      message_body: "Server SMS body. Reply STOP to opt out.",
      idempotency_key: "auto:job:1:confirmation:sms"
    });
    const failedHistory = notificationRow({
      ...claimedRow,
      status: "failed",
      provider: "twilio",
      error_message: "SMS provider rejected the request.",
      failed_at: "2026-07-21T13:01:00.000Z"
    });
    const database = createDatabase({ claimed: [claimedRow], history: [failedHistory] });
    routeHarness.getAuthenticatedSupabase.mockResolvedValue(auth(database.client, "call_center"));
    routeHarness.sendAppointmentSms.mockRejectedValue(new AppointmentProviderError({
      provider: "twilio",
      message: "SMS provider rejected the request.",
      code: "21610",
      status: 400,
      retryable: false
    }));

    const response = await POST(request("POST", { mode: "pending" }), context());

    expect(response.status).toBe(200);
    expect(routeHarness.sendAppointmentSms).toHaveBeenCalledExactlyOnceWith({
      to: "+17035551212",
      body: "Server SMS body. Reply STOP to opt out."
    });
    expect(database.rpc).toHaveBeenNthCalledWith(2, "complete_job_confirmation", {
      p_notification_id: NOTIFICATION_ID,
      p_claim_token: "66666666-6666-4666-8666-666666666666",
      p_status: "failed",
      p_provider: "twilio",
      p_provider_message_id: null,
      p_message_subject: "",
      p_message_body: "Server SMS body. Reply STOP to opt out.",
      p_error_message: "SMS provider rejected the request.",
      p_error_code: "sms_recipient_opted_out"
    });
    expect(JSON.stringify(database.rpc.mock.calls)).not.toContain("21610");
  });

  it("passes a valid caller-provided resend UUID and never accepts recipient or content fields", async () => {
    const database = createDatabase();
    routeHarness.getAuthenticatedSupabase.mockResolvedValue(auth(database.client, "owner"));

    const response = await POST(request("POST", {
      mode: "resend",
      requestId: REQUEST_ID,
      recipient: "attacker@example.com",
      content: "Forged content"
    }), context());

    expect(response.status).toBe(200);
    expect(database.rpc).toHaveBeenNthCalledWith(1, "queue_manual_job_confirmations", {
      p_job_id: JOB_ID,
      p_request_id: REQUEST_ID,
      p_requested_by: ALLOWED_USER_ID
    });
    expect(database.rpc).toHaveBeenNthCalledWith(2, "claim_job_confirmations", {
      p_job_id: JOB_ID,
      p_include_failed: false
    });
    expect(JSON.stringify(database.rpc.mock.calls)).not.toContain("attacker@example.com");
    expect(JSON.stringify(database.rpc.mock.calls)).not.toContain("Forged content");
  });

  it("generates a valid idempotent request UUID when resend omits one", async () => {
    const database = createDatabase();
    routeHarness.getAuthenticatedSupabase.mockResolvedValue(auth(database.client, "owner"));

    const response = await POST(request("POST", { mode: "resend" }), context());

    expect(response.status).toBe(200);
    const queueArguments = database.rpc.mock.calls[0][1] as { p_job_id: string; p_request_id: string; p_requested_by: string };
    expect(queueArguments.p_job_id).toBe(JOB_ID);
    expect(queueArguments.p_requested_by).toBe(ALLOWED_USER_ID);
    expect(queueArguments.p_requested_by).not.toBe(AUTH_USER_ID);
    expect(queueArguments.p_request_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it("rejects an invalid resend request ID before queueing anything", async () => {
    const database = createDatabase();
    routeHarness.getAuthenticatedSupabase.mockResolvedValue(auth(database.client, "owner"));

    const response = await POST(request("POST", {
      mode: "resend",
      requestId: "not-a-uuid"
    }), context());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "A valid resend request ID is required." });
    expect(database.rpc).not.toHaveBeenCalled();
  });
});

type DatabaseOptions = {
  claimed?: Record<string, unknown>[];
  history?: Record<string, unknown>[];
  rpcErrors?: Partial<Record<string, { code?: string; message?: string }>>;
};

function createDatabase(options: DatabaseOptions = {}) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn()
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.limit.mockResolvedValue({ data: options.history ?? [], error: null });

  const rpc = vi.fn(async (name: string, _arguments?: Record<string, unknown>) => {
    const error = options.rpcErrors?.[name];
    if (error) return { data: null, error };
    if (name === "claim_job_confirmations") return { data: options.claimed ?? [], error: null };
    return { data: null, error: null };
  });
  const from = vi.fn(() => query);
  const client = { rpc, from } as unknown as SupabaseClient;
  return { client, rpc, from, query };
}

function auth(client: SupabaseClient, role: "owner" | "call_center" | "tech") {
  routeHarness.getSupabaseAdminClient.mockReturnValue(client);
  return {
    client,
    role,
    authUserId: AUTH_USER_ID,
    allowedUserId: ALLOWED_USER_ID,
    email: `${role}@example.com`
  };
}

function notificationRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: NOTIFICATION_ID,
    job_id: JOB_ID,
    customer_id: CUSTOMER_ID,
    job_revision: 1,
    event_type: "confirmation",
    channel: "email",
    destination: "customer@example.com",
    customer_name: "Customer Name",
    scheduled_start_at: "2026-07-21T13:00:00.000Z",
    scheduled_end_at: "2026-07-21T16:00:00.000Z",
    service_address: "123 Main <Unit 1>",
    message_subject: "Server appointment subject",
    message_body: "Server-owned body <do not trust as HTML>",
    status: "processing",
    provider: null,
    provider_message_id: null,
    provider_status: null,
    provider_status_at: null,
    claim_token: "66666666-6666-4666-8666-666666666666",
    idempotency_key: "auto:job:1:confirmation:email",
    attempt_count: 1,
    error_message: null,
    queued_at: "2026-07-21T12:59:00.000Z",
    processing_at: "2026-07-21T13:00:30.000Z",
    accepted_at: null,
    failed_at: null,
    created_by: ALLOWED_USER_ID,
    ...overrides
  };
}

function request(method: "GET" | "POST", body?: Record<string, unknown>): Request {
  return new Request(`http://localhost/api/jobs/${JOB_ID}/confirmations`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
}

function context(id = JOB_ID) {
  return { params: Promise.resolve({ id }) };
}
