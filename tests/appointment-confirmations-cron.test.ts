import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const cronHarness = vi.hoisted(() => ({
  getSupabaseAdminClient: vi.fn(),
  deliver: vi.fn()
}));

vi.mock("@/lib/supabase-admin", () => ({
  getSupabaseAdminClient: cronHarness.getSupabaseAdminClient
}));

vi.mock("@/lib/appointment-confirmation-delivery-server", () => ({
  deliverClaimedAppointmentNotification: cronHarness.deliver
}));

import { GET } from "@/app/api/cron/appointment-confirmations/route";

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const JOB_ID_TWO = "22222222-2222-4222-8222-222222222222";
const JOB_ID_THREE = "33333333-3333-4333-8333-333333333333";

describe("appointment confirmation cron worker", () => {
  const previousSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.CRON_SECRET = "test-cron-secret";
    cronHarness.getSupabaseAdminClient.mockReset();
    cronHarness.deliver.mockReset();
  });

  afterEach(() => {
    if (previousSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previousSecret;
  });

  it("rejects requests without the cron bearer secret", async () => {
    const response = await GET(new Request("https://example.test/api/cron/appointment-confirmations"));

    expect(response.status).toBe(401);
    expect(cronHarness.getSupabaseAdminClient).not.toHaveBeenCalled();
  });

  it("claims queued jobs with the service client and returns aggregate counts", async () => {
    const database = createCronDatabase();
    cronHarness.getSupabaseAdminClient.mockReturnValue(database.client);
    cronHarness.deliver
      .mockResolvedValueOnce({ notificationId: "notification-email", status: "accepted" })
      .mockResolvedValueOnce({ notificationId: "notification-sms", status: "failed", providerErrorCode: "provider_rejected" });

    const response = await GET(new Request(
      "https://example.test/api/cron/appointment-confirmations",
      { headers: { Authorization: "Bearer test-cron-secret" } }
    ));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      jobsInspected: 1,
      claimedCount: 2,
      acceptedCount: 1,
      failedCount: 1
    });
    expect(database.rpc).toHaveBeenCalledExactlyOnceWith("claim_job_confirmations", {
      p_job_id: JOB_ID,
      p_include_failed: true
    });
    expect(cronHarness.deliver).toHaveBeenCalledTimes(2);
    expect(database.query.select).toHaveBeenCalledExactlyOnceWith("job_id,status,last_error_code");
    expect(database.query.in).toHaveBeenCalledExactlyOnceWith(
      "status",
      ["queued", "processing", "failed"]
    );
    expect(database.query.not).toHaveBeenCalledExactlyOnceWith("job_id", "is", null);
    expect(database.query.lte).toHaveBeenCalledWith("available_at", expect.any(String));
    expect(database.query.order).toHaveBeenCalledExactlyOnceWith("queued_at", { ascending: true });
    expect(database.query.limit).toHaveBeenCalledExactlyOnceWith(100);
  });

  it("claims and delivers at most two jobs concurrently before starting the next batch", async () => {
    const database = createCronDatabase({
      pendingRows: [JOB_ID, JOB_ID_TWO, JOB_ID_THREE].map((jobId) => ({
        job_id: jobId,
        status: "queued",
        last_error_code: null
      })),
      claimedByJob: {
        [JOB_ID]: [notificationRow("email", JOB_ID)],
        [JOB_ID_TWO]: [notificationRow("email", JOB_ID_TWO)],
        [JOB_ID_THREE]: [notificationRow("email", JOB_ID_THREE)]
      }
    });
    cronHarness.getSupabaseAdminClient.mockReturnValue(database.client);
    const firstDelivery = deferred<DeliveryResult>();
    const secondDelivery = deferred<DeliveryResult>();
    const thirdDelivery = deferred<DeliveryResult>();
    const deliveryByJob = new Map([
      [JOB_ID, firstDelivery],
      [JOB_ID_TWO, secondDelivery],
      [JOB_ID_THREE, thirdDelivery]
    ]);
    cronHarness.deliver.mockImplementation((_client: unknown, notification: { jobId?: string }) => {
      const delivery = deliveryByJob.get(String(notification.jobId));
      if (!delivery) throw new Error(`Unexpected notification job: ${String(notification.jobId)}`);
      return delivery.promise;
    });

    const responsePromise = GET(new Request(
      "https://example.test/api/cron/appointment-confirmations",
      { headers: { Authorization: "Bearer test-cron-secret" } }
    ));

    await vi.waitFor(() => expect(database.rpc).toHaveBeenCalledTimes(2));
    expect(database.rpc).toHaveBeenNthCalledWith(1, "claim_job_confirmations", {
      p_job_id: JOB_ID,
      p_include_failed: true
    });
    expect(database.rpc).toHaveBeenNthCalledWith(2, "claim_job_confirmations", {
      p_job_id: JOB_ID_TWO,
      p_include_failed: true
    });
    await vi.waitFor(() => expect(cronHarness.deliver).toHaveBeenCalledTimes(2));
    expect(database.rpc).toHaveBeenCalledTimes(2);

    firstDelivery.resolve({ notificationId: "first", status: "accepted" });
    secondDelivery.resolve({ notificationId: "second", status: "failed" });

    await vi.waitFor(() => expect(database.rpc).toHaveBeenCalledTimes(3));
    expect(database.rpc).toHaveBeenNthCalledWith(3, "claim_job_confirmations", {
      p_job_id: JOB_ID_THREE,
      p_include_failed: true
    });
    await vi.waitFor(() => expect(cronHarness.deliver).toHaveBeenCalledTimes(3));
    thirdDelivery.resolve({ notificationId: "third", status: "accepted" });

    const response = await responsePromise;
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      jobsInspected: 3,
      claimedCount: 3,
      acceptedCount: 2,
      failedCount: 1
    });
  });
});

type CronDatabaseOptions = {
  pendingRows?: Array<Record<string, unknown>>;
  claimedByJob?: Record<string, Array<Record<string, unknown>>>;
};

type DeliveryResult = {
  notificationId: string;
  status: "accepted" | "failed";
};

function createCronDatabase(options: CronDatabaseOptions = {}) {
  const query = {
    select: vi.fn(),
    in: vi.fn(),
    not: vi.fn(),
    lte: vi.fn(),
    order: vi.fn(),
    limit: vi.fn()
  };
  query.select.mockReturnValue(query);
  query.in.mockReturnValue(query);
  query.not.mockReturnValue(query);
  query.lte.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.limit.mockResolvedValue({
    data: options.pendingRows ?? [
      { job_id: JOB_ID, status: "queued", last_error_code: null },
      { job_id: JOB_ID, status: "failed", last_error_code: "provider_temporary_failure" },
      { job_id: JOB_ID_TWO, status: "failed", last_error_code: "sms_delivery_state_unknown" },
      { job_id: JOB_ID_THREE, status: "failed", last_error_code: "provider_permanent_failure" }
    ],
    error: null
  });

  const rpc = vi.fn(async (_name: string, input: { p_job_id?: string }) => ({
    data: input.p_job_id && options.claimedByJob
      ? options.claimedByJob[input.p_job_id] ?? []
      : [notificationRow("email"), notificationRow("sms")],
    error: null
  }));
  const client = {
    from: vi.fn(() => query),
    rpc
  } as unknown as SupabaseClient;
  return { client, rpc, query };
}

function notificationRow(channel: "email" | "sms", jobId = JOB_ID) {
  return {
    id: `notification-${jobId}-${channel}`,
    job_id: jobId,
    customer_id: "22222222-2222-4222-8222-222222222222",
    job_revision: 1,
    event_type: "confirmation",
    channel,
    destination: channel === "email" ? "customer@example.com" : "+17035551212",
    customer_name: "Customer",
    scheduled_start_at: "2026-07-21T13:00:00.000Z",
    scheduled_end_at: "2026-07-21T16:00:00.000Z",
    service_address: "123 Main St",
    message_subject: channel === "email" ? "Appointment" : "",
    message_body: "Server snapshot",
    status: "processing",
    provider: null,
    provider_message_id: null,
    provider_status: null,
    provider_status_at: null,
    claim_token: "33333333-3333-4333-8333-333333333333",
    idempotency_key: `auto:${channel}`,
    attempt_count: 1,
    last_error_code: null,
    error_message: null,
    queued_at: "2026-07-21T12:59:00.000Z",
    processing_at: "2026-07-21T13:00:30.000Z",
    accepted_at: null,
    failed_at: null,
    created_by: null
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
