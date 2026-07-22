import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260722130000_add_invoice_payment_ledger.sql",
  "utf8"
);

describe("invoice payment ledger migration", () => {
  it("supports Stripe cards, cash, and checks without direct browser writes", () => {
    expect(migration).toContain("method in ('card', 'cash', 'check', 'other')");
    expect(migration).toContain("no direct invoice payment inserts");
    expect(migration).toContain("no direct invoice payment updates");
    expect(migration).toContain("Invoice payment audit rows cannot be deleted");
    expect(migration).toContain("create or replace function public.claim_invoice_payment(");
    expect(migration).toContain("pg_catalog.pg_advisory_xact_lock");
    expect(migration.indexOf("where payment.request_id = p_request_id")).toBeLessThan(
      migration.indexOf("if normalized_method not in ('card', 'cash', 'check')")
    );
    expect(migration).toContain("request_fingerprint");
  });

  it("serializes payment totals and prevents overpayment", () => {
    expect(migration).toContain("for update");
    expect(migration).toContain("The payment would exceed the invoice balance");
    expect(migration).toContain("invoice_payments_one_pending_card_idx");
    expect(migration).toContain("Wait for the open card checkout to finish or expire before recording cash or check");
    expect(migration).toContain("Finish or expire the open card checkout before changing the invoice price, scope, or status");
    expect(migration).toContain("A recorded refund amount cannot decrease");
    expect(migration).toContain("sync_invoice_payment_totals");
  });

  it("stores only a webhook digest and binds PDFs to the job evidence revision", () => {
    expect(migration).toContain("create table if not exists public.stripe_webhook_events");
    expect(migration).toContain("payload_sha256");
    expect(migration).not.toContain("raw_payload");
    expect(migration).toContain("pdf_workflow_revision");
    expect(migration).toContain("partially_refunded");
    expect(migration).toContain("refunded_amount");
    expect(migration).toContain("create table if not exists public.stripe_payment_refunds");
    expect(migration).toContain("create or replace function public.record_stripe_payment_refund(");
    expect(migration).toContain("where refund.status = 'succeeded'");
  });

  it("claims duplicate webhook deliveries atomically and can reclaim abandoned processing", () => {
    expect(migration).toContain("create or replace function public.claim_stripe_webhook_event(");
    expect(migration).toContain("on conflict (id) do nothing");
    expect(migration).toContain("interval '5 minutes'");
    expect(migration).toContain("create or replace function public.complete_stripe_webhook_event(");
    expect(migration).toContain("Stripe event completion token is stale");
  });

  it("keeps summary fields derived and stores structured manual reversal audit", () => {
    expect(migration).toContain("Invoice payment totals are derived from the immutable payment ledger");
    expect(migration).toContain("refunded_by uuid references public.allowed_users");
    expect(migration).toContain("reversal_reason text");
  });
});
