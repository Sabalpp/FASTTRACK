import { createHash } from "node:crypto";
import React from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { InvoicePdfDocument } from "@/components/InvoicePdfDocument";
import { MAX_JOB_PHOTO_UPLOAD_BYTES } from "@/lib/job-photos";
import {
  assertInvoicePdfIntegrity,
  assertInvoiceFieldWorkflow,
  assertSignatureDocumentCurrent,
  invoiceDocumentHash,
  invoiceSignatureSnapshot,
  loadInvoiceBundle,
  signatureDataUrl,
  signatureFromRow,
  type InvoiceFieldSignatureRow
} from "@/lib/invoice-server";
import { HttpError, requireServerActor, routeErrorResponse } from "@/lib/server-auth";
import type { JobPhoto, PhotoKind } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const actor = await requireServerActor(request);
    const { id } = await context.params;
    const bundle = await loadInvoiceBundle(actor, id);
    const { invoice, customer } = bundle;
    if (!invoice.pdfStoragePath) throw new HttpError(404, "No generated PDF is saved for this invoice.");
    if (!invoice.pdfGeneratedAt) throw new HttpError(409, "The saved invoice PDF is missing generation metadata. Generate it again.");
    if (invoice.pdfWorkflowRevision === undefined || invoice.pdfWorkflowRevision !== (bundle.job.workflowRevision ?? 0)) {
      throw new HttpError(409, "Job photos or field evidence changed after this PDF was generated. Generate it again.");
    }

    const signatureRows = await loadInvoiceSignatureRows(actor.supabase, id, bundle.job.id);
    assertInvoiceFieldWorkflow(bundle, signatureRows);
    assertTechnicianAcknowledgementCurrent(bundle, signatureRows);
    const generatedAt = Date.parse(invoice.pdfGeneratedAt);
    const signatureSnapshotIsStale = !Number.isFinite(generatedAt) || signatureRows.some((signature) => (
      timestampAfter(signature.created_at, generatedAt) || timestampAfter(signature.rejected_at, generatedAt)
    )) || timestampAfter(bundle.job.completionSignatureOverrideAt, generatedAt);
    if (signatureSnapshotIsStale) {
      throw new HttpError(409, "Field signatures changed after the PDF was generated. Generate the signed PDF again.");
    }

    const { data, error } = await actor.supabase.storage.from("invoices").download(invoice.pdfStoragePath);
    if (error || !data) throw new HttpError(404, "The saved invoice PDF is unavailable. Generate it again.");
    const bytes = new Uint8Array(await data.arrayBuffer());
    assertInvoicePdfIntegrity(invoice, bytes);
    return pdfResponse(bytes, invoice.invoiceNumber, customer.name);
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  let uploadedPath: string | undefined;
  try {
    const actor = await requireServerActor(request);
    const { id } = await context.params;
    const bundle = await loadInvoiceBundle(actor, id);
    const [signatureRows, photoRows] = await Promise.all([
      loadInvoiceSignatureRows(actor.supabase, id, bundle.job.id),
      loadInvoicePhotoRows(actor.supabase, bundle.job.id)
    ]);
    const fieldWorkflow = assertInvoiceFieldWorkflow(bundle, signatureRows);
    assertTechnicianAcknowledgementCurrent(bundle, signatureRows);
    const signatureSnapshot = invoiceSignatureSnapshot(signatureRows);
    const photoSnapshot = invoicePhotoSnapshot(photoRows);
    const currentDocumentHash = invoiceDocumentHash(bundle);
    const currentWorkflowRevision = bundle.job.workflowRevision ?? 0;
    const activeSignatureRows = signatureRows.filter((row) => row.status === "active");

    const signatures = await Promise.all(activeSignatureRows.map(async (row) => signatureFromRow(
      row as Record<string, unknown>,
      await signatureDataUrl(actor.supabase, {
        storagePath: row.storage_path,
        mimeType: row.mime_type,
        width: row.width,
        height: row.height,
        byteSize: row.byte_size,
        contentSha256: row.content_sha256
      })
    )));
    const photos = await loadInvoicePhotoImages(actor.supabase, photoRows);
    const document = React.createElement(InvoicePdfDocument, { ...bundle, photos, signatures }) as unknown as React.ReactElement<DocumentProps>;
    const pdfBuffer = await renderToBuffer(document);
    const pdfBytes = Buffer.from(pdfBuffer);
    const bundleBeforeStore = await loadInvoiceBundle(actor, id);
    const [signatureRowsBeforeStore, photoRowsBeforeStore] = await Promise.all([
      loadInvoiceSignatureRows(actor.supabase, id, bundle.job.id),
      loadInvoicePhotoRows(actor.supabase, bundle.job.id)
    ]);
    assertInvoiceFieldWorkflow(bundleBeforeStore, signatureRowsBeforeStore);
    assertTechnicianAcknowledgementCurrent(bundleBeforeStore, signatureRowsBeforeStore);
    if (
      invoiceDocumentHash(bundleBeforeStore) !== currentDocumentHash
      || invoiceSignatureSnapshot(signatureRowsBeforeStore) !== signatureSnapshot
      || invoicePhotoSnapshot(photoRowsBeforeStore) !== photoSnapshot
      || (bundleBeforeStore.job.workflowRevision ?? 0) !== currentWorkflowRevision
    ) {
      throw new HttpError(409, "The invoice changed while the PDF was being generated. Review and try again.");
    }
    const version = bundle.invoice.pdfVersion + 1;
    const pdfSha256 = createHash("sha256").update(pdfBytes).digest("hex");
    uploadedPath = `${bundle.invoice.id}/invoice-v${version}.pdf`;

    const { error: uploadError } = await actor.supabase.storage.from("invoices").upload(uploadedPath, pdfBytes, {
      contentType: "application/pdf",
      cacheControl: "private, max-age=0, no-store",
      upsert: false
    });
    if (uploadError) throw new HttpError(503, "The generated PDF could not be saved.");

    const generatedAt = new Date().toISOString();
    const { data: updatedInvoice, error: invoiceError } = await actor.supabase.from("invoices").update({
      pdf_storage_path: uploadedPath,
      pdf_version: version,
      pdf_generated_at: generatedAt,
      pdf_sha256: pdfSha256,
      pdf_size_bytes: pdfBytes.byteLength,
      pdf_workflow_revision: currentWorkflowRevision
    })
      .eq("id", id)
      .eq("selected_tier", fieldWorkflow.authorizedTier)
      .eq("pdf_version", bundle.invoice.pdfVersion)
      .eq("updated_at", bundle.invoice.updatedAt)
      .select("id")
      .maybeSingle();
    if (invoiceError || !updatedInvoice) {
      await actor.supabase.storage.from("invoices").remove([uploadedPath]);
      uploadedPath = undefined;
      throw new HttpError(invoiceError ? 503 : 409, invoiceError?.message ?? "The signature changed while the PDF was being generated. Try again.");
    }

    const bundleAfterStore = await loadInvoiceBundle(actor, id);
    const [signatureRowsAfterStore, photoRowsAfterStore] = await Promise.all([
      loadInvoiceSignatureRows(actor.supabase, id, bundle.job.id),
      loadInvoicePhotoRows(actor.supabase, bundle.job.id)
    ]);
    const storedPdfIsCurrent = invoiceDocumentHash(bundleAfterStore) === currentDocumentHash
      && invoiceSignatureSnapshot(signatureRowsAfterStore) === signatureSnapshot
      && invoicePhotoSnapshot(photoRowsAfterStore) === photoSnapshot
      && (bundleAfterStore.job.workflowRevision ?? 0) === currentWorkflowRevision
      && bundleAfterStore.invoice.pdfStoragePath === uploadedPath
      && bundleAfterStore.invoice.pdfSha256 === pdfSha256
      && bundleAfterStore.invoice.pdfSizeBytes === pdfBytes.byteLength;
    if (!storedPdfIsCurrent) {
      await actor.supabase.from("invoices").update({
        pdf_storage_path: null,
        pdf_generated_at: null,
        pdf_sha256: null,
        pdf_size_bytes: null,
        pdf_workflow_revision: null
      }).eq("id", id).eq("pdf_storage_path", uploadedPath);
      await actor.supabase.storage.from("invoices").remove([uploadedPath]);
      uploadedPath = undefined;
      throw new HttpError(409, "The invoice changed while the PDF was being generated. Review and try again.");
    }

    return pdfResponse(new Uint8Array(pdfBytes), bundle.invoice.invoiceNumber, bundle.customer.name, {
      "x-invoice-pdf-version": String(version),
      "x-invoice-pdf-sha256": pdfSha256,
      "x-invoice-pdf-generated-at": generatedAt
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

type StoredInvoicePhotoRow = {
  id: string;
  job_id: string;
  storage_path: string;
  kind: PhotoKind;
  caption: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
};

async function loadInvoicePhotoRows(supabase: SupabaseClient, jobId: string): Promise<StoredInvoicePhotoRow[]> {
  const { data, error } = await supabase.from("job_photos")
    .select("id,job_id,storage_path,kind,caption,uploaded_by,uploaded_at")
    .eq("job_id", jobId)
    .order("uploaded_at", { ascending: true });
  if (error) throw new HttpError(503, "Saved job photos could not be loaded for the invoice.");
  return (data ?? []) as StoredInvoicePhotoRow[];
}

async function loadInvoicePhotoImages(
  supabase: SupabaseClient,
  rows: StoredInvoicePhotoRow[]
): Promise<JobPhoto[]> {
  const photos: JobPhoto[] = [];
  let embeddedBytes = 0;
  const maxEmbeddedBytes = 4 * MAX_JOB_PHOTO_UPLOAD_BYTES;
  for (const row of rows) {
    let imageSource = `unavailable:${row.id}`;
    const { data, error } = await supabase.storage.from("job-photos").download(row.storage_path);
    if (!error && data && data.size <= MAX_JOB_PHOTO_UPLOAD_BYTES && embeddedBytes + data.size <= maxEmbeddedBytes) {
      const bytes = Buffer.from(await data.arrayBuffer());
      const mimeType = supportedPhotoMimeType(bytes);
      if (mimeType) {
        imageSource = `data:${mimeType};base64,${bytes.toString("base64")}`;
        embeddedBytes += bytes.byteLength;
      }
    }
    photos.push({
      id: row.id,
      jobId: row.job_id,
      storagePath: imageSource,
      kind: row.kind,
      caption: row.caption ?? undefined,
      uploadedBy: row.uploaded_by ?? "",
      uploadedAt: row.uploaded_at
    });
  }
  return photos;
}

function invoicePhotoSnapshot(rows: StoredInvoicePhotoRow[]) {
  return createHash("sha256").update(JSON.stringify(rows.map((row) => ({
    id: row.id,
    jobId: row.job_id,
    storagePath: row.storage_path,
    kind: row.kind,
    caption: row.caption,
    uploadedBy: row.uploaded_by,
    uploadedAt: row.uploaded_at
  })))).digest("hex");
}

function supportedPhotoMimeType(bytes: Buffer) {
  const isPng = bytes.byteLength >= 8
    && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value);
  if (isPng) return "image/png";
  if (bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return undefined;
}

type StoredInvoiceSignatureRow = InvoiceFieldSignatureRow & {
  storage_path: string;
  mime_type: string;
  width: number;
  height: number;
  byte_size: number;
  content_sha256: string;
};

async function loadInvoiceSignatureRows(
  supabase: SupabaseClient,
  invoiceId: string,
  jobId: string
): Promise<StoredInvoiceSignatureRow[]> {
  const [fieldResult, acknowledgementResult] = await Promise.all([
    supabase
      .from("invoice_signatures")
      .select("*")
      .eq("job_id", jobId)
      .in("purpose", ["work_authorization", "work_completion"])
      .order("created_at", { ascending: false }),
    supabase
      .from("invoice_signatures")
      .select("*")
      .eq("invoice_id", invoiceId)
      .eq("purpose", "technician_acknowledgement")
      .order("created_at", { ascending: false })
  ]);
  if (fieldResult.error || acknowledgementResult.error) {
    throw new HttpError(503, "Saved field signatures could not be loaded.");
  }
  return [
    ...((fieldResult.data ?? []) as StoredInvoiceSignatureRow[]),
    ...((acknowledgementResult.data ?? []) as StoredInvoiceSignatureRow[])
  ];
}

function assertTechnicianAcknowledgementCurrent(
  bundle: Awaited<ReturnType<typeof loadInvoiceBundle>>,
  signatureRows: InvoiceFieldSignatureRow[]
) {
  const acknowledgement = signatureRows.find((signature) => (
    signature.purpose === "technician_acknowledgement" && signature.status === "active"
  ));
  if (!acknowledgement) return;
  assertSignatureDocumentCurrent(
    acknowledgement.document_sha256,
    invoiceDocumentHash(bundle),
    "The invoice changed after the technician acknowledgment. Collect it again or remove it."
  );
}

function pdfResponse(
  bytes: Uint8Array,
  invoiceNumber: string,
  customerName: string,
  additionalHeaders: Record<string, string> = {}
) {
  const filename = `${invoiceNumber}-${customerName}`.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "") || invoiceNumber;
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${filename}.pdf"`,
      "content-length": String(bytes.byteLength),
      "cache-control": "private, no-store, max-age=0",
      ...additionalHeaders
    }
  });
}

function timestampAfter(value: unknown, reference: number) {
  if (typeof value !== "string" || !value) return false;
  const parsed = Date.parse(value);
  return !Number.isFinite(parsed) || parsed > reference;
}
