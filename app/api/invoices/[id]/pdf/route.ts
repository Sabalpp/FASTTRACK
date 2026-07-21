import { createHash } from "node:crypto";
import React from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { NextRequest, NextResponse } from "next/server";
import { InvoicePdfDocument } from "@/components/InvoicePdfDocument";
import {
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
    const { invoice, customer } = await loadInvoiceBundle(actor, id);
    if (!invoice.pdfStoragePath) throw new HttpError(404, "No generated PDF is saved for this invoice.");

    const { data, error } = await actor.supabase.storage.from("invoices").download(invoice.pdfStoragePath);
    if (error || !data) throw new HttpError(404, "The saved invoice PDF is unavailable. Generate it again.");
    const bytes = new Uint8Array(await data.arrayBuffer());
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
      .order("created_at", { ascending: false });
    if (signaturesError) throw new HttpError(503, "Saved signatures could not be loaded.");
    const approvalRow = signatureRows?.find((row) => row.purpose === "invoice_approval");
    if (!approvalRow) throw new HttpError(409, "Save the customer approval signature before generating the PDF.");

    const currentDocumentHash = invoiceDocumentHash(bundle);
    if (approvalRow.document_sha256 !== currentDocumentHash) {
      throw new HttpError(409, "The invoice changed after it was signed. Reject and collect the customer signature again.");
    }

    const signatures = await Promise.all((signatureRows ?? []).map(async (row) => signatureFromRow(
      row as Record<string, unknown>,
      await signatureDataUrl(actor.supabase, row.storage_path)
    )));
    const document = React.createElement(InvoicePdfDocument, { ...bundle, signatures }) as unknown as React.ReactElement<DocumentProps>;
    const pdfBuffer = await renderToBuffer(document);
    const pdfBytes = Buffer.from(pdfBuffer);
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
      .select("id")
      .maybeSingle();
    if (invoiceError || !updatedInvoice) {
      await actor.supabase.storage.from("invoices").remove([uploadedPath]);
      uploadedPath = undefined;
      throw new HttpError(invoiceError ? 503 : 409, invoiceError?.message ?? "The signature changed while the PDF was being generated. Try again.");
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
