import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  auditStatusForProviderErrorCode,
  claimInvoiceDelivery,
  invoiceDeliveryDestinationHash,
  InvoiceDeliveryAuditError,
  recordInvoiceDeliveryOutcome
} from "@/lib/invoice-delivery-audit";

const migration = readFileSync(
  "supabase/migrations/20260722120000_add_invoice_delivery_audit.sql",
  "utf8"
);

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const INVOICE_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const AUDIT_ID = "44444444-4444-4444-8444-444444444444";
const CLAIM_TOKEN = "55555555-5555-4555-8555-555555555555";
const PDF_SHA256 = "a".repeat(64);
const CLAIMED_AT = "2026-07-22T16:00:00.000Z";
const COMPLETED_AT = "2026-07-22T16:00:01.000Z";

describe("invoice delivery audit migration", () => {
  it("stores only durable hashes and bounded provider metadata", () => {
    expect(migration).toContain("create table if not exists public.invoice_delivery_audit");
    expect(migration).toContain("request_id uuid not null unique");
    expect(migration).toContain("workflow_revision bigint not null check (workflow_revision >= 0)");
    expect(migration).toContain("destination_hash text not null check (destination_hash ~ '^[0-9a-f]{64}$')");
    expect(migration).toContain("pdf_sha256 text not null check (pdf_sha256 ~ '^[0-9a-f]{64}$')");
    expect(migration).toContain("status in ('processing', 'accepted', 'failed', 'delivery_unknown')");
    expect(migration).toContain("provider in ('resend', 'sendgrid', 'twilio')");
    expect(migration).not.toMatch(/\bdestination text\b/);
    expect(migration).not.toContain("signed_url");
    expect(migration).not.toContain("raw_payload");
    expect(migration).not.toContain("provider_payload");
    expect(migration).not.toContain("message_body");
  });

  it("atomically fences one provider attempt per request UUID", () => {
    const claim = section(
      migration,
      "create or replace function public.claim_invoice_delivery(",
      "create or replace function public.record_invoice_delivery_result("
    );
    expect(claim).toContain("Only the service role can claim invoice delivery.");
    expect(claim).toContain("on conflict (request_id) do nothing");
    expect(claim).toContain("for update");
    expect(claim).toContain("'send'::text");
    expect(claim).toContain("when 'accepted' then 'already_accepted'");
    expect(claim).toContain("when 'processing' then 'in_flight'");
    expect(claim).toContain("when 'failed' then 'already_failed'");
    expect(claim).toContain("else 'delivery_unknown'");
    expect(claim).toContain("null::uuid");
    expect(claim).toContain("request ID was already used for different delivery details");
    expect(claim).toContain("invoice_row.pdf_sha256");
    expect(claim).toContain("invoice_row.pdf_workflow_revision is distinct from p_workflow_revision");
    expect(claim).toContain("job_row.workflow_revision is distinct from p_workflow_revision");
    expect(claim.indexOf("select * into job_row")).toBeLessThan(claim.indexOf("select * into invoice_row"));
    expect(claim).toContain("requested_user.role not in ('owner', 'tech')");
    expect(claim).toContain("Technicians can only deliver invoices for assigned jobs.");
  });

  it("never leases or automatically reclaims an ambiguous processing claim", () => {
    expect(migration).not.toContain("locked_until");
    expect(migration).not.toContain("available_at");
    expect(migration).not.toContain("reclaim_invoice_delivery");
    expect(migration).toContain("Processing rows intentionally have no lease");
    expect(migration).toContain("status = 'delivery_unknown'");
    expect(migration).toContain("delivery_unknown_at");
  });

  it("finalizes only with the original token and supports idempotent acknowledgement", () => {
    const completion = section(
      migration,
      "create or replace function public.record_invoice_delivery_result(",
      "alter table public.invoice_delivery_audit enable row level security"
    );
    expect(completion).toContain("audit_row.claim_token is distinct from p_claim_token");
    expect(completion).toContain("Accepted invoice delivery requires a provider message ID.");
    expect(completion).toContain("Failed or unknown invoice delivery requires only a safe error code.");
    expect(completion).toContain("if audit_row.status <> 'processing' then");
    expect(completion).toContain("audit_row.status = normalized_status");
    expect(completion).toContain("Invoice delivery result was already finalized.");
    expect(completion).toContain("delivery_unknown_at = case when normalized_status = 'delivery_unknown'");
    expect(migration).toContain("Invoice delivery audit rows cannot be deleted.");
    expect(migration).toContain("Invoice delivery claim identity is immutable.");
    expect(migration).toContain("status cannot be retried or rewritten");
  });

  it("allows owner/assigned-tech reads while keeping all write RPCs service-only", () => {
    expect(migration).toContain("owner assigned tech read invoice delivery audit");
    expect(migration).toContain("job.assigned_tech_id = public.current_allowed_user_id()");
    expect(migration).toContain("no direct invoice delivery audit inserts");
    expect(migration).toContain("no direct invoice delivery audit updates");
    expect(migration).toContain("no direct invoice delivery audit deletes");
    expect(migration).toContain(
      "revoke all on table public.invoice_delivery_audit from public, anon, authenticated, service_role"
    );
    const authenticatedGrant = section(
      migration,
      "grant select (\n  id,",
      ") on table public.invoice_delivery_audit to authenticated;"
    );
    expect(authenticatedGrant).not.toContain("claim_token");
    expect(migration).toContain(
      "grant execute on function public.claim_invoice_delivery(uuid, uuid, text, text, text, bigint, uuid)\n  to service_role;"
    );
    expect(migration).toContain(
      "grant execute on function public.record_invoice_delivery_result(uuid, uuid, text, text, text, text, text)\n  to service_role;"
    );
    expect(migration).not.toContain(
      "grant execute on function public.claim_invoice_delivery(uuid, uuid, text, text, text, bigint, uuid)\n  to authenticated;"
    );
    expect(migration).not.toContain(
      "grant execute on function public.record_invoice_delivery_result(uuid, uuid, text, text, text, text, text)\n  to authenticated;"
    );
  });
});

describe("invoice delivery audit server adapter", () => {
  it("claims a canonical destination hash without sending the raw destination to the RPC", async () => {
    const rpc = vi.fn(async () => ({
      data: [{
        audit_id: AUDIT_ID,
        decision: "send",
        delivery_status: "processing",
        completion_token: CLAIM_TOKEN,
        delivery_provider: null,
        delivery_provider_message_id: null,
        delivery_provider_status: null,
        delivery_error_code: null,
        claimed_at: CLAIMED_AT,
        completed_at: null
      }],
      error: null
    }));

    const claim = await claimInvoiceDelivery(client(rpc), {
      requestId: REQUEST_ID.toUpperCase(),
      invoiceId: INVOICE_ID,
      channel: "email",
      destination: " Customer@Example.com ",
      pdfSha256: PDF_SHA256.toUpperCase(),
      workflowRevision: 7,
      requestedBy: USER_ID
    });

    expect(claim).toEqual({
      auditId: AUDIT_ID,
      decision: "send",
      status: "processing",
      completionToken: CLAIM_TOKEN,
      provider: undefined,
      providerMessageId: undefined,
      providerStatus: undefined,
      errorCode: undefined,
      claimedAt: CLAIMED_AT,
      completedAt: undefined
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("claim_invoice_delivery", {
      p_request_id: REQUEST_ID,
      p_invoice_id: INVOICE_ID,
      p_channel: "email",
      p_destination_hash: invoiceDeliveryDestinationHash("email", "customer@example.com"),
      p_pdf_sha256: PDF_SHA256,
      p_workflow_revision: 7,
      p_requested_by: USER_ID
    });
    expect(JSON.stringify(secondRpcArgument(rpc))).not.toContain("customer@example.com");
  });

  it("returns a prior accepted result without exposing a completion token", async () => {
    const rpc = vi.fn(async () => ({
      data: [{
        audit_id: AUDIT_ID,
        decision: "already_accepted",
        delivery_status: "accepted",
        completion_token: null,
        delivery_provider: "sendgrid",
        delivery_provider_message_id: "sendgrid-message-1",
        delivery_provider_status: "accepted",
        delivery_error_code: null,
        claimed_at: CLAIMED_AT,
        completed_at: COMPLETED_AT
      }],
      error: null
    }));

    const claim = await claimInvoiceDelivery(client(rpc), {
      requestId: REQUEST_ID,
      invoiceId: INVOICE_ID,
      channel: "email",
      destination: "customer@example.com",
      pdfSha256: PDF_SHA256,
      workflowRevision: 7,
      requestedBy: USER_ID
    });

    expect(claim).toMatchObject({
      decision: "already_accepted",
      status: "accepted",
      completionToken: undefined,
      provider: "sendgrid",
      providerMessageId: "sendgrid-message-1",
      completedAt: COMPLETED_AT
    });
  });

  it("records only bounded acceptance metadata", async () => {
    const rpc = vi.fn(async () => ({ data: auditRow(), error: null }));

    const record = await recordInvoiceDeliveryOutcome(client(rpc), {
      requestId: REQUEST_ID,
      completionToken: CLAIM_TOKEN,
      outcome: {
        status: "accepted",
        provider: "twilio",
        providerMessageId: `SM${"b".repeat(32)}`,
        providerStatus: "accepted"
      }
    });

    expect(record).toMatchObject({
      id: AUDIT_ID,
      requestId: REQUEST_ID,
      channel: "sms",
      status: "accepted",
      provider: "twilio",
      providerMessageId: `SM${"b".repeat(32)}`
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("record_invoice_delivery_result", {
      p_request_id: REQUEST_ID,
      p_claim_token: CLAIM_TOKEN,
      p_status: "accepted",
      p_provider: "twilio",
      p_provider_message_id: `SM${"b".repeat(32)}`,
      p_provider_status: "accepted",
      p_error_code: null
    });
    expect(JSON.stringify(secondRpcArgument(rpc))).not.toContain("signedUrl");
    expect(JSON.stringify(secondRpcArgument(rpc))).not.toContain("payload");
  });

  it("records an ambiguous provider outcome without a message ID or raw error", async () => {
    const rpc = vi.fn(async () => ({
      data: {
        ...auditRow(),
        status: "delivery_unknown",
        provider_message_id: null,
        provider_status: null,
        error_code: "timeout",
        accepted_at: null,
        delivery_unknown_at: COMPLETED_AT
      },
      error: null
    }));

    const record = await recordInvoiceDeliveryOutcome(client(rpc), {
      requestId: REQUEST_ID,
      completionToken: CLAIM_TOKEN,
      outcome: {
        status: "delivery_unknown",
        provider: "twilio",
        errorCode: "timeout"
      }
    });

    expect(record).toMatchObject({
      status: "delivery_unknown",
      provider: "twilio",
      providerMessageId: undefined,
      errorCode: "timeout",
      deliveryUnknownAt: COMPLETED_AT
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("record_invoice_delivery_result", {
      p_request_id: REQUEST_ID,
      p_claim_token: CLAIM_TOKEN,
      p_status: "delivery_unknown",
      p_provider: "twilio",
      p_provider_message_id: null,
      p_provider_status: null,
      p_error_code: "timeout"
    });
  });

  it("classifies ambiguous provider errors conservatively and rejects invalid input before RPC", async () => {
    expect(auditStatusForProviderErrorCode("network_error")).toBe("delivery_unknown");
    expect(auditStatusForProviderErrorCode("timeout")).toBe("delivery_unknown");
    expect(auditStatusForProviderErrorCode("invalid_response")).toBe("delivery_unknown");
    expect(auditStatusForProviderErrorCode("provider_rejected")).toBe("failed");

    const rpc = vi.fn();
    const error = await claimInvoiceDelivery(client(rpc), {
      requestId: REQUEST_ID,
      invoiceId: INVOICE_ID,
      channel: "sms",
      destination: "not-a-phone",
      pdfSha256: PDF_SHA256,
      workflowRevision: 7,
      requestedBy: USER_ID
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(InvoiceDeliveryAuditError);
    expect(error).toMatchObject({ code: "invalid_input" });
    expect(rpc).not.toHaveBeenCalled();
    expect(JSON.stringify(error)).not.toContain("not-a-phone");
  });
});

function auditRow() {
  return {
    id: AUDIT_ID,
    request_id: REQUEST_ID,
    invoice_id: INVOICE_ID,
    channel: "sms",
    destination_hash: invoiceDeliveryDestinationHash("sms", "+17035551212"),
    pdf_sha256: PDF_SHA256,
    workflow_revision: 7,
    status: "accepted",
    claim_token: CLAIM_TOKEN,
    provider: "twilio",
    provider_message_id: `SM${"b".repeat(32)}`,
    provider_status: "accepted",
    error_code: null,
    requested_by: USER_ID,
    claimed_at: CLAIMED_AT,
    accepted_at: COMPLETED_AT,
    failed_at: null,
    delivery_unknown_at: null,
    created_at: CLAIMED_AT,
    updated_at: COMPLETED_AT
  };
}

function client(rpc: ReturnType<typeof vi.fn>): SupabaseClient {
  return { rpc } as unknown as SupabaseClient;
}

function secondRpcArgument(rpc: ReturnType<typeof vi.fn>): unknown {
  const calls = rpc.mock.calls as unknown as unknown[][];
  return calls[0]?.[1];
}

function section(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}
