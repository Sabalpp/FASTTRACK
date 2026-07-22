import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import React from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { InvoicePdfDocument } from "../components/InvoicePdfDocument";
import { totalsForItems } from "../lib/invoice";
import type { Customer, Invoice, InvoiceSignature, Job, JobLineItem, JobPhoto } from "../lib/types";

async function main() {
const outputDirectory = path.resolve("output/pdf");
await mkdir(outputDirectory, { recursive: true });

const signatureSvg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="900" height="260" viewBox="0 0 900 260">
    <rect width="900" height="260" fill="#ffffff"/>
    <path d="M40 185 C110 45 130 220 215 120 C270 55 255 205 350 125 C410 75 430 180 505 112 C570 55 595 185 665 115 C720 60 755 135 850 92" fill="none" stroke="#102a36" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M205 205 C385 215 585 210 835 185" fill="none" stroke="#102a36" stroke-width="7" stroke-linecap="round"/>
  </svg>
`;
const signatureDataUrl = `data:image/svg+xml;base64,${Buffer.from(signatureSvg).toString("base64")}`;

const customer: Customer = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "Jordan Taylor",
  phone: "(703) 555-0148",
  phoneDigits: "7035550148",
  email: "jordan.taylor@example.com",
  emailNotificationsEnabled: true,
  smsConsentStatus: "opted_in",
  addressLine1: "421 Maple Ridge Drive",
  addressLine2: "Suite 204",
  city: "Ashburn",
  state: "VA",
  zip: "20147",
  notes: "",
  createdAt: "2026-07-18T15:00:00.000Z",
  createdBy: "11111111-1111-4111-8111-111111111111"
};

const job: Job = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  customerId: customer.id,
  assignedTechId: "22222222-2222-4222-8222-222222222222",
  status: "complete",
  scheduledAt: "2026-07-20T14:00:00.000Z",
  arrivalWindowEndAt: "2026-07-20T17:00:00.000Z",
  arrivedAt: "2026-07-20T13:54:00.000Z",
  serviceAddress: "421 Maple Ridge Drive, Suite 204, Ashburn, VA 20147",
  description: "Upstairs cooling system diagnosis and approved repair.",
  notes: "Replaced the failed dual-run capacitor, verified compressor amperage, and tested a full cooling cycle.",
  createdAt: "2026-07-18T15:05:00.000Z",
  completedAt: "2026-07-20T16:18:00.000Z"
};

const baseItems: JobLineItem[] = [
  item(1, "Diagnostic visit and complete HVAC system evaluation", 1, 89),
  item(2, "45/5 MFD dual-run capacitor replacement", 1, 245),
  item(3, "System performance test and operating-temperature verification", 1, 95)
];

const authorizationSignature: InvoiceSignature = {
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  jobId: job.id,
  purpose: "work_authorization",
  signerName: "Jordan Taylor",
  signerRole: "customer",
  status: "active",
  imageUrl: signatureDataUrl,
  contentSha256: "a".repeat(64),
  documentSha256: "b".repeat(64),
  signedAt: "2026-07-20T14:12:00.000Z",
  collectedBy: "22222222-2222-4222-8222-222222222222",
  createdAt: "2026-07-20T14:12:00.000Z",
  selectedTier: "good"
};

const completionSignature: InvoiceSignature = {
  ...authorizationSignature,
  id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
  purpose: "work_completion",
  selectedTier: undefined,
  signedAt: "2026-07-20T16:22:00.000Z",
  createdAt: "2026-07-20T16:22:00.000Z"
};

const fieldSignatures = [authorizationSignature, completionSignature];

const samplePhotoDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const samplePhotos: JobPhoto[] = Array.from({ length: 5 }, (_, index) => ({
  id: `99999999-9999-4999-8999-${String(index).padStart(12, "0")}`,
  jobId: job.id,
  kind: index % 2 === 0 ? "before" : "after",
  storagePath: samplePhotoDataUrl,
  caption: index % 2 === 0 ? "Equipment condition before service" : "Completed repair after cleanup",
  uploadedAt: `2026-07-20T15:0${index}:00.000Z`,
  uploadedBy: "22222222-2222-4222-8222-222222222222"
}));

const samples: Array<{ filename: string; customer: Customer; job: Job; items: JobLineItem[]; invoice: Invoice; signatures: InvoiceSignature[]; photos?: JobPhoto[] }> = [];

samples.push({
  filename: "one-page-invoice.pdf",
  customer,
  job,
  items: baseItems.slice(0, 2),
  invoice: makeInvoice(baseItems.slice(0, 2), { notes: "Diagnostic completed and approved capacitor replacement installed." }),
  signatures: []
});

samples.push({
  filename: "signed-invoice.pdf",
  customer,
  job,
  items: baseItems,
  invoice: makeInvoice(baseItems),
  signatures: fieldSignatures
});

samples.push({
  filename: "photo-evidence-invoice.pdf",
  customer,
  job,
  items: baseItems,
  invoice: makeInvoice(baseItems),
  signatures: fieldSignatures,
  photos: samplePhotos
});

samples.push({
  filename: "skipped-photo-checkpoints-invoice.pdf",
  customer,
  job: {
    ...job,
    beforePhotosSkippedAt: "2026-07-20T14:05:00.000Z",
    beforePhotosSkippedBy: "22222222-2222-4222-8222-222222222222",
    afterPhotosSkippedAt: "2026-07-20T16:15:00.000Z",
    afterPhotosSkippedBy: "22222222-2222-4222-8222-222222222222"
  },
  items: baseItems,
  invoice: makeInvoice(baseItems),
  signatures: fieldSignatures
});

samples.push({
  filename: "combined-photo-and-skip-invoice.pdf",
  customer,
  job: {
    ...job,
    beforePhotosSkippedAt: "2026-07-20T14:05:00.000Z",
    beforePhotosSkippedBy: "22222222-2222-4222-8222-222222222222",
    afterPhotosSkippedAt: "2026-07-20T16:15:00.000Z",
    afterPhotosSkippedBy: "22222222-2222-4222-8222-222222222222"
  },
  items: baseItems,
  invoice: makeInvoice(baseItems),
  signatures: fieldSignatures,
  photos: samplePhotos.slice(0, 4).map((photo) => ({
    ...photo,
    kind: "other" as const,
    caption: "Supporting field evidence with a bounded caption that remains inside the reserved photo card area. ".repeat(3)
  }))
});

const multiPageItems = Array.from({ length: 34 }, (_, index) => item(
  index + 1,
  `${index + 1}. ${index % 3 === 0 ? "Commercial air-handler inspection, measured component performance, and documented corrective service" : index % 3 === 1 ? "Replacement part, installation labor, system setup, and operational verification" : "Preventive maintenance task with drain, airflow, electrical, and safety checks"}`,
  index % 5 === 0 ? 2 : 1,
  38 + index * 7.25
));
samples.push({
  filename: "multi-page-invoice.pdf",
  customer,
  job,
  items: multiPageItems,
  invoice: makeInvoice(multiPageItems, { notes: "Multi-system service visit. Each completed item is listed separately for the property manager's records." }),
  signatures: fieldSignatures
});

const longCustomer: Customer = {
  ...customer,
  name: "Alexandria Property Management Group on behalf of Jordan and Morgan Taylor",
  addressLine1: "18974 North Potomac View Terrace at Historic Broadlands Service Complex",
  addressLine2: "Building C, Mechanical Room 14, Access through the south loading courtyard",
  city: "Washington Metropolitan Service District",
  state: "VA",
  zip: "20148-7712",
  email: "facilities-and-maintenance-invoices@example-property-management.com"
};
const longJob: Job = {
  ...job,
  serviceAddress: "18974 North Potomac View Terrace at Historic Broadlands Service Complex, Building C, Mechanical Room 14, Washington Metropolitan Service District, VA 20148-7712",
  description: "Investigate intermittent cooling loss across the tenant suite and document the approved repair for the facilities team.",
  notes: "Technician coordinated access with the on-site facilities manager. Condensate routing, electrical terminations, refrigerant temperatures, airflow, and thermostat staging were reviewed after the repair. The system completed three full operating cycles without a recurring fault."
};
const longItems = Array.from({ length: 12 }, (_, index) => item(
  index + 1,
  `${index + 1}. Detailed commercial service line item covering diagnosis, protected work-area setup, removal of the failed component, installation of the approved replacement, cleanup, commissioning, and documented performance verification for the facilities record`,
  index % 4 === 0 ? 2.5 : 1,
  112.5 + index * 31.75
));
samples.push({
  filename: "long-address-and-line-items-invoice.pdf",
  customer: longCustomer,
  job: longJob,
  items: longItems,
  invoice: makeInvoice(longItems, { notes: longJob.notes }),
  signatures: fieldSignatures
});

for (const sample of samples) {
  const document = React.createElement(InvoicePdfDocument, sample) as unknown as React.ReactElement<DocumentProps>;
  const buffer = await renderToBuffer(document);
  await writeFile(path.join(outputDirectory, sample.filename), Buffer.from(buffer));
  process.stdout.write(`${sample.filename}\n`);
}

function item(index: number, description: string, quantity: number, unitPrice: number): JobLineItem {
  return {
    id: `eeeeeeee-eeee-4eee-8eee-${String(index).padStart(12, "0")}`,
    jobId: job.id,
    description,
    quantity,
    unitPrice,
    tier: "good",
    isManual: true,
    sortOrder: index
  };
}

function makeInvoice(items: JobLineItem[], patch: Partial<Invoice> = {}): Invoice {
  const totals = totalsForItems(items, 0.06);
  return {
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    jobId: job.id,
    invoiceNumber: "INV-004218",
    selectedTier: "good",
    ...totals,
    status: "draft",
    optionLabel: "approved_work",
    notes: job.notes,
    paymentStatus: "unpaid",
    amountPaid: 0,
    approvalStatus: "not_signed",
    pdfVersion: 0,
    createdAt: "2026-07-20T16:20:00.000Z",
    createdBy: "11111111-1111-4111-8111-111111111111",
    updatedAt: "2026-07-20T16:20:00.000Z",
    ...patch
  };
}
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
