import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  assertInvoicePdfIntegrity,
  assertJobCanAcceptCompletionSignature,
  assertSignatureImageIntegrity,
  assertSignatureDocumentCurrent,
  invoiceDocumentHash,
  jobCompletionDocumentHash,
  type InvoiceBundle
} from "@/lib/invoice-server";
import type { Customer, Invoice, Job, JobLineItem } from "@/lib/types";

describe("signed document integrity", () => {
  it.each(materialInvoiceChanges())("binds the rendered invoice field: %s", (_label, mutate) => {
    const original = invoiceBundle();
    const changed = structuredClone(original);
    mutate(changed);
    expect(invoiceDocumentHash(changed)).not.toBe(invoiceDocumentHash(original));
  });

  it("binds selected line items in their rendered sort order only", () => {
    const original = invoiceBundle();
    const reordered = structuredClone(original);
    reordered.items.reverse();
    expect(invoiceDocumentHash(reordered)).toBe(invoiceDocumentHash(original));

    const unselectedChange = structuredClone(original);
    unselectedChange.items.find((item) => item.tier === "good")!.description = "Unselected work changed";
    expect(invoiceDocumentHash(unselectedChange)).toBe(invoiceDocumentHash(original));
  });

  it("keeps operational payment, delivery, and PDF state outside the customer approval boundary", () => {
    const original = invoiceBundle();
    const operationalUpdate = structuredClone(original);
    Object.assign(operationalUpdate.invoice, {
      status: "sent",
      paymentStatus: "paid",
      amountPaid: 212,
      approvalStatus: "signed",
      approvedAt: "2026-07-21T17:00:00.000Z",
      pdfStoragePath: "invoice-1/invoice-v2.pdf",
      pdfVersion: 2,
      pdfGeneratedAt: "2026-07-21T17:01:00.000Z",
      pdfSha256: "f".repeat(64),
      pdfSizeBytes: 12345,
      sentToEmail: "billing@example.com",
      sentAt: "2026-07-21T17:02:00.000Z",
      updatedAt: "2026-07-21T17:02:00.000Z"
    });
    operationalUpdate.job.completedAt = "2026-07-21T17:03:00.000Z";
    expect(invoiceDocumentHash(operationalUpdate)).toBe(invoiceDocumentHash(original));
  });

  it("verifies both persisted PDF byte size and SHA-256", () => {
    const bytes = new TextEncoder().encode("%PDF-integrity-test");
    const invoice = invoiceBundle().invoice;
    const audited: Invoice = {
      ...invoice,
      pdfSha256: createHash("sha256").update(bytes).digest("hex"),
      pdfSizeBytes: bytes.byteLength
    };
    expect(() => assertInvoicePdfIntegrity(audited, bytes)).not.toThrow();
    expect(() => assertInvoicePdfIntegrity({ ...audited, pdfSizeBytes: bytes.byteLength + 1 }, bytes)).toThrow(/integrity check/i);
    expect(() => assertInvoicePdfIntegrity({ ...audited, pdfSha256: "0".repeat(64) }, bytes)).toThrow(/integrity check/i);
    expect(() => assertInvoicePdfIntegrity({ ...audited, pdfSha256: undefined }, bytes)).toThrow(/missing integrity metadata/i);
  });

  it("verifies stored signature bytes, hash, PNG header, and dimensions before rendering", () => {
    const bytes = pngHeader(640, 240);
    const metadata = {
      mimeType: "image/png",
      width: 640,
      height: 240,
      byteSize: bytes.byteLength,
      contentSha256: createHash("sha256").update(bytes).digest("hex")
    };

    expect(() => assertSignatureImageIntegrity(metadata, bytes)).not.toThrow();
    expect(() => assertSignatureImageIntegrity({ ...metadata, byteSize: bytes.byteLength + 1 }, bytes)).toThrow(/integrity check/i);
    expect(() => assertSignatureImageIntegrity({ ...metadata, contentSha256: "0".repeat(64) }, bytes)).toThrow(/integrity check/i);
    expect(() => assertSignatureImageIntegrity({ ...metadata, width: 641 }, bytes)).toThrow(/integrity check/i);

    const invalidPng = Buffer.from(bytes);
    invalidPng[0] = 0;
    const invalidMetadata = {
      ...metadata,
      contentSha256: createHash("sha256").update(invalidPng).digest("hex")
    };
    expect(() => assertSignatureImageIntegrity(invalidMetadata, invalidPng)).toThrow(/integrity check/i);
  });

  it("rejects a signature whose bound document hash is stale", () => {
    const current = invoiceDocumentHash(invoiceBundle());
    expect(() => assertSignatureDocumentCurrent(current, current, "stale")).not.toThrow();
    expect(() => assertSignatureDocumentCurrent("0".repeat(64), current, "The signature is stale.")).toThrow(/signature is stale/i);
  });

  it("requires arrival before accepting a work-completion signature", () => {
    const scheduled = invoiceBundle().job;
    expect(() => assertJobCanAcceptCompletionSignature(scheduled)).toThrow(/technician arrival/i);
    const arrived = { ...scheduled, status: "in_progress" as const, arrivedAt: "2026-07-21T14:02:00.000Z" };
    expect(() => assertJobCanAcceptCompletionSignature(arrived)).not.toThrow();
  });

  it("detects job changes after a completion signature was collected", () => {
    const job = { ...invoiceBundle().job, arrivedAt: "2026-07-21T14:02:00.000Z" };
    const changed = { ...job, notes: "Additional work was completed after signing." };
    expect(jobCompletionDocumentHash(changed)).not.toBe(jobCompletionDocumentHash(job));
  });
});

function materialInvoiceChanges(): Array<[string, (bundle: InvoiceBundle) => void]> {
  return [
    ["invoice identity", (bundle) => { bundle.invoice.id = "invoice-2"; }],
    ["invoice job", (bundle) => { bundle.invoice.jobId = "job-2"; }],
    ["invoice number", (bundle) => { bundle.invoice.invoiceNumber = "INV-999999"; }],
    ["issue date", (bundle) => { bundle.invoice.createdAt = "2026-07-22T12:00:00.000Z"; }],
    ["selected estimate", (bundle) => { bundle.invoice.selectedTier = "good"; }],
    ["neutral service label", (bundle) => { bundle.invoice.optionLabel = "custom_estimate"; }],
    ["invoice notes", (bundle) => { bundle.invoice.notes = "Revised warranty terms"; }],
    ["tax rate", (bundle) => { bundle.invoice.taxRate = 0.07; }],
    ["selected subtotal", (bundle) => { bundle.invoice.subtotalBetter = 201; }],
    ["selected total", (bundle) => { bundle.invoice.totalBetter = 213.06; }],
    ["customer identity", (bundle) => { bundle.customer.id = "customer-2"; }],
    ["customer name", (bundle) => { bundle.customer.name = "Taylor Customer"; }],
    ["customer phone", (bundle) => { bundle.customer.phone = "703-555-0199"; }],
    ["customer email", (bundle) => { bundle.customer.email = "new@example.com"; }],
    ["billing address line 1", (bundle) => { bundle.customer.addressLine1 = "2 Main Street"; }],
    ["billing address line 2", (bundle) => { bundle.customer.addressLine2 = "Suite 9"; }],
    ["billing city", (bundle) => { bundle.customer.city = "Fairfax"; }],
    ["billing state", (bundle) => { bundle.customer.state = "MD"; }],
    ["billing ZIP", (bundle) => { bundle.customer.zip = "22031"; }],
    ["job identity", (bundle) => { bundle.job.id = "job-2"; }],
    ["job customer", (bundle) => { bundle.job.customerId = "customer-2"; }],
    ["service address", (bundle) => { bundle.job.serviceAddress = "3 Service Road"; }],
    ["job description", (bundle) => { bundle.job.description = "Replace water heater"; }],
    ["job notes", (bundle) => { bundle.job.notes = "Customer requested a follow-up."; }],
    ["scheduled service time", (bundle) => { bundle.job.scheduledAt = "2026-07-21T15:00:00.000Z"; }],
    ["arrival-window end", (bundle) => { bundle.job.arrivalWindowEndAt = "2026-07-21T18:00:00.000Z"; }],
    ["arrival time", (bundle) => { bundle.job.arrivedAt = "2026-07-21T14:02:00.000Z"; }],
    ["selected item identity", (bundle) => { bundle.items[1].id = "item-9"; }],
    ["selected item job", (bundle) => { bundle.items[1].jobId = "job-9"; }],
    ["selected item description", (bundle) => { bundle.items[1].description = "Different approved work"; }],
    ["selected item quantity", (bundle) => { bundle.items[1].quantity = 3; }],
    ["selected item rate", (bundle) => { bundle.items[1].unitPrice = 90; }],
    ["selected item order", (bundle) => { bundle.items[1].sortOrder = 8; }]
  ];
}

function invoiceBundle(): InvoiceBundle {
  const customer: Customer = {
    id: "customer-1",
    name: "Jordan Customer",
    phone: "703-555-0101",
    phoneDigits: "7035550101",
    email: "jordan@example.com",
    emailNotificationsEnabled: true,
    smsConsentStatus: "opted_in",
    smsConsentAt: "2026-07-20T12:00:00.000Z",
    smsConsentSource: "customer",
    addressLine1: "1 Main Street",
    addressLine2: "Unit 2",
    city: "Centreville",
    state: "VA",
    zip: "20120",
    notes: "Internal customer note",
    createdAt: "2026-07-20T12:00:00.000Z",
    createdBy: "owner-1"
  };
  const job: Job = {
    id: "job-1",
    customerId: customer.id,
    assignedTechId: "tech-1",
    status: "scheduled",
    scheduledAt: "2026-07-21T13:00:00.000Z",
    arrivalWindowEndAt: "2026-07-21T16:00:00.000Z",
    serviceAddress: "1 Main Street, Centreville, VA 20120",
    description: "Repair leaking supply line",
    notes: "Installed a new shutoff valve.",
    createdAt: "2026-07-20T12:00:00.000Z"
  };
  const invoice: Invoice = {
    id: "invoice-1",
    jobId: job.id,
    invoiceNumber: "INV-000001",
    selectedTier: "better",
    subtotalGood: 100,
    subtotalBetter: 200,
    subtotalBest: 300,
    taxRate: 0.06,
    totalGood: 106,
    totalBetter: 212,
    totalBest: 318,
    status: "draft",
    optionLabel: "approved_work",
    notes: "One-year workmanship warranty.",
    paymentStatus: "unpaid",
    amountPaid: 0,
    approvalStatus: "signed",
    approvedAt: "2026-07-21T16:10:00.000Z",
    pdfVersion: 0,
    createdAt: "2026-07-21T12:30:00.000Z",
    createdBy: "owner-1",
    updatedAt: "2026-07-21T16:10:00.000Z"
  };
  const items: JobLineItem[] = [
    line("item-good", job.id, "Basic repair", "good", 1, 100, 1),
    line("item-better-2", job.id, "Premium repair second", "better", 1, 80, 2),
    line("item-better-1", job.id, "Premium repair first", "better", 1, 120, 1),
    line("item-best", job.id, "Full replacement", "best", 1, 300, 1)
  ];
  return { invoice, job, customer, items };
}

function line(
  id: string,
  jobId: string,
  description: string,
  tier: JobLineItem["tier"],
  quantity: number,
  unitPrice: number,
  sortOrder: number
): JobLineItem {
  return { id, jobId, description, tier, quantity, unitPrice, sortOrder, isManual: true };
}

function pngHeader(width: number, height: number) {
  const bytes = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}
