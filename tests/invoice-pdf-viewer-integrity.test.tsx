import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Customer, Invoice, InvoiceSignature, Job, JobLineItem } from "@/lib/types";

const clientMocks = vi.hoisted(() => ({
  loadProtectedInvoicePdf: vi.fn(),
  generateProtectedInvoicePdf: vi.fn()
}));

vi.mock("@/lib/runtime", () => ({ demoMode: false }));
vi.mock("@/lib/invoices-client", () => clientMocks);

import { InvoicePdfViewer } from "@/components/InvoicePdfViewer";

describe("invoice PDF viewer integrity", () => {
  beforeEach(() => {
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:invoice-pdf"),
      revokeObjectURL: vi.fn()
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("does not show a saved PDF response that finishes after a signature invalidates it", async () => {
    let finishLoad: ((blob: Blob) => void) | undefined;
    clientMocks.loadProtectedInvoicePdf.mockReturnValue(new Promise<Blob>((resolve) => { finishLoad = resolve; }));
    const original = props();
    const view = render(<InvoicePdfViewer {...original} />);
    await waitFor(() => expect(clientMocks.loadProtectedInvoicePdf).toHaveBeenCalledWith(original.invoice.id));

    const replacement = { ...original.signatures[0], id: "signature-2", signedAt: "2026-07-21T17:00:00.000Z" };
    view.rerender(<InvoicePdfViewer
      {...original}
      invoice={{
        ...original.invoice,
        pdfStoragePath: undefined,
        pdfGeneratedAt: undefined,
        pdfSha256: undefined,
        pdfSizeBytes: undefined
      }}
      signatures={[replacement]}
    />);

    await act(async () => {
      finishLoad?.(new Blob(["stale pdf"], { type: "application/pdf" }));
      await Promise.resolve();
    });
    expect(screen.queryByTitle(`${original.invoice.invoiceNumber} PDF preview`)).toBeNull();
    expect(screen.getByText("Generate the signed invoice to preview it here.")).toBeTruthy();
  });

  it("does not invalidate an invoice PDF when only the separate work-completion signature changes", async () => {
    clientMocks.loadProtectedInvoicePdf.mockResolvedValue(new Blob(["current pdf"], { type: "application/pdf" }));
    const original = props();
    const view = render(<InvoicePdfViewer {...original} />);
    await screen.findByTitle(`${original.invoice.invoiceNumber} PDF preview`);

    const workCompletion: InvoiceSignature = {
      ...original.signatures[0],
      id: "work-completion-1",
      purpose: "work_completion",
      invoiceId: original.invoice.id,
      signedAt: "2026-07-21T17:00:00.000Z"
    };
    view.rerender(<InvoicePdfViewer {...original} signatures={[...original.signatures, workCompletion]} />);

    expect(screen.getByTitle(`${original.invoice.invoiceNumber} PDF preview`)).toBeTruthy();
    expect(clientMocks.loadProtectedInvoicePdf).toHaveBeenCalledTimes(1);
  });
});

function props(): {
  invoice: Invoice;
  job: Job;
  customer: Customer;
  items: JobLineItem[];
  signatures: InvoiceSignature[];
  canGenerate: boolean;
} {
  return {
    invoice: {
      id: "invoice-1",
      jobId: "job-1",
      invoiceNumber: "INV-000001",
      selectedTier: "better",
      subtotalGood: 0,
      subtotalBetter: 100,
      subtotalBest: 0,
      taxRate: 0.06,
      totalGood: 0,
      totalBetter: 106,
      totalBest: 0,
      status: "draft",
      optionLabel: "approved_work",
      notes: "",
      paymentStatus: "unpaid",
      amountPaid: 0,
      approvalStatus: "signed",
      approvedAt: "2026-07-21T16:00:00.000Z",
      pdfStoragePath: "invoice-1/invoice-v1.pdf",
      pdfVersion: 1,
      pdfGeneratedAt: "2026-07-21T16:01:00.000Z",
      pdfSha256: "a".repeat(64),
      pdfSizeBytes: 100,
      createdAt: "2026-07-21T15:00:00.000Z",
      createdBy: "owner-1",
      updatedAt: "2026-07-21T16:01:00.000Z"
    },
    job: {
      id: "job-1",
      customerId: "customer-1",
      status: "in_progress",
      scheduledAt: "2026-07-21T13:00:00.000Z",
      arrivalWindowEndAt: "2026-07-21T16:00:00.000Z",
      arrivedAt: "2026-07-21T13:30:00.000Z",
      serviceAddress: "1 Main Street",
      description: "Repair leak",
      notes: "",
      createdAt: "2026-07-21T12:00:00.000Z"
    },
    customer: {
      id: "customer-1",
      name: "Jordan Customer",
      phone: "703-555-0101",
      phoneDigits: "7035550101",
      email: "jordan@example.com",
      emailNotificationsEnabled: true,
      smsConsentStatus: "unknown",
      addressLine1: "1 Main Street",
      city: "Centreville",
      state: "VA",
      zip: "20120",
      notes: "",
      createdAt: "2026-07-21T12:00:00.000Z",
      createdBy: "owner-1"
    },
    items: [{
      id: "item-1",
      jobId: "job-1",
      description: "Repair",
      quantity: 1,
      unitPrice: 100,
      tier: "better",
      isManual: true,
      sortOrder: 1
    }],
    signatures: [{
      id: "signature-1",
      invoiceId: "invoice-1",
      jobId: "job-1",
      purpose: "invoice_approval",
      signerName: "Jordan Customer",
      signerRole: "customer",
      status: "active",
      contentSha256: "b".repeat(64),
      documentSha256: "c".repeat(64),
      signedAt: "2026-07-21T16:00:00.000Z",
      collectedBy: "tech-1",
      createdAt: "2026-07-21T16:00:00.000Z"
    }],
    canGenerate: true
  };
}
