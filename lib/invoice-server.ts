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
  const selectedItems = bundle.items
    .filter((item) => item.tier === bundle.invoice.selectedTier)
    .map((item) => ({
      id: item.id,
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      sortOrder: item.sortOrder
    }));

  return sha256Json({
    invoiceId: bundle.invoice.id,
    invoiceNumber: bundle.invoice.invoiceNumber,
    jobId: bundle.job.id,
    customerId: bundle.customer.id,
    serviceAddress: bundle.job.serviceAddress,
    selectedTier: bundle.invoice.selectedTier ?? null,
    optionLabel: bundle.invoice.optionLabel,
    taxRate: bundle.invoice.taxRate,
    notes: bundle.invoice.notes,
    totals: {
      subtotalGood: bundle.invoice.subtotalGood,
      subtotalBetter: bundle.invoice.subtotalBetter,
      subtotalBest: bundle.invoice.subtotalBest,
      totalGood: bundle.invoice.totalGood,
      totalBetter: bundle.invoice.totalBetter,
      totalBest: bundle.invoice.totalBest
    },
    selectedItems
  });
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

export async function signatureDataUrl(supabase: SupabaseClient, storagePath: string) {
  const { data, error } = await supabase.storage.from("invoice-signatures").download(storagePath);
  if (error || !data) throw new HttpError(503, "The saved signature image could not be loaded.");
  const bytes = Buffer.from(await data.arrayBuffer());
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

function sha256Json(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
