import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  assertJobCanAcceptAuthorization,
  assertJobCanAcceptCompletionSignature,
  assertWorkAuthorizationBindingCurrent,
  invoiceDocumentHash,
  jobAuthorizationDocumentHash,
  jobCompletionDocumentHash,
  listSignatures,
  loadInvoiceBundle,
  loadJobForActor,
  signatureFromRow,
  workAuthorizationBindingFromSignatureRow,
  workAuthorizationPricing
} from "@/lib/invoice-server";
import {
  HttpError,
  requestAuditMetadata,
  requireServerActor,
  routeErrorResponse,
  type ServerActor
} from "@/lib/server-auth";
import { lineItemFromRow, type JobLineItemRow } from "@/lib/supabase-mappers";
import type { SignaturePurpose, SignatureSignerRole, Tier } from "@/lib/types";

type SignatureTarget = { type: "invoice" | "job"; id: string };

export async function getSignatureResponse(request: NextRequest, target: SignatureTarget) {
  try {
    const actor = await requireServerActor(request);
    if (target.type === "invoice") await loadInvoiceBundle(actor, target.id);
    else await loadJobForActor(actor, target.id);
    const signatures = await listSignatures(actor.supabase, target.type === "invoice" ? { invoiceId: target.id } : { jobId: target.id });
    return NextResponse.json({ ok: true, signatures }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function postSignatureResponse(request: NextRequest, target: SignatureTarget) {
  let uploadedPath: string | undefined;
  let actor: ServerActor | undefined;
  try {
    actor = await requireServerActor(request);
    const form = await request.formData();
    const file = form.get("signature");
    const signerName = String(form.get("signerName") ?? "").trim();
    const signerRole = String(form.get("signerRole") ?? "") as SignatureSignerRole;
    const purpose = String(form.get("purpose") ?? "") as SignaturePurpose;
    const selectedTier = readTier(form.get("selectedTier"));
    if (!(file instanceof File)) throw new HttpError(400, "Draw a signature before saving.");
    if (signerName.length < 2 || signerName.length > 120) throw new HttpError(400, "Enter the signer's full name.");

    const signatureTarget = await resolveTarget(actor, target, purpose, signerRole, selectedTier);
    const originalBytes = Buffer.from(await file.arrayBuffer());
    const image = validatePng(originalBytes, file.type);
    const signatureId = crypto.randomUUID();
    uploadedPath = `${signatureTarget.jobId}/${signatureId}.png`;
    const signedAt = new Date().toISOString();
    const contentSha256 = createHash("sha256").update(originalBytes).digest("hex");

    const { error: uploadError } = await actor.supabase.storage
      .from("invoice-signatures")
      .upload(uploadedPath, originalBytes, {
        contentType: "image/png",
        cacheControl: "private, max-age=0, no-store",
        upsert: false
      });
    if (uploadError) throw new HttpError(503, "The signature image could not be stored. Nothing was approved.");

    const { data, error: recordError } = await actor.supabase
      .rpc("record_invoice_signature", {
        p_id: signatureId,
        p_invoice_id: signatureTarget.invoiceId ?? null,
        p_job_id: signatureTarget.jobId,
        p_purpose: purpose,
        p_selected_tier: "selectedTier" in signatureTarget ? signatureTarget.selectedTier ?? null : null,
        p_expected_workflow_revision: signatureTarget.workflowRevision,
        p_authorization_signature_id: "authorizationBinding" in signatureTarget && signatureTarget.authorizationBinding
          ? signatureTarget.authorizationBinding.id
          : null,
        p_expected_authorization_document_sha256: "authorizationBinding" in signatureTarget && signatureTarget.authorizationBinding
          ? signatureTarget.authorizationBinding.documentSha256
          : null,
        p_authorization_terms_version: "authorizationPricing" in signatureTarget && signatureTarget.authorizationPricing
          ? signatureTarget.authorizationPricing.termsVersion
          : null,
        p_authorization_subtotal: "authorizationPricing" in signatureTarget && signatureTarget.authorizationPricing
          ? signatureTarget.authorizationPricing.subtotal
          : null,
        p_authorization_tax_rate: "authorizationPricing" in signatureTarget && signatureTarget.authorizationPricing
          ? signatureTarget.authorizationPricing.taxRate
          : null,
        p_authorization_tax_amount: "authorizationPricing" in signatureTarget && signatureTarget.authorizationPricing
          ? signatureTarget.authorizationPricing.taxAmount
          : null,
        p_authorization_total: "authorizationPricing" in signatureTarget && signatureTarget.authorizationPricing
          ? signatureTarget.authorizationPricing.total
          : null,
        p_signer_name: signerName,
        p_signer_role: signerRole,
        p_storage_path: uploadedPath,
        p_width: image.width,
        p_height: image.height,
        p_byte_size: originalBytes.byteLength,
        p_content_sha256: contentSha256,
        p_document_sha256: signatureTarget.documentSha256,
        p_signed_at: signedAt,
        p_collected_by: actor.user.id,
        p_audit_metadata: {
          ...requestAuditMetadata(request, actor),
          workflowRevision: signatureTarget.workflowRevision,
          ...("authorizationBinding" in signatureTarget && signatureTarget.authorizationBinding
            ? { authorizationSignatureId: signatureTarget.authorizationBinding.id }
            : {}),
          ...("selectedTier" in signatureTarget && signatureTarget.selectedTier
            ? { selectedTier: signatureTarget.selectedTier }
            : {})
        }
      })
      .single();

    if (recordError || !data) {
      await actor.supabase.storage.from("invoice-signatures").remove([uploadedPath]);
      uploadedPath = undefined;
      if (recordError?.code === "40001") {
        throw new HttpError(409, recordError.message || "The job changed while the signature was being saved. Review the latest work and sign again.");
      }
      if (recordError?.code === "42501" || recordError?.code === "23514") {
        throw new HttpError(409, recordError.message || "The signed workflow changed. Review it and try again.");
      }
      throw new HttpError(503, "The signature audit record could not be saved. Nothing was approved.");
    }

    const { data: signedUrl } = await actor.supabase.storage.from("invoice-signatures").createSignedUrl(uploadedPath, 10 * 60);
    return NextResponse.json({
      ok: true,
      signature: signatureFromRow(data as Record<string, unknown>, signedUrl?.signedUrl)
    }, { status: 201 });
  } catch (error) {
    if (uploadedPath && actor) await actor.supabase.storage.from("invoice-signatures").remove([uploadedPath]);
    return routeErrorResponse(error);
  }
}

export async function deleteSignatureResponse(request: NextRequest, target: SignatureTarget) {
  try {
    const actor = await requireServerActor(request);
    const targetJob = target.type === "invoice"
      ? (await loadInvoiceBundle(actor, target.id)).job
      : await loadJobForActor(actor, target.id);

    const body = await request.json().catch(() => ({})) as { signatureId?: unknown; reason?: unknown };
    const signatureId = typeof body.signatureId === "string" ? body.signatureId : "";
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!isUuid(signatureId)) throw new HttpError(400, "Choose a valid signature to reject.");
    if (reason.length < 5 || reason.length > 500) throw new HttpError(400, "Give a short reason for rejecting the signature.");

    const { data: existing, error: existingError } = await actor.supabase
      .from("invoice_signatures")
      .select("*")
      .eq("id", signatureId)
      .eq(target.type === "invoice" ? "invoice_id" : "job_id", target.id)
      .eq("status", "active")
      .maybeSingle();
    if (existingError) throw new HttpError(503, "The signature could not be checked.");
    if (!existing) throw new HttpError(404, "Active signature not found.");

    const assignedTechCanRejectAuthorization = existing.purpose === "work_authorization"
      && target.type === "job"
      && actor.user.role === "tech"
      && targetJob.assignedTechId === actor.user.id
      && targetJob.status !== "complete"
      && targetJob.status !== "cancelled";
    if (actor.user.role !== "owner" && !assignedTechCanRejectAuthorization) {
      throw new HttpError(403, "Only an owner can reject invoice or completion signatures. Assigned technicians can only reopen active work authorization.");
    }

    if (existing.purpose === "work_completion") {
      if (targetJob.status === "complete") throw new HttpError(409, "Reopen the job before rejecting its completion signature.");
    }
    if (existing.purpose === "work_authorization" && ["complete", "cancelled"].includes(targetJob.status)) {
      throw new HttpError(409, "Closed jobs cannot reopen customer work authorization.");
    }
    if (existing.purpose === "work_authorization") {
      const { data: downstreamCompletion, error: completionError } = await actor.supabase
        .from("invoice_signatures")
        .select("id")
        .eq("job_id", targetJob.id)
        .eq("purpose", "work_completion")
        .eq("status", "active")
        .eq("authorization_signature_id", existing.id)
        .maybeSingle();
      if (completionError) throw new HttpError(503, "The downstream completion signature could not be checked.");
      if (downstreamCompletion) {
        throw new HttpError(409, "Reject the customer completion signature before reopening its work authorization.");
      }
    }

    const { data, error } = await actor.supabase
      .rpc("reject_invoice_signature", {
        p_signature_id: signatureId,
        p_rejected_by: actor.user.id,
        p_reason: reason
      })
      .single();
    if (error || !data) {
      if (error?.code === "42501" || error?.code === "40001") {
        throw new HttpError(409, error.message || "A downstream signature must be rejected first.");
      }
      throw new HttpError(503, error?.message ?? "The signature could not be rejected.");
    }

    return NextResponse.json({ ok: true, signature: signatureFromRow(data as Record<string, unknown>) });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

async function resolveTarget(
  actor: ServerActor,
  target: SignatureTarget,
  purpose: SignaturePurpose,
  signerRole: SignatureSignerRole,
  selectedTier?: Tier
) {
  if (target.type === "invoice") {
    if (purpose === "invoice_approval" && signerRole !== "customer") {
      throw new HttpError(400, "Customer approval must be signed by the customer.");
    }
    if (purpose === "technician_acknowledgement" && !["technician", "company"].includes(signerRole)) {
      throw new HttpError(400, "Technician acknowledgement must use a technician or company signer role.");
    }
    if (!["invoice_approval", "technician_acknowledgement"].includes(purpose)) {
      throw new HttpError(400, "Choose a valid invoice signature type.");
    }
    const bundle = await loadInvoiceBundle(actor, target.id);
    if (!bundle.invoice.selectedTier) throw new HttpError(409, "An owner must save the approved estimate option before signing.");
    return {
      invoiceId: bundle.invoice.id,
      jobId: bundle.job.id,
      workflowRevision: bundle.job.workflowRevision ?? 0,
      documentSha256: invoiceDocumentHash(bundle)
    };
  }

  const job = await loadJobForActor(actor, target.id);

  if (purpose === "work_authorization") {
    if (signerRole !== "customer") throw new HttpError(400, "Work authorization must be signed by the customer.");
    if (!selectedTier) throw new HttpError(400, "Choose the customer-approved estimate option before signing.");
    assertJobCanAcceptAuthorization(job);
    const [
      { count: beforePhotoCount, error: photoError },
      { data: itemRows, error: itemError },
      { data: activeCompletion, error: completionError }
    ] = await Promise.all([
      actor.supabase.from("job_photos").select("id", { count: "exact", head: true }).eq("job_id", job.id).eq("kind", "before"),
      actor.supabase.from("job_line_items").select("*").eq("job_id", job.id).order("sort_order", { ascending: true }),
      actor.supabase.from("invoice_signatures").select("id").eq("job_id", job.id).eq("purpose", "work_completion").eq("status", "active").maybeSingle()
    ]);
    if (photoError || itemError || completionError) throw new HttpError(503, "The before photos and estimate could not be verified.");
    if (activeCompletion) throw new HttpError(409, "Reject the customer completion signature before replacing work authorization.");
    if (!beforePhotoCount) throw new HttpError(409, "Save at least one before photo before collecting work authorization.");
    const items = (itemRows ?? []).map((row) => lineItemFromRow(row as JobLineItemRow));
    if (!items.some((item) => item.tier === selectedTier)) {
      throw new HttpError(409, "The selected estimate option has no work items.");
    }
    const authorizationPricing = workAuthorizationPricing(items, selectedTier);
    return {
      jobId: job.id,
      selectedTier,
      authorizationPricing,
      workflowRevision: job.workflowRevision ?? 0,
      documentSha256: jobAuthorizationDocumentHash(job, items, selectedTier)
    };
  }

  if (purpose !== "work_completion" || signerRole !== "customer") {
    throw new HttpError(400, "Choose a valid job signature type.");
  }
  assertJobCanAcceptCompletionSignature(job);
  const [
    { data: invoice },
    { count: afterPhotoCount, error: photoError },
    { data: itemRows, error: itemError },
    { data: authorization, error: authorizationError }
  ] = await Promise.all([
    actor.supabase.from("invoices").select("id").eq("job_id", job.id).maybeSingle(),
    actor.supabase.from("job_photos").select("id", { count: "exact", head: true }).eq("job_id", job.id).eq("kind", "after"),
    actor.supabase.from("job_line_items").select("*").eq("job_id", job.id).order("sort_order", { ascending: true }),
    actor.supabase.from("invoice_signatures").select("id,document_sha256,selected_tier,authorization_terms_version,authorization_subtotal,authorization_tax_rate,authorization_tax_amount,authorization_total,audit_metadata").eq("job_id", job.id).eq("purpose", "work_authorization").eq("status", "active").maybeSingle()
  ]);
  if (photoError || itemError || authorizationError) throw new HttpError(503, "The completed work evidence could not be verified.");
  if (!afterPhotoCount) throw new HttpError(409, "Save at least one after photo before collecting the completion signature.");
  if (!authorization) throw new HttpError(409, "Collect customer work authorization before completing the job.");
  const authorizedTier = readTier(authorization.selected_tier)
    ?? readTier((authorization.audit_metadata as Record<string, unknown> | null)?.selectedTier);
  if (!authorizedTier) throw new HttpError(409, "The saved work authorization is missing its approved estimate option.");
  const items = (itemRows ?? []).map((row) => lineItemFromRow(row as JobLineItemRow));
  if (authorization.document_sha256 !== jobAuthorizationDocumentHash(job, items, authorizedTier)) {
    throw new HttpError(409, "The approved work changed after authorization. Reject it and ask the customer to sign again.");
  }
  const authorizationBinding = workAuthorizationBindingFromSignatureRow(authorization);
  assertWorkAuthorizationBindingCurrent(authorizationBinding, items, authorizedTier);
  return {
    invoiceId: invoice?.id as string | undefined,
    jobId: job.id,
    selectedTier: authorizedTier,
    authorizationBinding,
    workflowRevision: job.workflowRevision ?? 0,
    documentSha256: jobCompletionDocumentHash(job, authorizationBinding)
  };
}

function readTier(value: FormDataEntryValue | unknown): Tier | undefined {
  return value === "standard" || value === "good" || value === "better" || value === "best" ? value : undefined;
}

function validatePng(bytes: Buffer, mimeType: string) {
  if (mimeType !== "image/png") throw new HttpError(415, "Signatures must be saved as PNG images.");
  if (bytes.byteLength < 256 || bytes.byteLength > 1024 * 1024) throw new HttpError(413, "The signature image must be under 1 MB.");
  const pngMagic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (pngMagic.some((value, index) => bytes[index] !== value) || bytes.toString("ascii", 12, 16) !== "IHDR") {
    throw new HttpError(415, "The uploaded signature is not a valid PNG image.");
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width < 200 || width > 4096 || height < 100 || height > 2048) {
    throw new HttpError(400, "The signature image dimensions are invalid.");
  }
  return { width, height };
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
