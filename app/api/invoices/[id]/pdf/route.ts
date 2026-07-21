import { createHash } from "node:crypto";
import React from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { NextRequest, NextResponse } from "next/server";
import { InvoicePdfDocument } from "@/components/InvoicePdfDocument";
import {
  assertInvoicePdfIntegrity,
  assertSignatureDocumentCurrent,
  invoiceDocumentHash,
  loadInvoiceBundle,
  signatureDataUrl,
  signatureFromRow
} from "@/lib/invoice-server";
import { HttpError, requireServerActor, routeErrorResponse } from "@/lib/server-auth";

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

    const { data: signatureRows, error: signaturesError } = await actor.supabase
      .from("invoice_signatures")
      .select("purpose,status,document_sha256,created_at,rejected_at")
      .eq("invoice_id", id)
      .in("purpose", ["invoice_approval", "technician_acknowledgement"]);
    if (signaturesError) throw new HttpError(503, "Saved signatures could not be checked before loading the PDF.");
    const approval = signatureRows?.find((signature) => (
      signature.purpose === "invoice_approval" && signature.status === "active"
    ));
    if (!approval) throw new HttpError(409, "Save the customer approval signature before loading the PDF.");
    assertSignatureDocumentCurrent(
      approval.document_sha256,
      invoiceDocumentHash(bundle),
      "The invoice changed after it was signed. Reject and collect the customer signature again."
    );
    const generatedAt = Date.parse(invoice.pdfGeneratedAt);
    const signatureSnapshotIsStale = !Number.isFinite(generatedAt) || (signatureRows ?? []).some((signature) => (
      timestampAfter(signature.created_at, generatedAt) || timestampAfter(signature.rejected_at, generatedAt)
    ));
    if (signatureSnapshotIsStale) {
      throw new HttpError(409, "Invoice signatures changed after the PDF was generated. Generate the signed PDF again.");
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
    if (!bundle.invoice.selectedTier) throw new HttpError(409, "An owner must save the approved work before generating the PDF.");

    const { data: signatureRows, error: signaturesError } = await actor.supabase
      .from("invoice_signatures")
      .select("*")
      .eq("invoice_id", id)
      .eq("status", "active")
      .in("purpose", ["invoice_approval", "technician_acknowledgement"])
      .order("created_at", { ascending: false });
    if (signaturesError) throw new HttpError(503, "Saved signatures could not be loaded.");
    const approvalRow = signatureRows?.find((row) => row.purpose === "invoice_approval");
    if (!approvalRow) throw new HttpError(409, "Save the customer approval signature before generating the PDF.");

    const currentDocumentHash = invoiceDocumentHash(bundle);
    assertSignatureDocumentCurrent(
      approvalRow.document_sha256,
      currentDocumentHash,
      "The invoice changed after it was signed. Reject and collect the customer signature again."
    );

    const signatures = await Promise.all((signatureRows ?? []).map(async (row) => signatureFromRow(
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
    const document = React.createElement(InvoicePdfDocument, { ...bundle, signatures }) as unknown as React.ReactElement<DocumentProps>;
    const pdfBuffer = await renderToBuffer(document);
    const pdfBytes = Buffer.from(pdfBuffer);
    const bundleBeforeStore = await loadInvoiceBundle(actor, id);
    if (invoiceDocumentHash(bundleBeforeStore) !== currentDocumentHash) {
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
      pdf_size_bytes: pdfBytes.byteLength
    })
      .eq("id", id)
      .eq("approval_status", "signed")
      .eq("approved_at", String(approvalRow.signed_at))
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
    const storedPdfIsCurrent = invoiceDocumentHash(bundleAfterStore) === currentDocumentHash
      && bundleAfterStore.invoice.pdfStoragePath === uploadedPath
      && bundleAfterStore.invoice.pdfSha256 === pdfSha256
      && bundleAfterStore.invoice.pdfSizeBytes === pdfBytes.byteLength;
    if (!storedPdfIsCurrent) {
      await actor.supabase.from("invoices").update({
        pdf_storage_path: null,
        pdf_generated_at: null,
        pdf_sha256: null,
        pdf_size_bytes: null
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
