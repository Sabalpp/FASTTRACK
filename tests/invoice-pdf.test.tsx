// @vitest-environment node

import React from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  CURRENT_INVOICE_APPROVAL_LABEL,
  InvoicePdfDocument,
  invoicePdfDocumentState
} from "@/components/InvoicePdfDocument";
import { totalsForItems } from "@/lib/invoice";
import type { Customer, Invoice, InvoiceSignature, Job, JobLineItem, JobPhoto } from "@/lib/types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = false;

describe("invoice PDF pagination", () => {
  it("keeps a signed service invoice unclipped across true US Letter pages", async () => {
    const items = [item(1, "Diagnostic visit and complete HVAC system evaluation"), item(2, "Approved capacitor replacement"), item(3, "System performance verification")];
    const pdf = await render(items, fieldSignatures());

    expect(pdf.getPageCount()).toBe(2);
    expectLetterPages(pdf);
  }, 30_000);

  it("creates stable Letter continuation pages for a long invoice", async () => {
    const items = Array.from({ length: 34 }, (_, index) => item(
      index + 1,
      `${index + 1}. ${index % 3 === 0
        ? "Commercial air-handler inspection, measured component performance, and documented corrective service"
        : index % 3 === 1
          ? "Replacement part, installation labor, system setup, and operational verification"
          : "Preventive maintenance task with drain, airflow, electrical, and safety checks"}`
    ));
    const pdf = await render(items, fieldSignatures());

    expect(pdf.getPageCount()).toBe(4);
    expectLetterPages(pdf);
  }, 30_000);

  it("renders an unsigned bill as a visible draft instead of refusing the PDF", async () => {
    const items = [item(1, "Current service charge for customer review")];
    const pdf = await render(items, [], true);
    const state = invoicePdfDocumentState(invoice(items), job, [], true);

    expect(pdf.getPageCount()).toBe(1);
    expectLetterPages(pdf);
    expect(state.isDraft).toBe(true);
    expect(state.banner).toContain("CUSTOMER AUTHORIZATION NOT SIGNED");
    expect(state.banner).toContain("COMPLETION ACKNOWLEDGMENT NOT SIGNED");
    expect(state.fieldRecord).toBe("Authorization and completion not signed");
    expect(state.authorizationTerms).toContain("does not record approval to begin work");
    expect(state.completionTerms).toContain("does not record acceptance of completed work");
  }, 30_000);

  it("keeps a complete signature record final unless a draft preview is explicitly requested", () => {
    const items = [item(1, "Signed service")];
    const finalState = invoicePdfDocumentState(invoice(items), job, fieldSignatures());
    const previewState = invoicePdfDocumentState(invoice(items), job, fieldSignatures(), true);

    expect(finalState.isDraft).toBe(false);
    expect(finalState.fieldRecord).toBe("Authorized and completed");
    expect(previewState.isDraft).toBe(true);
    expect(previewState.banner).toBe("DRAFT - PREVIEW ONLY - NOT FINAL");
  });

  it("shows a current invoice approval without treating it as pre-work authorization", async () => {
    const items = [item(1, "Current invoice charge awaiting field authorization records")];
    const approval = signature("invoice_approval", "2026-07-20T16:30:00.000Z");
    const state = invoicePdfDocumentState(invoice(items), job, [approval], true);
    const pdf = await render(items, [approval], true);

    expect(state.isDraft).toBe(true);
    expect(state.missingAuthorization).toBe(true);
    expect(state.missingCompletion).toBe(true);
    expect(state.hasCurrentInvoiceApproval).toBe(true);
    expect(CURRENT_INVOICE_APPROVAL_LABEL).toBe("CURRENT INVOICE APPROVAL (COLLECTED AFTER WORK)");
    expect(pdf.getPageCount()).toBe(2);
    expectLetterPages(pdf);
  }, 30_000);

  it("adds stable, unclipped evidence pages when job photos exist", async () => {
    const items = [item(1, "Completed repair with before-and-after field evidence")];
    const pdf = await render(items, fieldSignatures(), false, Array.from({ length: 5 }, (_, index) => photo(index)));

    expect(pdf.getPageCount()).toBe(4);
    expectLetterPages(pdf);
  }, 30_000);

  it("bounds legacy photo captions so fixed evidence pages cannot overflow", async () => {
    const items = [item(1, "Completed repair with legacy photo captions")];
    const legacyCaption = "Detailed field evidence ".repeat(240);
    const pdf = await render(items, fieldSignatures(), false, Array.from({ length: 4 }, (_, index) => photo(index, legacyCaption)));

    expect(pdf.getPageCount()).toBe(3);
    expectLetterPages(pdf);
  }, 30_000);

  it("shows audited photo skips on a dedicated evidence page even when no image exists", async () => {
    const items = [item(1, "Completed repair with audited photo checkpoint skips")];
    const skippedJob: Job = {
      ...job,
      beforePhotosSkippedAt: "2026-07-20T14:05:00.000Z",
      beforePhotosSkippedBy: "tech-id",
      afterPhotosSkippedAt: "2026-07-20T16:15:00.000Z",
      afterPhotosSkippedBy: "tech-id"
    };
    const pdf = await render(items, fieldSignatures(), false, [], skippedJob);

    expect(pdf.getPageCount()).toBe(3);
    expectLetterPages(pdf);
  }, 30_000);

  it("reserves first-page space when maximum captions and audited skips appear together", async () => {
    const items = [item(1, "Completed repair with photos and audited checkpoint notes")];
    const skippedJob: Job = {
      ...job,
      beforePhotosSkippedAt: "2026-07-20T14:05:00.000Z",
      beforePhotosSkippedBy: "tech-id",
      afterPhotosSkippedAt: "2026-07-20T16:15:00.000Z",
      afterPhotosSkippedBy: "tech-id"
    };
    const maxCaption = "Maximum field caption ".repeat(20);
    const pdf = await render(
      items,
      fieldSignatures(),
      false,
      Array.from({ length: 4 }, (_, index) => ({ ...photo(index, maxCaption), kind: "other" as const })),
      skippedJob
    );

    expect(pdf.getPageCount()).toBe(4);
    expectLetterPages(pdf);
  }, 30_000);
});

async function render(items: JobLineItem[], signatures: InvoiceSignature[], draft = false, photos: JobPhoto[] = [], renderJob = job) {
  const props = { invoice: invoice(items), job: renderJob, customer, items, photos, signatures, draft };
  const document = React.createElement(InvoicePdfDocument, props) as unknown as React.ReactElement<DocumentProps>;
  const buffer = await renderToBuffer(document);
  expect(Buffer.from(buffer).subarray(0, 4).toString()).toBe("%PDF");
  return PDFDocument.load(Buffer.from(buffer));
}

function photo(index: number, caption?: string): JobPhoto {
  return {
    id: `photo-${index}`,
    jobId: job.id,
    kind: index % 2 === 0 ? "before" : "after",
    storagePath: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    caption: caption ?? (index % 2 === 0 ? "Equipment condition before service" : "Completed repair after cleanup"),
    uploadedAt: `2026-07-20T15:0${index}:00.000Z`,
    uploadedBy: "tech-id"
  };
}

function expectLetterPages(pdf: PDFDocument) {
  for (const page of pdf.getPages()) {
    expect(page.getWidth()).toBeCloseTo(612, 3);
    expect(page.getHeight()).toBeCloseTo(792, 3);
  }
}

function invoice(items: JobLineItem[]): Invoice {
  return {
    id: "invoice-id",
    jobId: job.id,
    invoiceNumber: "INV-000123",
    selectedTier: "good",
    ...totalsForItems(items, 0.06),
    status: "draft",
    optionLabel: "approved_work",
    notes: "Approved work completed and reviewed with the customer.",
    paymentStatus: "unpaid",
    amountPaid: 0,
    approvalStatus: "signed",
    approvedAt: "2026-07-20T16:22:00.000Z",
    pdfVersion: 0,
    createdAt: "2026-07-20T16:20:00.000Z",
    createdBy: "owner-id",
    updatedAt: "2026-07-20T16:20:00.000Z"
  };
}

function item(index: number, description: string): JobLineItem {
  return {
    id: `item-${index}`,
    jobId: job.id,
    description,
    quantity: index % 5 === 0 ? 2 : 1,
    unitPrice: 50 + index * 7.25,
    tier: "good",
    isManual: true,
    sortOrder: index
  };
}

function fieldSignatures(): InvoiceSignature[] {
  return [signature("work_authorization", "2026-07-20T15:00:00.000Z"), signature("work_completion", "2026-07-20T16:22:00.000Z")];
}

function signature(purpose: "work_authorization" | "work_completion" | "invoice_approval", signedAt: string): InvoiceSignature {
  return {
    id: `signature-${purpose}`,
    jobId: job.id,
    invoiceId: purpose === "invoice_approval" ? "invoice-id" : undefined,
    purpose,
    signerName: customer.name,
    signerRole: "customer",
    status: "active",
    imageUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    contentSha256: "a".repeat(64),
    documentSha256: "b".repeat(64),
    signedAt,
    collectedBy: "tech-id",
    createdAt: signedAt,
    selectedTier: purpose === "work_authorization" ? "good" : undefined
  };
}

const customer: Customer = {
  id: "customer-id",
  name: "Jordan Taylor",
  phone: "(703) 555-0148",
  phoneDigits: "7035550148",
  email: "jordan@example.com",
  emailNotificationsEnabled: true,
  smsConsentStatus: "opted_in",
  addressLine1: "421 Maple Ridge Drive",
  addressLine2: "Suite 204",
  city: "Ashburn",
  state: "VA",
  zip: "20147",
  notes: "",
  createdAt: "2026-07-18T15:00:00.000Z",
  createdBy: "owner-id"
};

const job: Job = {
  id: "job-id",
  customerId: customer.id,
  assignedTechId: "tech-id",
  status: "complete",
  scheduledAt: "2026-07-20T14:00:00.000Z",
  arrivalWindowEndAt: "2026-07-20T17:00:00.000Z",
  arrivedAt: "2026-07-20T13:54:00.000Z",
  serviceAddress: "421 Maple Ridge Drive, Suite 204, Ashburn, VA 20147",
  description: "Upstairs cooling diagnosis and approved repair.",
  notes: "Approved work completed and reviewed with the customer.",
  createdAt: "2026-07-18T15:05:00.000Z",
  completedAt: "2026-07-20T16:18:00.000Z"
};
