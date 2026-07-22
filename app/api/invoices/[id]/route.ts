import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { branding } from "@/lib/branding";
import { toUsE164Phone } from "@/lib/appointment-confirmations";
import {
  buildInvoiceEmailMessage,
  buildInvoiceSmsMessage,
  getInvoiceDeliveryConfiguration,
  invoiceSmsLinkTtlSeconds,
  InvoiceDeliveryError,
  sendInvoiceEmail,
  sendInvoiceSms,
  type InvoiceDeliveryResult
} from "@/lib/invoice-delivery";
import {
  auditStatusForProviderErrorCode,
  claimInvoiceDelivery,
  InvoiceDeliveryAuditError,
  recordInvoiceDeliveryOutcome,
  type InvoiceDeliveryClaim
} from "@/lib/invoice-delivery-audit";
import {
  assertInvoicePdfIntegrity,
  assertInvoiceFieldWorkflow,
  assertSignatureDocumentCurrent,
  invoiceDocumentHash,
  loadInvoiceBundle,
  validateInvoiceWorkAuthorization,
  type InvoiceFieldSignatureRow
} from "@/lib/invoice-server";
import { selectedTotal } from "@/lib/invoice";
import { money } from "@/lib/money";
import { HttpError, requireOwner, requireServerActor, routeErrorResponse } from "@/lib/server-auth";
import { invoiceFromRow, type InvoiceRow } from "@/lib/supabase-mappers";
import type { InvoiceOptionLabel, Tier } from "@/lib/types";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const tiers: Tier[] = ["standard", "good", "better", "best"];
const optionLabels: InvoiceOptionLabel[] = ["standard_service", "approved_work", "selected_option", "custom_estimate"];

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const actor = await requireServerActor(request);
    const { id } = await context.params;
    const bundle = await loadInvoiceBundle(actor, id);
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
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const action = body.action;

    let patch: Record<string, unknown>;
    let requiredSignedPdfPath: string | undefined;
    let requiredAuthorizedTier: Tier | undefined;
    let requiredWorkflowRevision: number | undefined;
    let deliveryResult: InvoiceDeliveryResult | undefined;
    if (action === "review") {
      const selectedTier = body.selectedTier as Tier;
      const optionLabel = body.optionLabel as InvoiceOptionLabel;
      const notes = typeof body.notes === "string" ? body.notes.trim() : "";
      if (!tiers.includes(selectedTier)) throw new HttpError(400, "Choose a valid estimate option.");
      const signatureRows = await loadInvoiceSignatureAuditRows(actor.supabase, id, bundle.job.id);
      const workAuthorization = validateInvoiceWorkAuthorization(bundle, signatureRows);
      if (workAuthorization && selectedTier !== workAuthorization.authorizedTier) {
        throw new HttpError(409, "The invoice scope must match the customer's authorized work.");
      }
      if (!optionLabels.includes(optionLabel)) throw new HttpError(400, "Choose a valid invoice label.");
      if (notes.length > 4000) throw new HttpError(400, "Invoice notes must be 4,000 characters or fewer.");
      if (!bundle.items.some((item) => item.tier === selectedTier)) {
        throw new HttpError(409, "The selected estimate option has no line items.");
      }
      patch = {
        selected_tier: selectedTier,
        option_label: optionLabel,
        notes,
        pdf_storage_path: null,
        pdf_generated_at: null,
        pdf_sha256: null,
        pdf_size_bytes: null,
        pdf_workflow_revision: null
      };
    } else if (action === "payment") {
      throw new HttpError(409, "Use the card, cash, or check payment ledger. Direct invoice payment edits are disabled.");
    } else if (action === "send") {
      const signatureRows = await loadInvoiceSignatureAuditRows(actor.supabase, id, bundle.job.id);
      const fieldWorkflow = assertInvoiceFieldWorkflow(bundle, signatureRows);
      requiredAuthorizedTier = fieldWorkflow.authorizedTier;
      const channel = body.channel === undefined || body.channel === "email"
        ? "email"
        : body.channel === "sms"
          ? "sms"
          : undefined;
      if (!channel) throw new HttpError(400, "Choose email or text message for invoice delivery.");
      const requestId = typeof body.requestId === "string" ? body.requestId.trim().toLowerCase() : "";
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(requestId)) {
        throw new HttpError(400, "A valid invoice delivery request ID is required.");
      }
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const currentPhone = toUsE164Phone(bundle.customer.phone);
      const requestedPhone = typeof body.phone === "string" && body.phone.trim()
        ? toUsE164Phone(body.phone)
        : currentPhone;
      if (channel === "email") {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Enter a valid customer email.");
        if (bundle.customer.emailNotificationsEnabled === false) {
          throw new HttpError(409, "Customer transactional email updates are disabled. Choose an allowed delivery channel.");
        }
      } else {
        if (!currentPhone || !requestedPhone || requestedPhone !== currentPhone) {
          throw new HttpError(400, "Use the customer's current valid phone number for invoice text delivery.");
        }
        if (bundle.customer.smsConsentStatus !== "opted_in") {
          throw new HttpError(409, "Customer transactional SMS consent is not active. Send by email or record SMS consent first; marketing consent remains separate.");
        }
      }
      if (!bundle.invoice.pdfStoragePath || !bundle.invoice.pdfGeneratedAt) throw new HttpError(409, "Generate the signed PDF before sending.");
      requiredWorkflowRevision = bundle.job.workflowRevision ?? 0;
      if (bundle.invoice.pdfWorkflowRevision === undefined || bundle.invoice.pdfWorkflowRevision !== requiredWorkflowRevision) {
        throw new HttpError(409, "Job photos or field evidence changed after the PDF was generated. Generate it again before sending.");
      }
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
      const balanceLabel = money(Math.max(0, selectedTotal(bundle.invoice) - bundle.invoice.amountPaid));
      const destination = channel === "email" ? email : requestedPhone!;
      const recipientHash = createHash("sha256").update(destination).digest("hex").slice(0, 24);
      const pdfRevision = bundle.invoice.pdfSha256 ?? createHash("sha256").update(pdfBytes).digest("hex");
      const deliveryConfiguration = getInvoiceDeliveryConfiguration();
      if (!deliveryConfiguration[channel].configured) {
        throw new HttpError(503, `Invoice ${channel === "email" ? "email" : "SMS"} delivery is not configured. Configure these server variables in Vercel, then redeploy: ${deliveryConfiguration[channel].missing.join(", ") || "provider credentials"}.`);
      }
      const claim = await claimDeliveryOrThrow(actor.supabase, {
        requestId,
        invoiceId: id,
        channel,
        destination,
        pdfSha256: pdfRevision,
        workflowRevision: requiredWorkflowRevision,
        requestedBy: actor.user.id
      });
      if (claim.decision === "already_accepted") {
        deliveryResult = deliveryResultFromClaim(claim, channel, destination);
      } else if (claim.decision !== "send" || !claim.completionToken) {
        throw deliveryClaimConflict(claim);
      } else {
        try {
          if (channel === "email") {
            const message = buildInvoiceEmailMessage({
              customerName: bundle.customer.name,
              invoiceNumber: bundle.invoice.invoiceNumber,
              balanceLabel,
              businessName: branding.businessName,
              businessPhone: branding.phone,
              businessEmail: branding.email
            });
            deliveryResult = await sendInvoiceEmail({
              to: email,
              ...message,
              idempotencyKey: `invoice/${id}/${pdfRevision}/${recipientHash}/${requestId}`,
              filename: `${bundle.invoice.invoiceNumber}-${bundle.customer.name}.pdf`,
              pdfBytes
            });
          } else {
            const linkTtlSeconds = invoiceSmsLinkTtlSeconds();
            if (!linkTtlSeconds) {
              throw new InvoiceDeliveryError({
                message: "Invoice SMS delivery is not configured.",
                code: "not_configured",
                channel: "sms",
                provider: "twilio"
              });
            }
            const { data: signedPdf, error: signedPdfError } = await actor.supabase.storage
              .from("invoices")
              .createSignedUrl(requiredSignedPdfPath, linkTtlSeconds);
            if (signedPdfError || !signedPdf?.signedUrl || !isSafeHttpsUrl(signedPdf.signedUrl)) {
              throw new InvoiceDeliveryError({
                message: "A private invoice link could not be created. The invoice remains unsent.",
                code: "signed_link_failed",
                channel: "sms",
                provider: "twilio",
                retryable: true
              });
            }
            deliveryResult = await sendInvoiceSms({
              to: requestedPhone!,
              body: buildInvoiceSmsMessage({
                invoiceNumber: bundle.invoice.invoiceNumber,
                balanceLabel,
                businessName: branding.businessName,
                businessPhone: branding.phone,
                invoiceUrl: signedPdf.signedUrl
              })
            });
          }
        } catch (error) {
          await recordDeliveryFailureOrThrow(actor.supabase, {
            requestId,
            completionToken: claim.completionToken,
            channel,
            error
          });
          if (error instanceof InvoiceDeliveryError) {
            const configuration = getInvoiceDeliveryConfiguration();
            const configurationHint = error.code === "not_configured"
              ? ` Configure these server variables in Vercel, then redeploy: ${configuration[error.channel ?? channel].missing.join(", ") || "provider credentials"}.`
              : "";
            throw new HttpError(error.retryable || error.code === "not_configured" ? 503 : 502, `${error.message}${configurationHint}`);
          }
          throw new HttpError(503, "Invoice delivery failed before acceptance. Review the provider status before trying again.");
        }

        try {
          await recordInvoiceDeliveryOutcome(actor.supabase, {
            requestId,
            completionToken: claim.completionToken,
            outcome: {
              status: "accepted",
              provider: deliveryResult.provider,
              providerMessageId: deliveryResult.messageId,
              providerStatus: deliveryResult.status
            }
          });
        } catch {
          throw new HttpError(503, "The provider accepted this invoice, but its audit result could not be saved. Do not send again; retry the same request after checking provider activity.");
        }
      }

      patch = {
        ...(channel === "email" ? { sent_to_email: email } : {}),
        sent_at: new Date().toISOString(),
        status: bundle.invoice.paymentStatus === "paid" ? "paid" : "sent"
      };
    } else {
      throw new HttpError(400, "Unknown invoice action.");
    }

    let updateQuery = actor.supabase.from("invoices").update(patch).eq("id", id);
    if (requiredSignedPdfPath) {
      updateQuery = updateQuery
        .eq("selected_tier", requiredAuthorizedTier!)
        .eq("pdf_storage_path", requiredSignedPdfPath)
        .eq("pdf_sha256", bundle.invoice.pdfSha256!)
        .eq("pdf_workflow_revision", requiredWorkflowRevision!);
    }
    const { data, error } = await updateQuery.select("*").maybeSingle();
    if (error || !data) {
      const signedConflict = error?.message?.includes("authorized");
      const staleSend = Boolean(requiredSignedPdfPath && !data && !error);
      throw new HttpError(signedConflict || staleSend ? 409 : 503, error?.message ?? (staleSend
        ? "The signature or generated PDF changed. Review the invoice before sending."
        : "The invoice could not be updated."));
    }
    return NextResponse.json({
      ok: true,
      invoice: invoiceFromRow(data as InvoiceRow),
      ...(deliveryResult ? { delivery: deliveryResult } : {})
    });
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

function isSafeHttpsUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname);
  } catch {
    return false;
  }
}

async function claimDeliveryOrThrow(
  supabase: SupabaseClient,
  input: Parameters<typeof claimInvoiceDelivery>[1]
) {
  try {
    return await claimInvoiceDelivery(supabase, input);
  } catch (error) {
    if (error instanceof InvoiceDeliveryAuditError) {
      const conflict = error.databaseCode === "23505" || error.databaseCode === "40001";
      throw new HttpError(conflict ? 409 : 503, conflict
        ? "This delivery request no longer matches the saved invoice or destination. Start a new request after reviewing the invoice."
        : "Invoice delivery could not be safely claimed. Nothing was sent.");
    }
    throw error;
  }
}

function deliveryResultFromClaim(
  claim: InvoiceDeliveryClaim,
  channel: "email" | "sms",
  destination: string
): InvoiceDeliveryResult {
  if (!claim.provider || !claim.providerMessageId) {
    throw new HttpError(503, "The accepted delivery audit record is incomplete. Nothing was sent again.");
  }
  return {
    provider: claim.provider,
    messageId: claim.providerMessageId,
    status: claim.providerStatus ?? "accepted",
    channel,
    destination
  };
}

function deliveryClaimConflict(claim: InvoiceDeliveryClaim) {
  if (claim.decision === "already_failed") {
    return new HttpError(409, "This delivery attempt already failed and was not resent. Review the error, then start a new delivery request.");
  }
  if (claim.decision === "delivery_unknown") {
    return new HttpError(409, "This delivery attempt has an unknown provider outcome and was not resent. Check provider activity before starting a new request.");
  }
  return new HttpError(409, "This delivery attempt is already in progress and was not duplicated. Check provider activity before starting a new request.");
}

async function recordDeliveryFailureOrThrow(
  supabase: SupabaseClient,
  input: {
    requestId: string;
    completionToken: string;
    channel: "email" | "sms";
    error: unknown;
  }
) {
  const configuration = getInvoiceDeliveryConfiguration();
  const provider = input.error instanceof InvoiceDeliveryError && input.error.provider
    ? input.error.provider
    : configuration[input.channel].provider;
  if (!provider) {
    throw new HttpError(503, "Invoice delivery failed before a provider could be identified. The request remains fenced and was not resent.");
  }
  const errorCode = input.error instanceof InvoiceDeliveryError ? input.error.code : "unexpected_error";
  const status = input.error instanceof InvoiceDeliveryError
    ? auditStatusForProviderErrorCode(errorCode)
    : "delivery_unknown";
  try {
    await recordInvoiceDeliveryOutcome(supabase, {
      requestId: input.requestId,
      completionToken: input.completionToken,
      outcome: {
        status,
        provider,
        providerStatus: input.error instanceof InvoiceDeliveryError && input.error.status
          ? `http_${input.error.status}`
          : undefined,
        errorCode
      }
    });
  } catch {
    throw new HttpError(503, "Invoice delivery failed, but its audit outcome could not be saved. Do not resend until provider activity is checked.");
  }
}
