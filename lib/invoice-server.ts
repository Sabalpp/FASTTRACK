import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError, assertOwnerOrAssignedTech, type ServerActor } from "@/lib/server-auth";
import {
  customerFromRow,
  invoiceFromRow,
  jobFromRow,
  lineItemFromRow,
  type CustomerRow,
  type InvoiceRow,
  type JobLineItemRow,
  type JobRow
} from "@/lib/supabase-mappers";
import type { Customer, Invoice, InvoiceSignature, Job, JobLineItem, SignaturePurpose } from "@/lib/types";

export type InvoiceBundle = {
  invoice: Invoice;
  job: Job;
  customer: Customer;
  items: JobLineItem[];
};

export type SignatureImageIntegrityMetadata = {
  storagePath: string;
  mimeType: string;
  width: number;
  height: number;
  byteSize: number;
  contentSha256: string;
};

export async function loadInvoiceBundle(actor: ServerActor, invoiceId: string): Promise<InvoiceBundle> {
  const { data: invoiceRow, error: invoiceError } = await actor.supabase
    .from("invoices")
    .select("*")
    .eq("id", invoiceId)
    .maybeSingle();
  if (invoiceError) throw new HttpError(503, "The invoice could not be loaded.");
  if (!invoiceRow) throw new HttpError(404, "Invoice not found.");

  const { data: jobRow, error: jobError } = await actor.supabase
    .from("jobs")
    .select("*")
    .eq("id", invoiceRow.job_id)
    .maybeSingle();
  if (jobError) throw new HttpError(503, "The related job could not be loaded.");
  if (!jobRow) throw new HttpError(404, "The related job was not found.");
  assertOwnerOrAssignedTech(actor, jobRow.assigned_tech_id);

  const [{ data: customerRow, error: customerError }, { data: itemRows, error: itemError }] = await Promise.all([
    actor.supabase.from("customers").select("*").eq("id", jobRow.customer_id).maybeSingle(),
    actor.supabase.from("job_line_items").select("*").eq("job_id", jobRow.id).order("sort_order", { ascending: true })
  ]);
  if (customerError || !customerRow) throw new HttpError(503, "The invoice customer could not be loaded.");
  if (itemError) throw new HttpError(503, "The invoice line items could not be loaded.");

  return {
    invoice: invoiceFromRow(invoiceRow as InvoiceRow),
    job: jobFromRow(jobRow as JobRow),
    customer: customerFromRow(customerRow as CustomerRow),
    items: (itemRows ?? []).map((row) => lineItemFromRow(row as JobLineItemRow))
  };
}

export async function loadJobForActor(actor: ServerActor, jobId: string): Promise<Job> {
  const { data, error } = await actor.supabase.from("jobs").select("*").eq("id", jobId).maybeSingle();
  if (error) throw new HttpError(503, "The job could not be loaded.");
  if (!data) throw new HttpError(404, "Job not found.");
  assertOwnerOrAssignedTech(actor, data.assigned_tech_id);
  return jobFromRow(data as JobRow);
}

export function invoiceDocumentHash(bundle: InvoiceBundle) {
  const { invoice, job, customer } = bundle;
  const selectedItems = bundle.items
    .filter((item) => item.tier === invoice.selectedTier)
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((item) => ({
      id: item.id,
      jobId: item.jobId,
      tier: item.tier,
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      sortOrder: item.sortOrder
    }));

  const selectedSubtotal = invoice.selectedTier === "good"
    ? invoice.subtotalGood
    : invoice.selectedTier === "better"
      ? invoice.subtotalBetter
      : invoice.selectedTier === "best"
        ? invoice.subtotalBest
        : 0;
  const selectedTotal = invoice.selectedTier === "good"
    ? invoice.totalGood
    : invoice.selectedTier === "better"
      ? invoice.totalBetter
      : invoice.selectedTier === "best"
        ? invoice.totalBest
        : 0;

  return sha256Json({
    version: 2,
    invoice: {
      id: invoice.id,
      jobId: invoice.jobId,
      invoiceNumber: invoice.invoiceNumber,
      createdAt: invoice.createdAt,
      selectedTier: invoice.selectedTier ?? null,
      optionLabel: invoice.optionLabel,
      notes: invoice.notes,
      taxRate: invoice.taxRate,
      selectedSubtotal,
      selectedTax: selectedTotal - selectedSubtotal,
      selectedTotal
    },
    customer: {
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      email: customer.email ?? null,
      addressLine1: customer.addressLine1,
      addressLine2: customer.addressLine2 ?? null,
      city: customer.city,
      state: customer.state,
      zip: customer.zip
    },
    job: {
      id: job.id,
      customerId: job.customerId,
      serviceAddress: job.serviceAddress,
      description: job.description,
      notes: job.notes,
      scheduledAt: job.scheduledAt,
      arrivalWindowEndAt: job.arrivalWindowEndAt,
      arrivedAt: job.arrivedAt ?? null,
      serviceDate: job.arrivedAt ?? job.scheduledAt
    },
    selectedItems
  });
}

export function assertSignatureDocumentCurrent(
  signatureDocumentSha256: unknown,
  currentDocumentSha256: string,
  message: string
) {
  if (signatureDocumentSha256 !== currentDocumentSha256) throw new HttpError(409, message);
}

export function assertInvoicePdfIntegrity(invoice: Invoice, bytes: Uint8Array) {
  if (!invoice.pdfSha256 || invoice.pdfSizeBytes === undefined) {
    throw new HttpError(409, "The saved invoice PDF is missing integrity metadata. Generate it again.");
  }
  if (bytes.byteLength !== invoice.pdfSizeBytes) {
    throw new HttpError(409, "The saved invoice PDF failed its integrity check. Generate it again.");
  }
  const actualSha256 = createHash("sha256").update(bytes).digest("hex");
  if (actualSha256 !== invoice.pdfSha256) {
    throw new HttpError(409, "The saved invoice PDF failed its integrity check. Generate it again.");
  }
}

export function jobCompletionDocumentHash(job: Job) {
  return sha256Json({
    jobId: job.id,
    customerId: job.customerId,
    serviceAddress: job.serviceAddress,
    description: job.description,
    notes: job.notes,
    arrivedAt: job.arrivedAt ?? null
  });
}

export function assertJobCanAcceptCompletionSignature(job: Job) {
  if (job.status === "complete" || job.status === "cancelled") {
    throw new HttpError(409, "This job is no longer open for signature collection.");
  }
  if (!job.arrivedAt) {
    throw new HttpError(409, "Record the technician arrival before collecting the completion signature.");
  }
}

export async function listSignatures(
  supabase: SupabaseClient,
  filter: { invoiceId?: string; jobId?: string }
): Promise<InvoiceSignature[]> {
  let query = supabase.from("invoice_signatures").select("*").order("created_at", { ascending: false });
  if (filter.invoiceId) query = query.eq("invoice_id", filter.invoiceId);
  if (filter.jobId) query = query.eq("job_id", filter.jobId);
  const { data, error } = await query;
  if (error) throw new HttpError(503, "Signatures could not be loaded.");

  return Promise.all((data ?? []).map(async (row) => {
    const { data: signedUrl } = await supabase.storage.from("invoice-signatures").createSignedUrl(row.storage_path, 10 * 60);
    return signatureFromRow(row, signedUrl?.signedUrl);
  }));
}

export function signatureFromRow(row: Record<string, unknown>, imageUrl?: string): InvoiceSignature {
  return {
    id: String(row.id),
    invoiceId: row.invoice_id ? String(row.invoice_id) : undefined,
    jobId: String(row.job_id),
    purpose: row.purpose as SignaturePurpose,
    signerName: String(row.signer_name),
    signerRole: row.signer_role as InvoiceSignature["signerRole"],
    status: row.status as InvoiceSignature["status"],
    storagePath: String(row.storage_path),
    imageUrl,
    contentSha256: String(row.content_sha256),
    documentSha256: String(row.document_sha256),
    signedAt: String(row.signed_at),
    collectedBy: String(row.collected_by),
    createdAt: String(row.created_at),
    rejectedAt: row.rejected_at ? String(row.rejected_at) : undefined,
    rejectedBy: row.rejected_by ? String(row.rejected_by) : undefined,
    rejectionReason: row.rejection_reason ? String(row.rejection_reason) : undefined
  };
}

export async function signatureDataUrl(
  supabase: SupabaseClient,
  signature: SignatureImageIntegrityMetadata
) {
  const { data, error } = await supabase.storage.from("invoice-signatures").download(signature.storagePath);
  if (error || !data) throw new HttpError(503, "The saved signature image could not be loaded.");
  const bytes = Buffer.from(await data.arrayBuffer());
  assertSignatureImageIntegrity(signature, bytes);
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

export function assertSignatureImageIntegrity(
  signature: Omit<SignatureImageIntegrityMetadata, "storagePath">,
  bytes: Uint8Array
) {
  if (
    signature.mimeType !== "image/png"
    || !Number.isInteger(signature.byteSize)
    || bytes.byteLength !== signature.byteSize
  ) {
    throw new HttpError(409, "The saved signature image failed its integrity check. Collect the signature again.");
  }

  const actualSha256 = createHash("sha256").update(bytes).digest("hex");
  if (actualSha256 !== signature.contentSha256) {
    throw new HttpError(409, "The saved signature image failed its integrity check. Collect the signature again.");
  }

  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pngMagic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const validHeader = buffer.byteLength >= 24
    && pngMagic.every((value, index) => buffer[index] === value)
    && buffer.readUInt32BE(8) === 13
    && buffer.toString("ascii", 12, 16) === "IHDR";
  if (
    !validHeader
    || buffer.readUInt32BE(16) !== signature.width
    || buffer.readUInt32BE(20) !== signature.height
  ) {
    throw new HttpError(409, "The saved signature image failed its integrity check. Collect the signature again.");
  }
}

function sha256Json(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
