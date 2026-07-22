import { describe, expect, it } from "vitest";
import {
  balanceDue,
  buildInvoiceDraft,
  firstPopulatedTier,
  invoiceOptionLabels,
  selectedSubtotal,
  selectedTotal,
  totalsForItems
} from "@/lib/invoice";
import { invoiceFromRow, invoiceToRow, type InvoiceRow } from "@/lib/supabase-mappers";
import type { Invoice, JobLineItem } from "@/lib/types";

const items: JobLineItem[] = [
  line("standard", 1, 89, 0),
  line("good", 2, 19.995, 1),
  line("better", 1, 125, 2),
  line("best", 1.5, 200, 3)
];

describe("invoice totals and persistence", () => {
  it("calculates and rounds every estimate tier from line items", () => {
    expect(totalsForItems(items, 0.06)).toEqual({
      subtotalStandard: 89,
      subtotalGood: 39.99,
      subtotalBetter: 125,
      subtotalBest: 300,
      taxRate: 0.06,
      totalStandard: 94.34,
      totalGood: 42.39,
      totalBetter: 132.5,
      totalBest: 318
    });
  });

  it("supports one neutral Standard scope without requiring tiered packages", () => {
    const invoice = draft({ selectedTier: "standard" });
    expect(selectedSubtotal(invoice)).toBe(89);
    expect(selectedTotal(invoice)).toBe(94.34);
    expect(firstPopulatedTier(invoice)).toBe("standard");
  });

  it("uses a neutral invoice label while retaining the selected estimate tier internally", () => {
    const invoice = draft({ selectedTier: "better", amountPaid: 32.5 });
    expect(invoiceOptionLabels[invoice.optionLabel]).toBe("Approved work");
    expect(selectedSubtotal(invoice)).toBe(125);
    expect(selectedTotal(invoice)).toBe(132.5);
    expect(balanceDue(invoice)).toBe(100);
    expect(firstPopulatedTier(invoice)).toBe("better");
  });

  it("defaults legacy rows to safe unsigned and unpaid metadata", () => {
    const mapped = invoiceFromRow(row());
    expect(mapped.optionLabel).toBe("approved_work");
    expect(mapped.paymentStatus).toBe("unpaid");
    expect(mapped.approvalStatus).toBe("not_signed");
    expect(mapped.amountPaid).toBe(0);
    expect(mapped.pdfVersion).toBe(0);
    expect(mapped.updatedAt).toBe(mapped.createdAt);
  });

  it("round-trips signature, payment, and PDF audit metadata", () => {
    const source = draft({
      approvalStatus: "signed",
      approvedAt: "2026-07-20T16:22:00.000Z",
      paymentStatus: "partially_paid",
      amountPaid: 32.5,
      pdfStoragePath: "invoice-id/invoice-v2.pdf",
      pdfVersion: 2,
      pdfGeneratedAt: "2026-07-20T16:24:00.000Z",
      pdfSha256: "a".repeat(64),
      pdfSizeBytes: 12345
    });
    const persisted = invoiceToRow(source);
    const mapped = invoiceFromRow({
      ...row(),
      ...persisted,
      id: source.id,
      job_id: source.jobId,
      invoice_number: source.invoiceNumber
    } as InvoiceRow);
    expect(mapped).toMatchObject({
      approvalStatus: "signed",
      paymentStatus: "partially_paid",
      amountPaid: 32.5,
      pdfVersion: 2,
      pdfSha256: "a".repeat(64),
      pdfSizeBytes: 12345
    });
  });

  it("preserves reviewed workflow metadata when server totals refresh a draft", () => {
    const existing = draft({ status: "sent", optionLabel: "custom_estimate", notes: "Customer approved the custom scope." });
    const refreshed = buildInvoiceDraft({
      id: "new-id",
      jobId: existing.jobId,
      invoiceNumber: "INV-999999",
      createdBy: "new-user",
      existing,
      items
    });
    expect(refreshed.id).toBe(existing.id);
    expect(refreshed.invoiceNumber).toBe(existing.invoiceNumber);
    expect(refreshed.status).toBe("sent");
    expect(refreshed.optionLabel).toBe("custom_estimate");
    expect(refreshed.notes).toBe(existing.notes);
    expect(refreshed.totalBetter).toBe(132.5);
  });

  it("defaults a new unsigned draft to the first populated tier", () => {
    const draft = buildInvoiceDraft({
      id: "new-id",
      jobId: "job-id",
      invoiceNumber: "INV-000124",
      createdBy: "owner-1",
      items: [line("best", 1, 300, 1), line("good", 1, 100, 2)]
    });

    expect(draft.selectedTier).toBe("good");
  });
});

function line(tier: JobLineItem["tier"], quantity: number, unitPrice: number, sortOrder: number): JobLineItem {
  return {
    id: `item-${sortOrder}`,
    jobId: "job-id",
    description: `Item ${sortOrder}`,
    quantity,
    unitPrice,
    tier,
    isManual: true,
    sortOrder
  };
}

function draft(patch: Partial<Invoice> = {}): Invoice {
  return {
    id: "invoice-id",
    jobId: "job-id",
    invoiceNumber: "INV-000123",
    selectedTier: "better",
    ...totalsForItems(items, 0.06),
    status: "draft",
    optionLabel: "approved_work",
    notes: "",
    paymentStatus: "unpaid",
    amountPaid: 0,
    approvalStatus: "not_signed",
    pdfVersion: 0,
    createdAt: "2026-07-20T16:00:00.000Z",
    createdBy: "user-id",
    updatedAt: "2026-07-20T16:00:00.000Z",
    ...patch
  };
}

function row(): InvoiceRow {
  return {
    id: "invoice-id",
    job_id: "job-id",
    invoice_number: "INV-000123",
    selected_tier: "better",
    subtotal_standard: 89,
    subtotal_good: 39.99,
    subtotal_better: 125,
    subtotal_best: 300,
    tax_rate: 0.06,
    total_standard: 94.34,
    total_good: 42.39,
    total_better: 132.5,
    total_best: 318,
    status: "draft",
    pdf_storage_path: null,
    sent_to_email: null,
    sent_at: null,
    created_at: "2026-07-20T16:00:00.000Z",
    created_by: "user-id"
  };
}
