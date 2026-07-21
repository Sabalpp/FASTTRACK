// @vitest-environment node

import React from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { InvoicePdfDocument } from "@/components/InvoicePdfDocument";
import { totalsForItems } from "@/lib/invoice";
import type { Customer, Invoice, InvoiceSignature, Job, JobLineItem } from "@/lib/types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = false;

describe("invoice PDF pagination", () => {
  it("keeps a signed service invoice on one true US Letter page", async () => {
    const items = [item(1, "Diagnostic visit and complete HVAC system evaluation"), item(2, "Approved capacitor replacement"), item(3, "System performance verification")];
    const pdf = await render(items, fieldSignatures());

    expect(pdf.getPageCount()).toBe(1);
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
});

async function render(items: JobLineItem[], signatures: InvoiceSignature[]) {
  const props = { invoice: invoice(items), job, customer, items, signatures };
  const document = React.createElement(InvoicePdfDocument, props) as unknown as React.ReactElement<DocumentProps>;
  const buffer = await renderToBuffer(document);
  expect(Buffer.from(buffer).subarray(0, 4).toString()).toBe("%PDF");
  return PDFDocument.load(Buffer.from(buffer));
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

function signature(purpose: "work_authorization" | "work_completion", signedAt: string): InvoiceSignature {
  return {
    id: `signature-${purpose}`,
    jobId: job.id,
    purpose,
    signerName: customer.name,
    signerRole: "customer",
    status: "active",
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
