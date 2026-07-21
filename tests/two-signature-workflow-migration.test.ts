import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = read("../supabase/migrations/20260721220000_add_two_signature_workflow.sql");
const canonicalSchema = read("../supabase/schema.sql");

describe("two-signature field-service workflow database controls", () => {
  it("stores a distinct pre-work authorization against the exact selected option", () => {
    expect(migration).toContain("work_authorization");
    expect(migration).toMatch(/add column if not exists selected_tier text/i);
    expect(migration).toMatch(/selected_tier[^\n]+(?:standard|good|better|best)/i);
    expect(migration).toMatch(/purpose[^\n]+work_authorization/i);
    expect(migration).toMatch(/unique index[\s\S]+work_authorization/i);
  });

  it("accepts authorization only after arrival, a before photo, and proposed work", () => {
    const recordSignature = latestSection(
      migration,
      "create or replace function public.record_invoice_signature(",
      "create or replace function public.reject_invoice_signature("
    );

    expect(recordSignature).toContain("p_purpose = 'work_authorization'");
    expect(recordSignature).toContain("target_job.arrived_at is null");
    expect(recordSignature).toContain("public.job_photos");
    expect(recordSignature).toMatch(/kind\s*=\s*'before'/);
    expect(recordSignature).toContain("public.job_line_items");
    expect(recordSignature).toContain("p_selected_tier");
  });

  it("accepts completion acknowledgement only after authorization and an after photo", () => {
    const recordSignature = latestSection(
      migration,
      "create or replace function public.record_invoice_signature(",
      "create or replace function public.reject_invoice_signature("
    );

    expect(recordSignature).toContain("p_purpose = 'work_completion'");
    expect(recordSignature).toContain("work_authorization");
    expect(recordSignature).toContain("public.job_photos");
    expect(recordSignature).toMatch(/kind\s*=\s*'after'/);
  });

  it("locks an authorized scope, not an unsigned draft invoice", () => {
    const lineItemProtection = latestSection(
      migration,
      "create or replace function public.protect_signed_invoice_line_items()",
      "create or replace function public.sync_job_invoice_totals()"
    );

    expect(lineItemProtection).toContain("work_authorization");
    expect(lineItemProtection).toContain("invoice_approval");
    expect(lineItemProtection).toContain("status = 'active'");
    expect(lineItemProtection).toMatch(/Reject[^']*authorization[^']*before changing/i);
    expect(lineItemProtection).not.toContain("Only an owner can change line items after an invoice draft exists.");
    expect(lineItemProtection).toContain("case when tg_op = 'DELETE' then old else new end");
  });

  it("prevents signed before/after evidence from being replaced or deleted", () => {
    const photoProtection = latestSection(
      migration,
      "create or replace function public.protect_signed_job_photos()",
      "create or replace function public.protect_work_authorization_signed_job_fields()"
    );

    expect(photoProtection).toContain("old.kind = 'before'");
    expect(photoProtection).toContain("purpose = 'work_authorization'");
    expect(photoProtection).toContain("old.kind = 'after'");
    expect(photoProtection).toContain("purpose = 'work_completion'");
    expect(photoProtection).toContain("before insert or update or delete on public.job_photos");
    expect(photoProtection).toContain("case when tg_op = 'DELETE' then old else new end");
  });

  it("rechecks after-photo evidence and completion authorization in the atomic completion RPC", () => {
    const completion = latestSection(
      migration,
      "create or replace function public.complete_job_with_signature(",
      "create or replace function public.enforce_job_completion_signature()"
    );

    expect(completion).toContain("work_authorization");
    expect(completion).toContain("work_completion");
    expect(completion).toContain("public.job_photos");
    expect(completion).toMatch(/kind\s*=\s*'after'/);
    expect(completion).toContain("for update");
  });

  it("does not allow an invoice draft before the field workflow is complete", () => {
    const invoiceDraft = latestSection(
      migration,
      "create or replace function public.create_or_refresh_invoice_draft(",
      "create or replace function public.record_invoice_signature("
    );

    expect(invoiceDraft).toMatch(/status\s*(?:<>|is distinct from)\s*'complete'/i);
    expect(invoiceDraft).toMatch(/cannot|complete|completion/i);
  });

  it("keeps the canonical fresh-install schema synchronized", () => {
    expect(canonicalSchema).toContain(migration);
  });
});

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function latestSection(source: string, start: string, end: string): string {
  const startIndex = source.lastIndexOf(start);
  expect(startIndex, `Missing section: ${start}`).toBeGreaterThanOrEqual(0);
  const endIndex = source.indexOf(end, startIndex + start.length);
  return source.slice(startIndex, endIndex < 0 ? undefined : endIndex);
}
