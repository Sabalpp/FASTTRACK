import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const completionHarness = vi.hoisted(() => ({
  requireServerActor: vi.fn(),
  loadJobForActor: vi.fn()
}));

vi.mock("@/lib/server-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server-auth")>();
  return { ...actual, requireServerActor: completionHarness.requireServerActor };
});

vi.mock("@/lib/invoice-server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/invoice-server")>();
  return { ...actual, loadJobForActor: completionHarness.loadJobForActor };
});

import { NextRequest } from "next/server";
import { POST } from "@/app/api/jobs/[id]/complete/route";
import { jobCompletionDocumentHash, type WorkAuthorizationBinding } from "@/lib/invoice-server";
import type { Job, Role } from "@/lib/types";

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const CUSTOMER_ID = "22222222-2222-4222-8222-222222222222";
const TECH_ID = "33333333-3333-4333-8333-333333333333";
const OWNER_ID = "44444444-4444-4444-8444-444444444444";
const SIGNATURE_ID = "55555555-5555-4555-8555-555555555555";
const AUTHORIZATION_ID = "77777777-7777-4777-8777-777777777777";

describe("atomic job completion route", () => {
  beforeEach(() => {
    completionHarness.requireServerActor.mockReset();
    completionHarness.loadJobForActor.mockReset();
  });

  it("passes the exact validated job and active signature snapshot to the completion RPC", async () => {
    const job = arrivedJob();
    const signature = completionSignature(job);
    const database = createDatabase({ signature });
    completionHarness.requireServerActor.mockResolvedValue(actor(database.client, "tech"));
    completionHarness.loadJobForActor.mockResolvedValue(job);

    const response = await POST(request(), context());

    expect(response.status).toBe(200);
    expect(database.rpc).toHaveBeenCalledExactlyOnceWith("complete_job_with_signature", {
      p_job_id: JOB_ID,
      p_expected_status: "in_progress",
      p_expected_customer_id: CUSTOMER_ID,
      p_expected_assigned_tech_id: TECH_ID,
      p_expected_service_address: job.serviceAddress,
      p_expected_description: job.description,
      p_expected_notes: job.notes,
      p_expected_arrived_at: job.arrivedAt,
      p_expected_signature_id: SIGNATURE_ID,
      p_expected_signature_document_sha256: signature.document_sha256,
      p_override_by: null,
      p_override_reason: null
    });
    expect(database.query.update).not.toHaveBeenCalled();
  });

  it("passes a validated owner override through the same atomic RPC when no signature exists", async () => {
    const job = arrivedJob({ assignedTechId: undefined });
    const database = createDatabase({ signature: null, overrideBy: OWNER_ID });
    completionHarness.requireServerActor.mockResolvedValue(actor(database.client, "owner"));
    completionHarness.loadJobForActor.mockResolvedValue(job);

    const response = await POST(request({ overrideReason: "Customer left before signing." }), context());

    expect(response.status).toBe(200);
    expect(database.rpc).toHaveBeenCalledWith("complete_job_with_signature", expect.objectContaining({
      p_expected_assigned_tech_id: null,
      p_expected_signature_id: null,
      p_expected_signature_document_sha256: null,
      p_override_by: OWNER_ID,
      p_override_reason: "Customer left before signing."
    }));
    expect(database.query.update).not.toHaveBeenCalled();
  });

  it("reports a conflict when the locked database snapshot or signature no longer matches", async () => {
    const job = arrivedJob();
    const database = createDatabase({
      signature: completionSignature(job),
      rpcError: { message: "The customer completion signature changed. Review and try again." }
    });
    completionHarness.requireServerActor.mockResolvedValue(actor(database.client, "tech"));
    completionHarness.loadJobForActor.mockResolvedValue(job);

    const response = await POST(request(), context());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      ok: false,
      error: "The customer completion signature changed. Review and try again."
    });
  });

  it("rejects a completion signature linked to a different authorization", async () => {
    const job = arrivedJob();
    const database = createDatabase({
      signature: {
        ...completionSignature(job),
        authorization_signature_id: "88888888-8888-4888-8888-888888888888"
      }
    });
    completionHarness.requireServerActor.mockResolvedValue(actor(database.client, "tech"));
    completionHarness.loadJobForActor.mockResolvedValue(job);

    const response = await POST(request(), context());

    expect(response.status).toBe(409);
    expect(database.rpc).not.toHaveBeenCalled();
  });
});

function request(body: Record<string, unknown> = {}) {
  return new NextRequest(`https://example.test/api/jobs/${JOB_ID}/complete`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer valid-session" },
    body: JSON.stringify(body)
  });
}

function context() {
  return { params: Promise.resolve({ id: JOB_ID }) };
}

function arrivedJob(overrides: Partial<Job> = {}): Job {
  return {
    id: JOB_ID,
    customerId: CUSTOMER_ID,
    assignedTechId: TECH_ID,
    status: "in_progress",
    scheduledAt: "2026-07-21T13:00:00.000Z",
    arrivalWindowEndAt: "2026-07-21T16:00:00.000Z",
    arrivedAt: "2026-07-21T13:05:00.000Z",
    serviceAddress: "1 Main Street, Centreville, VA 20120",
    description: "Repair leaking supply line",
    notes: "Installed a new shutoff valve.",
    createdAt: "2026-07-20T12:00:00.000Z",
    ...overrides
  };
}

function actor(client: SupabaseClient, role: Role) {
  const id = role === "owner" ? OWNER_ID : TECH_ID;
  return {
    authUserId: "66666666-6666-4666-8666-666666666666",
    user: {
      id,
      email: `${role}@example.com`,
      role,
      displayName: role,
      active: true,
      createdAt: "2026-07-20T12:00:00.000Z"
    },
    supabase: client
  };
}

function createDatabase(input: {
  signature: { id: string; document_sha256: string; selected_tier: string; authorization_signature_id: string } | null;
  overrideBy?: string;
  rpcError?: { message: string } | null;
}) {
  const query = { update: vi.fn() };

  const completedRow = jobRow({
    assigned_tech_id: input.overrideBy ? null : TECH_ID,
    completion_signature_override_at: input.overrideBy ? "2026-07-21T14:00:00.000Z" : null,
    completion_signature_override_by: input.overrideBy ?? null,
    completion_signature_override_reason: input.overrideBy ? "Customer left before signing." : null
  });
  const single = vi.fn().mockResolvedValue({
    data: input.rpcError ? null : completedRow,
    error: input.rpcError ?? null
  });
  const rpc = vi.fn().mockReturnValue({ single });
  const from = vi.fn((table: string) => {
    const filters: Record<string, unknown> = {};
    const builder = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn(),
      update: query.update,
      then: (resolve: (value: unknown) => void) => resolve({
        count: table === "job_photos" ? 1 : null,
        error: null
      })
    };
    builder.select.mockReturnValue(builder);
    builder.eq.mockImplementation((column: string, value: unknown) => {
      filters[column] = value;
      return builder;
    });
    builder.maybeSingle.mockImplementation(async () => ({
      data: table === "invoice_signatures" && filters.purpose === "work_authorization"
        ? authorizationRow()
        : input.signature,
      error: null
    }));
    return builder;
  });

  return {
    client: { from, rpc } as unknown as SupabaseClient,
    from,
    query,
    rpc,
    single
  };
}

function authorizationBinding(): WorkAuthorizationBinding {
  return {
    id: AUTHORIZATION_ID,
    selectedTier: "standard",
    documentSha256: "a".repeat(64),
    termsVersion: "fast-track-work-authorization-v1",
    subtotal: 250,
    taxRate: 0.06,
    taxAmount: 15,
    total: 265
  };
}

function authorizationRow() {
  const binding = authorizationBinding();
  return {
    id: binding.id,
    selected_tier: binding.selectedTier,
    document_sha256: binding.documentSha256,
    authorization_terms_version: binding.termsVersion,
    authorization_subtotal: binding.subtotal,
    authorization_tax_rate: binding.taxRate,
    authorization_tax_amount: binding.taxAmount,
    authorization_total: binding.total
  };
}

function completionSignature(job: Job) {
  const binding = authorizationBinding();
  return {
    id: SIGNATURE_ID,
    document_sha256: jobCompletionDocumentHash(job, binding),
    selected_tier: binding.selectedTier,
    authorization_signature_id: binding.id
  };
}

function jobRow(overrides: Record<string, unknown> = {}) {
  return {
    id: JOB_ID,
    customer_id: CUSTOMER_ID,
    assigned_tech_id: TECH_ID,
    status: "complete",
    scheduled_at: "2026-07-21T13:00:00.000Z",
    arrival_window_end_at: "2026-07-21T16:00:00.000Z",
    arrived_at: "2026-07-21T13:05:00.000Z",
    service_address: "1 Main Street, Centreville, VA 20120",
    description: "Repair leaking supply line",
    notes: "Installed a new shutoff valve.",
    originating_call_id: null,
    created_at: "2026-07-20T12:00:00.000Z",
    completed_at: "2026-07-21T14:00:00.000Z",
    completion_signature_override_at: null,
    completion_signature_override_by: null,
    completion_signature_override_reason: null,
    ...overrides
  };
}
