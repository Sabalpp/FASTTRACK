import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = read("../supabase/migrations/20260721040000_add_invoice_signatures_and_pdf_metadata.sql");
const canonicalSchema = read("../supabase/schema.sql");

describe("Phase 4 invoice database controls", () => {
  it("adds signature and PDF audit data without replacing the existing invoice tables", () => {
    expect(migration).toContain("alter table public.invoices");
    expect(migration).toContain("add column if not exists approval_status text not null default 'not_signed'");
    expect(migration).toContain("add column if not exists pdf_sha256 text");
    expect(migration).toContain("create table if not exists public.invoice_signatures");
    expect(migration).toContain("document_sha256 text not null");
    expect(migration).toContain("collected_by uuid not null references public.allowed_users(id)");
  });

  it("recalculates totals from server-side line items and blocks direct invoice mutations", () => {
    expect(migration).toContain("create or replace function public.recalculate_invoice_amounts()");
    expect(migration).toContain("from public.job_line_items");
    expect(migration).toContain("before insert or update on public.invoices");
    expect(migration).toContain("Invoices must be changed through the protected invoice workflow.");
    expect(migration).toContain("create policy \"no direct invoice inserts\"");
    expect(migration).toContain("with check (false)");
    expect(migration).toContain("create policy \"no direct invoice updates\"");
    expect(migration).toContain("using (false)");
  });

  it("backfills protected totals for every invoice already in the database", () => {
    expect(migration).toContain("previous_total_sync_setting text := current_setting('fasttrack.invoice_total_sync', true)");
    expect(migration).toContain("perform set_config('fasttrack.invoice_total_sync', 'on', true)");
    expect(migration).toMatch(/update public\.invoices\s+set updated_at = statement_timestamp\(\);/);
    expect(migration).toContain("coalesce(previous_total_sync_setting, '')");
  });

  it("keeps technicians from changing invoice charge sources after a draft exists", () => {
    expect(migration).toContain("coalesce(auth.role(), '') <> 'service_role'");
    expect(migration).toContain("and not public.is_owner()");
    expect(migration).toContain("Only an owner can change line items after an invoice draft exists.");
    expect(migration).toContain("Reject the saved customer approval before changing signed invoice line items.");
  });

  it("stores signatures privately and exposes writes only through service-role RPCs", () => {
    expect(migration).toContain("values ('invoice-signatures', 'invoice-signatures', false, 1048576, array['image/png'])");
    expect(migration).toContain("revoke insert, update, delete on public.invoice_signatures from anon, authenticated");
    expect(migration).toContain("create or replace function public.record_invoice_signature");
    expect(migration).toContain("create or replace function public.reject_invoice_signature");
    expect(migration).toContain("raise exception 'Server role required.'");
    expect(migration).toContain("to service_role");
  });

  it("invalidates generated and sent artifacts only for signatures rendered in the invoice PDF", () => {
    expect(migration).toContain("create or replace function public.invalidate_invoice_pdf_after_signature_change()");
    expect(migration).toContain("after insert or update on public.invoice_signatures");
    expect(migration).toContain("affected_invoice_ids uuid[] := array[]::uuid[]");
    expect(migration).toContain("if new.purpose in ('invoice_approval', 'technician_acknowledgement')");
    expect(migration).toContain("if old.purpose in ('invoice_approval', 'technician_acknowledgement')");
    expect(migration).toContain("array_append(affected_invoice_ids, old.invoice_id)");
    expect(migration).toContain("array_append(affected_invoice_ids, new.invoice_id)");
    expect(migration).toContain("where id = any(affected_invoice_ids)");
    for (const field of [
      "status", "purpose", "signer_name", "signer_role", "storage_path",
      "content_sha256", "document_sha256", "signed_at", "invoice_id"
    ]) {
      expect(migration).toContain(`new.${field} is distinct from old.${field}`);
    }
    expect(migration).toContain("pdf_storage_path = null");
    expect(migration).toContain("pdf_generated_at = null");
    expect(migration).toContain("pdf_sha256 = null");
    expect(migration).toContain("pdf_size_bytes = null");
    expect(migration).toContain("sent_to_email = null");
    expect(migration).toContain("sent_at = null");
    expect(migration).toContain("status = case when payment_status = 'paid' then 'paid' else 'draft' end");

    const invalidationFunction = migration.slice(
      migration.indexOf("create or replace function public.invalidate_invoice_pdf_after_signature_change()"),
      migration.indexOf("drop trigger if exists invalidate_invoice_pdf_after_signature_change")
    );
    expect(invalidationFunction).not.toContain("'work_completion'");
  });

  it("removes legacy authenticated PDF mutation policies", () => {
    expect(migration).toContain('drop policy if exists "invoice pdfs insert by owner" on storage.objects');
    expect(migration).toContain('drop policy if exists "invoice pdfs update by owner" on storage.objects');
    expect(migration).toContain('drop policy if exists "invoice pdfs delete by owner" on storage.objects');
    expect(migration).not.toMatch(/create policy "invoice pdfs (?:insert|update|delete)[^"]*"/);
  });

  it("requires a saved work-completion signature or an explicit owner override", () => {
    expect(migration).toContain("create or replace function public.enforce_job_completion_signature()");
    expect(migration).toContain("s.purpose = 'work_completion'");
    expect(migration).toContain("new.completion_signature_override_reason");
    expect(migration).toContain("Only an owner can override the customer completion signature.");
    expect(migration).toContain("Collect the customer completion signature before completing this job.");
  });

  it("atomically completes the exact arrived job and active signature snapshot", () => {
    const completionRpc = section(
      "create or replace function public.complete_job_with_signature(",
      "create or replace function public.enforce_job_completion_signature()"
    );
    expect(completionRpc).toContain("coalesce(auth.role(), '') <> 'service_role'");
    expect(completionRpc).toContain("from public.jobs");
    expect(completionRpc).toContain("for update;");
    expect(completionRpc).toContain("current_job.status is distinct from p_expected_status");
    expect(completionRpc).toContain("current_job.customer_id is distinct from p_expected_customer_id");
    expect(completionRpc).toContain("current_job.assigned_tech_id is distinct from p_expected_assigned_tech_id");
    expect(completionRpc).toContain("current_job.service_address is distinct from p_expected_service_address");
    expect(completionRpc).toContain("current_job.description is distinct from p_expected_description");
    expect(completionRpc).toContain("current_job.arrived_at is distinct from p_expected_arrived_at");
    expect(completionRpc).toContain("current_job.status <> 'in_progress' or current_job.arrived_at is null");
    expect(completionRpc).toContain("current_signature.id is distinct from p_expected_signature_id");
    expect(completionRpc).toContain("current_signature.document_sha256 is distinct from p_expected_signature_document_sha256");
    expect(completionRpc.indexOf("from public.jobs")).toBeLessThan(completionRpc.indexOf("from public.invoice_signatures"));
    expect(completionRpc).toContain("status = 'complete'");
    expect(migration).toContain("grant execute on function public.complete_job_with_signature(");
    expect(migration).toMatch(/grant execute on function public\.complete_job_with_signature\([\s\S]*?\) to service_role;/);
  });

  it("serializes completion-signature collection and rejection with job completion", () => {
    const recordRpc = section(
      "create or replace function public.record_invoice_signature(",
      "create or replace function public.reject_invoice_signature("
    );
    expect(recordRpc).toContain("if p_purpose = 'work_completion' then");
    expect(recordRpc).toContain("from public.jobs");
    expect(recordRpc).toContain("for update;");
    expect(recordRpc).toContain("target_job.status <> 'in_progress' or target_job.arrived_at is null");

    const rejectRpc = section(
      "create or replace function public.reject_invoice_signature(",
      "create or replace function public.complete_job_with_signature("
    );
    expect(rejectRpc).toContain("target_signature.purpose = 'work_completion'");
    expect(rejectRpc).toContain("from public.jobs");
    expect(rejectRpc).toContain("for update;");
    expect(rejectRpc).toContain("target_job.status = 'complete'");
    expect(rejectRpc.indexOf("from public.jobs")).toBeLessThan(rejectRpc.indexOf("update public.invoice_signatures"));
  });

  it("requires rejection and re-signing before changing completion-hash job fields", () => {
    expect(migration).toContain("create or replace function public.protect_work_completion_signed_job_fields()");
    expect(migration).toContain("create trigger protect_work_completion_signed_job_fields");
    expect(migration).toContain("signature.purpose = 'work_completion'");
    expect(migration).toContain("signature.status = 'active'");
    for (const field of ["customer_id", "service_address", "description", "notes", "arrived_at"]) {
      expect(migration).toContain(`new.${field} is distinct from old.${field}`);
    }
    expect(migration).toContain("Reject the saved work-completion signature before changing signed job details.");
    expect(migration.indexOf("create trigger protect_work_completion_signed_job_fields"))
      .toBeGreaterThan(migration.indexOf("create trigger enforce_job_completion_signature"));
  });

  it("keeps the canonical fresh-install schema synchronized", () => {
    expect(canonicalSchema.endsWith(migration)).toBe(true);
  });
});

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function section(start: string, end: string): string {
  return migration.slice(migration.indexOf(start), migration.indexOf(end));
}
