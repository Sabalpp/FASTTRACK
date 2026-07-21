import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { branding } from "@/lib/branding";
import {
  buildInvoiceEmailMessage,
  InvoiceDeliveryError,
  sendInvoiceEmail
} from "@/lib/invoice-delivery";
import {
  assertInvoicePdfIntegrity,
  assertInvoiceFieldWorkflow,
  assertSignatureDocumentCurrent,
  invoiceDocumentHash,
  loadInvoiceBundle,
  type InvoiceFieldSignatureRow
} from "@/lib/invoice-server";
import { selectedTotal } from "@/lib/invoice";
import { money } from "@/lib/money";
import { HttpError, requireOwner, requireServerActor, routeErrorResponse } from "@/lib/server-auth";
import { invoiceFromRow, type InvoiceRow } from "@/lib/supabase-mappers";
import type { InvoiceOptionLabel, InvoicePaymentStatus, Tier } from "@/lib/types";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const tiers: Tier[] = ["standard", "good", "better", "best"];
const optionLabels: InvoiceOptionLabel[] = ["standard_service", "approved_work", "selected_option", "custom_estimate"];
const paymentStatuses: InvoicePaymentStatus[] = ["unpaid", "partially_paid", "paid", "refunded", "void"];

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const actor = await requireServerActor(request);
    const { id } = await context.params;
    const bundle = await loadInvoiceBundle(actor, id);
    const signatureRows = await loadInvoiceSignatureAuditRows(actor.supabase, id, bundle.job.id);
    assertInvoiceFieldWorkflow(bundle, signatureRows);
    const { invoice } = bundle;
    return NextResponse.json({ ok: true, invoice }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const actor = await requireServerActor(request);
    requireOwner(actor);
    const { id } = await context.params;
    const bundle = await loadInvoiceBundle(actor, id);
    const signatureRows = await loadInvoiceSignatureAuditRows(actor.supabase, id, bundle.job.id);
    const fieldWorkflow = assertInvoiceFieldWorkflow(bundle, signatureRows);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const action = body.action;

    let patch: Record<string, unknown>;
    let requiredSignedPdfPath: string | undefined;
    if (action === "review") {
      const selectedTier = body.selectedTier as Tier;
      const optionLabel = body.optionLabel as InvoiceOptionLabel;
      const notes = typeof body.notes === "string" ? body.notes.trim() : "";
      if (!tiers.includes(selectedTier)) throw new HttpError(400, "Choose a valid estimate option.");
      if (selectedTier !== fieldWorkflow.authorizedTier) {
        throw new HttpError(409, "The invoice scope must match the customer's authorized work.");
      }
      if (!optionLabels.includes(optionLabel)) throw new HttpError(400, "Choose a valid invoice label.");
      if (notes.length > 4000) throw new HttpError(400, "Invoice notes must be 4,000 characters or fewer.");
      if (!bundle.items.some((item) => item.tier === selectedTier)) {
        throw new HttpError(409, "The selected estimate option has no line items.");
      }
      patch = {
        option_label: optionLabel,
        notes,
        pdf_storage_path: null,
        pdf_generated_at: null,
        pdf_sha256: null,
        pdf_size_bytes: null
      };
    } else if (action === "payment") {
      const paymentStatus = body.paymentStatus as InvoicePaymentStatus;
      if (!paymentStatuses.includes(paymentStatus)) throw new HttpError(400, "Choose a valid payment status.");
      if (!bundle.invoice.selectedTier) throw new HttpError(409, "Select approved work before recording payment.");
      const total = selectedTotal(bundle.invoice);
      const requestedAmount = Number(body.amountPaid);
      let amountPaid = 0;
      if (paymentStatus === "paid") amountPaid = total;
      if (paymentStatus === "partially_paid") {
        amountPaid = Math.round((requestedAmount + Number.EPSILON) * 100) / 100;
        if (!Number.isFinite(amountPaid) || amountPaid <= 0 || amountPaid >= total) {
          throw new HttpError(400, "A partial payment must be greater than zero and less than the invoice total.");
        }
      }
      patch = {
        payment_status: paymentStatus,
        amount_paid: amountPaid,
        status: paymentStatus === "paid" ? "paid" : bundle.invoice.sentAt ? "sent" : "draft",
        pdf_storage_path: null,
        pdf_generated_at: null,
        pdf_sha256: null,
        pdf_size_bytes: null
      };
    } else if (action === "send") {
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const requestId = typeof body.requestId === "string" ? body.requestId.trim().toLowerCase() : "";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Enter a valid customer email.");
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(requestId)) {
        throw new HttpError(400, "A valid invoice email request ID is required.");
      }
      if (!bundle.invoice.pdfStoragePath || !bundle.invoice.pdfGeneratedAt) throw new HttpError(409, "Generate the signed PDF before sending.");
      const technicianAcknowledgement = signatureRows.find((signature) => (
        signature.purpose === "technician_acknowledgement" && signature.status === "active"
      ));
      if (technicianAcknowledgement) {
        assertSignatureDocumentCurrent(
          technicianAcknowledgement.document_sha256,
          invoiceDocumentHash(bundle),
          "The invoice changed after the technician acknowledgment. Collect it again or remove it."
        );
      }

      const generatedAt = Date.parse(bundle.invoice.pdfGeneratedAt);
      const signaturesChangedAfterGeneration = !Number.isFinite(generatedAt) || signatureRows.some((signature) => (
        timestampAfter(signature.created_at, generatedAt) || timestampAfter(signature.rejected_at, generatedAt)
      )) || timestampAfter(bundle.job.completionSignatureOverrideAt, generatedAt);
      if (signaturesChangedAfterGeneration) {
        throw new HttpError(409, "Field signatures changed after the PDF was generated. Generate the signed PDF again.");
      }

      requiredSignedPdfPath = bundle.invoice.pdfStoragePath;
      const { data: savedPdf, error: savedPdfError } = await actor.supabase.storage
        .from("invoices")
        .download(requiredSignedPdfPath);
      if (savedPdfError || !savedPdf) {
        throw new HttpError(409, "The saved invoice PDF is unavailable. Generate it again before emailing.");
      }
      const pdfBytes = new Uint8Array(await savedPdf.arrayBuffer());
      assertInvoicePdfIntegrity(bundle.invoice, pdfBytes);
      const message = buildInvoiceEmailMessage({
        customerName: bundle.customer.name,
        invoiceNumber: bundle.invoice.invoiceNumber,
        balanceLabel: money(Math.max(0, selectedTotal(bundle.invoice) - bundle.invoice.amountPaid)),
        businessName: branding.businessName,
        businessPhone: branding.phone,
        businessEmail: branding.email
      });
      const recipientHash = createHash("sha256").update(email).digest("hex").slice(0, 24);
      const pdfRevision = bundle.invoice.pdfSha256 ?? createHash("sha256").update(pdfBytes).digest("hex");
      try {
        await sendInvoiceEmail({
          to: email,
          ...message,
          idempotencyKey: `invoice/${id}/${pdfRevision}/${recipientHash}/${requestId}`,
          filename: `${bundle.invoice.invoiceNumber}-${bundle.customer.name}.pdf`,
          pdfBytes
        });
      } catch (error) {
        if (error instanceof InvoiceDeliveryError) {
          const configurationHint = error.code === "not_configured"
            ? " Add RESEND_API_KEY and INVOICE_FROM_EMAIL in Vercel, then redeploy."
            : "";
          throw new HttpError(error.retryable || error.code === "not_configured" ? 503 : 502, `${error.message}${configurationHint}`);
        }
        throw error;
      }

      patch = {
        sent_to_email: email,
        sent_at: new Date().toISOString(),
        status: bundle.invoice.paymentStatus === "paid" ? "paid" : "sent"
      };
    } else {
      throw new HttpError(400, "Unknown invoice action.");
    }

    let updateQuery = actor.supabase.from("invoices").update(patch).eq("id", id);
    if (requiredSignedPdfPath) {
      updateQuery = updateQuery
        .eq("selected_tier", fieldWorkflow.authorizedTier)
        .eq("pdf_storage_path", requiredSignedPdfPath);
    }
    const { data, error } = await updateQuery.select("*").maybeSingle();
    if (error || !data) {
      const signedConflict = error?.message?.includes("authorized");
      const staleSend = Boolean(requiredSignedPdfPath && !data && !error);
      throw new HttpError(signedConflict || staleSend ? 409 : 503, error?.message ?? (staleSend
        ? "The signature or generated PDF changed. Review the invoice before sending."
        : "The invoice could not be updated."));
    }
    return NextResponse.json({ ok: true, invoice: invoiceFromRow(data as InvoiceRow) });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

async function loadInvoiceSignatureAuditRows(
  supabase: SupabaseClient,
  invoiceId: string,
  jobId: string
): Promise<InvoiceFieldSignatureRow[]> {
  const fields = "id,purpose,status,selected_tier,document_sha256,content_sha256,signed_at,created_at,rejected_at,authorization_signature_id,authorization_terms_version,authorization_subtotal,authorization_tax_rate,authorization_tax_amount,authorization_total";
  const [fieldResult, acknowledgementResult] = await Promise.all([
    supabase
      .from("invoice_signatures")
      .select(fields)
      .eq("job_id", jobId)
      .in("purpose", ["work_authorization", "work_completion"]),
    supabase
      .from("invoice_signatures")
      .select(fields)
      .eq("invoice_id", invoiceId)
      .eq("purpose", "technician_acknowledgement")
  ]);
  if (fieldResult.error || acknowledgementResult.error) {
    throw new HttpError(503, "Saved field signatures could not be checked.");
  }
  return [
    ...((fieldResult.data ?? []) as InvoiceFieldSignatureRow[]),
    ...((acknowledgementResult.data ?? []) as InvoiceFieldSignatureRow[])
  ];
}

function timestampAfter(value: unknown, reference: number) {
  if (typeof value !== "string" || !value) return false;
  const parsed = Date.parse(value);
  return !Number.isFinite(parsed) || parsed > reference;
}
