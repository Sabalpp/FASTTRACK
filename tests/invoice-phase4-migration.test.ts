import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = read("../supabase/migrations/20260721040000_add_invoice_signatures_and_pdf_metadata.sql");

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

  it("requires a saved work-completion signature or an explicit owner override", () => {
    expect(migration).toContain("create or replace function public.enforce_job_completion_signature()");
    expect(migration).toContain("s.purpose = 'work_completion'");
    expect(migration).toContain("new.completion_signature_override_reason");
    expect(migration).toContain("Only an owner can override the customer completion signature.");
    expect(migration).toContain("Collect the customer completion signature before completing this job.");
  });
});

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}
