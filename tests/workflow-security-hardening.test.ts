import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assertCompletionAuthorizationBinding,
  assertInvoiceFieldWorkflow,
  jobAuthorizationDocumentHash,
  jobCompletionDocumentHash,
  workAuthorizationPricing,
  type InvoiceBundle,
  type InvoiceFieldSignatureRow,
  type WorkAuthorizationBinding
} from "@/lib/invoice-server";
import type { Customer, Invoice, Job, JobLineItem } from "@/lib/types";

const migration = read("../supabase/migrations/20260721220000_add_two_signature_workflow.sql");

describe("field workflow security hardening", () => {
  it("binds completion to the exact authorization id, option, document, price, tax, total, and terms", () => {
    const bundle = fixture();
    const authorization = authorizationRow(bundle);
    const binding = bindingFrom(authorization);
    const completion = completionRow(bundle.job, binding);

    expect(() => assertInvoiceFieldWorkflow(bundle, [authorization, completion])).not.toThrow();

    for (const changed of [
      { ...binding, id: "authorization-other" },
      { ...binding, selectedTier: "good" as const },
      { ...binding, documentSha256: "f".repeat(64) },
      { ...binding, termsVersion: "changed-terms" },
      { ...binding, subtotal: binding.subtotal + 1 },
      { ...binding, taxRate: 0.07 },
      { ...binding, taxAmount: binding.taxAmount + 1 },
      { ...binding, total: binding.total + 1 }
    ]) {
      expect(jobCompletionDocumentHash(bundle.job, changed)).not.toBe(jobCompletionDocumentHash(bundle.job, binding));
    }
  });

  it("rejects a completion row linked to a replaced authorization", () => {
    const bundle = fixture();
    const authorization = authorizationRow(bundle);
    const binding = bindingFrom(authorization);
    const completion = { ...completionRow(bundle.job, binding), authorization_signature_id: "authorization-other" };

    expect(() => assertCompletionAuthorizationBinding(completion, binding)).toThrow(/not bound/i);
    expect(() => assertInvoiceFieldWorkflow(bundle, [authorization, completion])).toThrow(/not bound/i);
  });

  it("derives authorization money from the technician's exact selected work at the branded tax rate", () => {
    const bundle = fixture();
    expect(workAuthorizationPricing(bundle.items, "standard")).toEqual({
      termsVersion: "fast-track-work-authorization-v1",
      subtotal: 250,
      taxRate: 0.06,
      taxAmount: 15,
      total: 265
    });
    expect(jobAuthorizationDocumentHash(bundle.job, bundle.items, "standard", 0.07)).not.toBe(
      jobAuthorizationDocumentHash(bundle.job, bundle.items, "standard")
    );
  });

  it("enforces downstream signature, completed-photo, metadata, and revision controls in PostgreSQL", () => {
    expect(migration).toContain("authorization_signature_id uuid references public.invoice_signatures(id) on delete restrict");
    expect(migration).toContain("p_expected_authorization_document_sha256");
    expect(migration).toContain("completion.authorization_signature_id = target_signature.id");
    expect(migration).toContain("current_signature.authorization_signature_id is distinct from current_authorization.id");
    expect(migration).toContain("After-work evidence is frozen when the job is complete");
    expect(migration).toContain("uploaded_by = public.current_allowed_user_id()");
    expect(migration).toContain("storage_path like (job_id::text || '/%')");
    expect(migration).toContain("fasttrack.internal_workflow_revision_bump");
    expect(migration).toContain("pg_trigger_depth() > 1");
    expect(migration).toContain("join public.invoice_signatures work_auth");
    expect(migration).not.toContain("join public.invoice_signatures authorization");
  });
});

function authorizationRow(bundle: InvoiceBundle): InvoiceFieldSignatureRow {
  const pricing = workAuthorizationPricing(bundle.items, "standard");
  return {
    id: "authorization-1",
    purpose: "work_authorization",
    status: "active",
    selected_tier: "standard",
    document_sha256: jobAuthorizationDocumentHash(bundle.job, bundle.items, "standard"),
    authorization_terms_version: pricing.termsVersion,
    authorization_subtotal: pricing.subtotal,
    authorization_tax_rate: pricing.taxRate,
    authorization_tax_amount: pricing.taxAmount,
    authorization_total: pricing.total
  };
}

function bindingFrom(row: InvoiceFieldSignatureRow): WorkAuthorizationBinding {
  return {
    id: row.id,
    selectedTier: "standard",
    documentSha256: String(row.document_sha256),
    termsVersion: String(row.authorization_terms_version),
    subtotal: Number(row.authorization_subtotal),
    taxRate: Number(row.authorization_tax_rate),
    taxAmount: Number(row.authorization_tax_amount),
    total: Number(row.authorization_total)
  };
}

function completionRow(job: Job, binding: WorkAuthorizationBinding): InvoiceFieldSignatureRow {
  return {
    id: "completion-1",
    purpose: "work_completion",
    status: "active",
    selected_tier: binding.selectedTier,
    authorization_signature_id: binding.id,
    document_sha256: jobCompletionDocumentHash(job, binding)
  };
}

function fixture(): InvoiceBundle {
  const job: Job = {
    id: "job-1",
    customerId: "customer-1",
    assignedTechId: "tech-1",
    status: "complete",
    scheduledAt: "2026-07-21T13:00:00.000Z",
    arrivalWindowEndAt: "2026-07-21T16:00:00.000Z",
    arrivedAt: "2026-07-21T13:05:00.000Z",
    serviceAddress: "1 Main Street, Centreville, VA 20120",
    description: "Repair leaking supply line",
    notes: "Installed new shutoff valve.",
    createdAt: "2026-07-20T12:00:00.000Z"
  };
  const items: JobLineItem[] = [
    { id: "line-1", jobId: job.id, description: "Custom repair", quantity: 2, unitPrice: 125, tier: "standard", isManual: true, sortOrder: 1 },
    { id: "line-2", jobId: job.id, description: "Alternative repair", quantity: 1, unitPrice: 500, tier: "good", isManual: true, sortOrder: 1 }
  ];
  const invoice: Invoice = {
    id: "invoice-1",
    jobId: job.id,
    invoiceNumber: "INV-000001",
    selectedTier: "standard",
    subtotalStandard: 250,
    subtotalGood: 500,
    subtotalBetter: 0,
    subtotalBest: 0,
    taxRate: 0.06,
    totalStandard: 265,
    totalGood: 530,
    totalBetter: 0,
    totalBest: 0,
    status: "draft",
    optionLabel: "approved_work",
    notes: "",
    paymentStatus: "unpaid",
    amountPaid: 0,
    approvalStatus: "not_signed",
    pdfVersion: 0,
    createdAt: "2026-07-21T14:00:00.000Z",
    createdBy: "owner-1",
    updatedAt: "2026-07-21T14:00:00.000Z"
  };
  const customer: Customer = {
    id: "customer-1",
    name: "Jordan Customer",
    phone: "703-555-0101",
    phoneDigits: "7035550101",
    emailNotificationsEnabled: true,
    smsConsentStatus: "unknown",
    addressLine1: "1 Main Street",
    city: "Centreville",
    state: "VA",
    zip: "20120",
    notes: "",
    createdAt: "2026-07-20T12:00:00.000Z",
    createdBy: "owner-1"
  };
  return { invoice, job, customer, items };
}

function read(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}
