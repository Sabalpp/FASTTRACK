import type { ReactElement } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Customer, Invoice, InvoiceSignature, Job, JobLineItem } from "@/lib/types";

const harness = vi.hoisted(() => ({
  pdf: vi.fn(),
  toBlob: vi.fn(),
  loadProtectedInvoicePdf: vi.fn(),
  generateProtectedInvoicePdf: vi.fn()
}));

vi.mock("@react-pdf/renderer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@react-pdf/renderer")>();
  return { ...actual, pdf: harness.pdf };
});
vi.mock("@/lib/runtime", () => ({ demoMode: false }));
vi.mock("@/lib/invoices-client", () => ({
  loadProtectedInvoicePdf: harness.loadProtectedInvoicePdf,
  generateProtectedInvoicePdf: harness.generateProtectedInvoicePdf
}));

import { InvoiceWorkspacePdf } from "@/app/invoices/[id]/InvoiceWorkspacePdf";

describe("invoice workspace draft PDF", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.toBlob.mockResolvedValue(new Blob(["draft"], { type: "application/pdf" }));
    harness.pdf.mockReturnValue({ toBlob: harness.toBlob });
    harness.generateProtectedInvoicePdf.mockResolvedValue(new Blob(["final"], { type: "application/pdf" }));
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:invoice-preview"),
      revokeObjectURL: vi.fn()
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("creates an unsigned draft locally without persisting or marking it final", async () => {
    const onGenerated = vi.fn();
    render(<InvoiceWorkspacePdf {...props([])} canGenerate={false} onGenerated={onGenerated} />);

    expect(screen.getByRole("heading", { name: "Draft PDF preview" })).toBeTruthy();
    expect(screen.getByText(/CUSTOMER AUTHORIZATION NOT SIGNED/i)).toBeTruthy();
    expect(screen.getByText(/not saved, finalized, or eligible for invoice email delivery/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Preview draft PDF" }));

    await screen.findByTitle("INV-000001 draft PDF preview");
    expect(harness.pdf).toHaveBeenCalledTimes(1);
    const document = harness.pdf.mock.calls[0][0] as ReactElement<{ draft?: boolean }>;
    expect(document.props.draft).toBe(true);
    expect(harness.generateProtectedInvoicePdf).not.toHaveBeenCalled();
    expect(harness.loadProtectedInvoicePdf).not.toHaveBeenCalled();
    expect(onGenerated).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Download draft PDF" }).getAttribute("download")).toMatch(/-DRAFT\.pdf$/);
  });

  it("uses protected generation and the final callback only when field signatures are ready", async () => {
    const onGenerated = vi.fn();
    render(<InvoiceWorkspacePdf {...props(fieldSignatures())} canGenerate onGenerated={onGenerated} />);

    expect(screen.getByRole("heading", { name: "Final invoice PDF" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Generate signed PDF" }));

    await screen.findByTitle("INV-000001 PDF preview");
    expect(harness.generateProtectedInvoicePdf).toHaveBeenCalledWith("invoice-1");
    expect(harness.pdf).not.toHaveBeenCalled();
    await waitFor(() => expect(onGenerated).toHaveBeenCalledTimes(1));
  });
});

function props(signatures: InvoiceSignature[]): {
  invoice: Invoice;
  job: Job;
  customer: Customer;
  items: JobLineItem[];
  signatures: InvoiceSignature[];
} {
  return { invoice, job, customer, items, signatures };
}

const invoice: Invoice = {
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
  notes: "Repair leak",
  paymentStatus: "unpaid",
  amountPaid: 0,
  approvalStatus: "not_signed",
  pdfVersion: 0,
  createdAt: "2026-07-21T15:00:00.000Z",
  createdBy: "owner-1",
  updatedAt: "2026-07-21T15:00:00.000Z"
};

const job: Job = {
  id: "job-1",
  customerId: "customer-1",
  assignedTechId: "tech-1",
  status: "in_progress",
  scheduledAt: "2026-07-21T13:00:00.000Z",
  arrivalWindowEndAt: "2026-07-21T16:00:00.000Z",
  arrivedAt: "2026-07-21T13:30:00.000Z",
  serviceAddress: "1 Main Street",
  description: "Repair leak",
  notes: "",
  createdAt: "2026-07-21T12:00:00.000Z"
};

const customer: Customer = {
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
};

const items: JobLineItem[] = [{
  id: "item-1",
  jobId: "job-1",
  description: "Repair",
  quantity: 1,
  unitPrice: 100,
  tier: "better",
  isManual: true,
  sortOrder: 1
}];

function fieldSignatures(): InvoiceSignature[] {
  return [signature("work_authorization"), signature("work_completion")];
}

function signature(purpose: "work_authorization" | "work_completion"): InvoiceSignature {
  return {
    id: `signature-${purpose}`,
    jobId: job.id,
    purpose,
    signerName: customer.name,
    signerRole: "customer",
    status: "active",
    contentSha256: "a".repeat(64),
    documentSha256: "b".repeat(64),
    signedAt: "2026-07-21T16:00:00.000Z",
    collectedBy: "tech-1",
    createdAt: "2026-07-21T16:00:00.000Z",
    selectedTier: purpose === "work_authorization" ? "better" : undefined
  };
}
