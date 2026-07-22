import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { branding } from "@/lib/branding";
import { firstPopulatedTierForItems } from "@/lib/invoice";
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
import type { Customer, Invoice, InvoiceSignature, Job, JobLineItem, SignaturePurpose, Tier } from "@/lib/types";

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

export type InvoiceFieldSignatureRow = {
  id: string;
  purpose: SignaturePurpose;
  status: string;
  selected_tier?: string | null;
  document_sha256?: string | null;
  content_sha256?: string | null;
  signed_at?: string | null;
  created_at?: string | null;
  rejected_at?: string | null;
  authorization_signature_id?: string | null;
  authorization_terms_version?: string | null;
  authorization_subtotal?: string | number | null;
  authorization_tax_rate?: string | number | null;
  authorization_tax_amount?: string | number | null;
  authorization_total?: string | number | null;
};

export const WORK_AUTHORIZATION_TERMS_VERSION = "fast-track-work-authorization-v1";
export const WORK_COMPLETION_TERMS_VERSION = "fast-track-work-completion-v1";

export type WorkAuthorizationBinding = {
  id: string;
  selectedTier: Tier;
  documentSha256: string;
  termsVersion: string;
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  total: number;
};

export type WorkAuthorizationPricing = Omit<WorkAuthorizationBinding, "id" | "selectedTier" | "documentSha256">;

export type InvoiceFieldWorkflow = {
  authorizedTier: Tier;
  authorization: InvoiceFieldSignatureRow;
  completion?: InvoiceFieldSignatureRow;
  completionOverridden: boolean;
};

export type InvoiceWorkAuthorization = Pick<InvoiceFieldWorkflow, "authorizedTier" | "authorization"> & {
  binding: WorkAuthorizationBinding;
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

  const items = (itemRows ?? []).map((row) => lineItemFromRow(row as JobLineItemRow));
  const invoice = invoiceFromRow(invoiceRow as InvoiceRow);
  invoice.selectedTier ??= firstPopulatedTierForItems(items);

  return {
    invoice,
    job: jobFromRow(jobRow as JobRow),
    customer: customerFromRow(customerRow as CustomerRow),
    items
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

  const selectedSubtotal = invoice.selectedTier === "standard"
    ? invoice.subtotalStandard ?? 0
    : invoice.selectedTier === "good"
    ? invoice.subtotalGood
    : invoice.selectedTier === "better"
      ? invoice.subtotalBetter
      : invoice.selectedTier === "best"
        ? invoice.subtotalBest
        : 0;
  const selectedTotal = invoice.selectedTier === "standard"
    ? invoice.totalStandard ?? 0
    : invoice.selectedTier === "good"
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

/**
 * Invoices are a rendering of the customer's field authorization, not a new
 * opportunity to choose a different estimate. This validates that boundary
 * and the separate completion evidence before a PDF can be generated or sent.
 */
export function assertInvoiceFieldWorkflow(
  bundle: InvoiceBundle,
  signatureRows: InvoiceFieldSignatureRow[]
): InvoiceFieldWorkflow {
  const workAuthorization = validateInvoiceWorkAuthorization(bundle, signatureRows);
  if (!workAuthorization) {
    throw new HttpError(409, "Customer work authorization is required before finalizing this invoice.");
  }

  const { authorization, authorizedTier, binding: authorizationBinding } = workAuthorization;
  if (bundle.invoice.selectedTier !== authorizedTier) {
    throw new HttpError(409, "The invoice scope does not match the customer's authorized work. Refresh the invoice draft.");
  }

  const completion = signatureRows.find((signature) => (
    signature.purpose === "work_completion" && signature.status === "active"
  ));
  const completionOverridden = hasAuditedCompletionOverride(bundle.job);
  if (!completion && !completionOverridden) {
    throw new HttpError(409, "Customer completion acknowledgment is required before finalizing this invoice.");
  }
  if (completion) {
    assertCompletionAuthorizationBinding(completion, authorizationBinding);
    assertSignatureDocumentCurrent(
      completion.document_sha256,
      jobCompletionDocumentHash(bundle.job, authorizationBinding),
      "The completed work changed after the customer signed. Reopen the job and collect completion acknowledgment again."
    );
  }

  return { authorizedTier, authorization, completion, completionOverridden };
}

/**
 * Validate an authorization when one exists without making it a prerequisite
 * for viewing or editing an invoice draft. Final PDF generation and delivery
 * call assertInvoiceFieldWorkflow, which adds the completion requirement.
 */
export function validateInvoiceWorkAuthorization(
  bundle: InvoiceBundle,
  signatureRows: InvoiceFieldSignatureRow[]
): InvoiceWorkAuthorization | undefined {
  const authorization = signatureRows.find((signature) => (
    signature.purpose === "work_authorization" && signature.status === "active"
  ));
  if (!authorization) return undefined;

  const authorizedTier = authorization.selected_tier;
  if (!isTier(authorizedTier)) {
    throw new HttpError(409, "The customer work authorization is missing its approved estimate option. Collect it again.");
  }
  assertJobAuthorizationDocumentCurrent(
    authorization.document_sha256,
    bundle.job,
    bundle.items,
    authorizedTier,
    "The authorized work changed after the customer signed. Reopen the job and collect authorization again."
  );
  const authorizationBinding = workAuthorizationBindingFromSignatureRow(authorization);
  assertWorkAuthorizationBindingCurrent(authorizationBinding, bundle.items, authorizedTier);
  return { authorizedTier, authorization, binding: authorizationBinding };
}

export function invoiceSignatureSnapshot(signatureRows: InvoiceFieldSignatureRow[]) {
  return signatureRows
    .map((signature) => [
      signature.id,
      signature.purpose,
      signature.status,
      signature.selected_tier ?? "",
      signature.authorization_signature_id ?? "",
      signature.authorization_terms_version ?? "",
      signature.authorization_subtotal ?? "",
      signature.authorization_tax_rate ?? "",
      signature.authorization_tax_amount ?? "",
      signature.authorization_total ?? "",
      signature.document_sha256 ?? "",
      signature.content_sha256 ?? "",
      signature.signed_at ?? "",
      signature.created_at ?? "",
      signature.rejected_at ?? ""
    ].join(":"))
    .sort()
    .join("|");
}

export function hasAuditedCompletionOverride(job: Job) {
  return Boolean(
    job.completionSignatureOverrideAt
    && job.completionSignatureOverrideBy
    && job.completionSignatureOverrideReason?.trim()
  );
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

export function jobCompletionDocumentHash(job: Job, authorization: WorkAuthorizationBinding) {
  return sha256Json({
    version: 2,
    termsVersion: WORK_COMPLETION_TERMS_VERSION,
    job: {
      id: job.id,
      customerId: job.customerId,
      serviceAddress: job.serviceAddress,
      description: job.description,
      notes: job.notes,
      arrivedAt: job.arrivedAt ?? null
    },
    authorization
  });
}

export function jobAuthorizationDocumentHash(
  job: Job,
  items: JobLineItem[],
  selectedTier: Tier,
  taxRate = branding.taxRate
) {
  return jobAuthorizationDocumentHashWithArrival(job, items, selectedTier, taxRate, false);
}

/**
 * Accept signatures created before arrival was removed from the authorization
 * snapshot. New signatures never use this format, but existing audit records
 * must remain verifiable after this rollout.
 */
export function legacyJobAuthorizationDocumentHash(
  job: Job,
  items: JobLineItem[],
  selectedTier: Tier,
  taxRate = branding.taxRate
) {
  return jobAuthorizationDocumentHashWithArrival(job, items, selectedTier, taxRate, true);
}

export function assertJobAuthorizationDocumentCurrent(
  actualHash: string | null | undefined,
  job: Job,
  items: JobLineItem[],
  selectedTier: Tier,
  message: string
) {
  const canonicalHash = jobAuthorizationDocumentHash(job, items, selectedTier);
  const legacyHash = legacyJobAuthorizationDocumentHash(job, items, selectedTier);
  if (actualHash !== canonicalHash && actualHash !== legacyHash) {
    throw new HttpError(409, message);
  }
}

function jobAuthorizationDocumentHashWithArrival(
  job: Job,
  items: JobLineItem[],
  selectedTier: Tier,
  taxRate: number,
  includeArrivedAt: boolean
) {
  const selectedItems = items
    .filter((item) => item.tier === selectedTier)
    .sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id))
    .map((item) => ({
      id: item.id,
      tier: item.tier,
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      sortOrder: item.sortOrder
    }));

  const jobSnapshot: Record<string, string | null | undefined> = {
    id: job.id,
    customerId: job.customerId,
    serviceAddress: job.serviceAddress,
    description: job.description,
    scheduledAt: job.scheduledAt,
    arrivalWindowEndAt: job.arrivalWindowEndAt
  };
  if (includeArrivedAt) jobSnapshot.arrivedAt = job.arrivedAt ?? null;

  return sha256Json({
    version: 2,
    termsVersion: WORK_AUTHORIZATION_TERMS_VERSION,
    selectedTier,
    pricing: workAuthorizationPricing(items, selectedTier, taxRate),
    job: jobSnapshot,
    selectedItems
  });
}

export function workAuthorizationPricing(
  items: JobLineItem[],
  selectedTier: Tier,
  taxRate = branding.taxRate
): WorkAuthorizationPricing {
  if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 1) {
    throw new HttpError(500, "The configured work-authorization tax rate is invalid.");
  }
  const subtotal = roundMoney(items
    .filter((item) => item.tier === selectedTier)
    .reduce((sum, item) => sum + Number(item.quantity) * Number(item.unitPrice), 0));
  const taxAmount = roundMoney(subtotal * taxRate);
  return {
    termsVersion: WORK_AUTHORIZATION_TERMS_VERSION,
    subtotal,
    taxRate,
    taxAmount,
    total: roundMoney(subtotal + taxAmount)
  };
}

export function workAuthorizationBindingFromSignatureRow(
  row: Pick<
    InvoiceFieldSignatureRow,
    | "id"
    | "selected_tier"
    | "document_sha256"
    | "authorization_terms_version"
    | "authorization_subtotal"
    | "authorization_tax_rate"
    | "authorization_tax_amount"
    | "authorization_total"
  >
): WorkAuthorizationBinding {
  if (!isTier(row.selected_tier) || typeof row.document_sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(row.document_sha256)) {
    throw new HttpError(409, "The saved work authorization is missing its signed scope. Collect it again.");
  }
  const termsVersion = row.authorization_terms_version;
  const subtotal = finiteNumber(row.authorization_subtotal);
  const taxRate = finiteNumber(row.authorization_tax_rate);
  const taxAmount = finiteNumber(row.authorization_tax_amount);
  const total = finiteNumber(row.authorization_total);
  if (
    termsVersion !== WORK_AUTHORIZATION_TERMS_VERSION
    || subtotal === undefined
    || taxRate === undefined
    || taxAmount === undefined
    || total === undefined
  ) {
    throw new HttpError(409, "The saved work authorization predates the current price and terms record. Collect it again.");
  }
  return {
    id: row.id,
    selectedTier: row.selected_tier,
    documentSha256: row.document_sha256,
    termsVersion,
    subtotal,
    taxRate,
    taxAmount,
    total
  };
}

export function assertCompletionAuthorizationBinding(
  completion: Pick<InvoiceFieldSignatureRow, "authorization_signature_id" | "selected_tier">,
  authorization: WorkAuthorizationBinding
) {
  if (
    completion.authorization_signature_id !== authorization.id
    || completion.selected_tier !== authorization.selectedTier
  ) {
    throw new HttpError(409, "The completion signature is not bound to the active customer work authorization. Collect it again.");
  }
}

export function assertWorkAuthorizationBindingCurrent(
  authorization: WorkAuthorizationBinding,
  items: JobLineItem[],
  selectedTier: Tier
) {
  if (
    authorization.selectedTier !== selectedTier
    || !sameAuthorizationPricing(authorization, workAuthorizationPricing(items, selectedTier))
  ) {
    throw new HttpError(409, "The signed authorization price or terms no longer match the approved work. Collect it again.");
  }
}

export function assertJobCanAcceptAuthorization(job: Job) {
  if (job.status === "complete" || job.status === "cancelled") {
    throw new HttpError(409, "This job is closed and cannot accept work authorization.");
  }
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
  const auditMetadata = row.audit_metadata && typeof row.audit_metadata === "object"
    ? row.audit_metadata as Record<string, unknown>
    : undefined;
  const selectedTier = isTier(row.selected_tier)
    ? row.selected_tier
    : isTier(auditMetadata?.selectedTier)
      ? auditMetadata.selectedTier
      : undefined;
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
    selectedTier,
    rejectedAt: row.rejected_at ? String(row.rejected_at) : undefined,
    rejectedBy: row.rejected_by ? String(row.rejected_by) : undefined,
    rejectionReason: row.rejection_reason ? String(row.rejection_reason) : undefined
  };
}

function isTier(value: unknown): value is Tier {
  return value === "standard" || value === "good" || value === "better" || value === "best";
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

function finiteNumber(value: unknown) {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(number) ? number : undefined;
}

function sameAuthorizationPricing(left: WorkAuthorizationPricing, right: WorkAuthorizationPricing) {
  return left.termsVersion === right.termsVersion
    && left.subtotal === right.subtotal
    && left.taxRate === right.taxRate
    && left.taxAmount === right.taxAmount
    && left.total === right.total;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
