import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  assertJobCanAcceptCompletionSignature,
  invoiceDocumentHash,
  jobCompletionDocumentHash,
  listSignatures,
  loadInvoiceBundle,
  loadJobForActor,
  signatureFromRow
} from "@/lib/invoice-server";
import {
  HttpError,
  requestAuditMetadata,
  requireOwner,
  requireServerActor,
  routeErrorResponse,
  type ServerActor
} from "@/lib/server-auth";
import type { SignaturePurpose, SignatureSignerRole } from "@/lib/types";

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
    if (!(file instanceof File)) throw new HttpError(400, "Draw a signature before saving.");
    if (signerName.length < 2 || signerName.length > 120) throw new HttpError(400, "Enter the signer's full name.");

    const signatureTarget = await resolveTarget(actor, target, purpose, signerRole);
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
        p_audit_metadata: requestAuditMetadata(request, actor)
      })
      .single();

    if (recordError || !data) {
      await actor.supabase.storage.from("invoice-signatures").remove([uploadedPath]);
      uploadedPath = undefined;
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
    requireOwner(actor);
    if (target.type === "invoice") await loadInvoiceBundle(actor, target.id);
    else await loadJobForActor(actor, target.id);

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

    if (existing.purpose === "work_completion") {
      const { data: job } = await actor.supabase.from("jobs").select("status").eq("id", existing.job_id).maybeSingle();
      if (job?.status === "complete") throw new HttpError(409, "Reopen the job before rejecting its completion signature.");
    }

    const { data, error } = await actor.supabase
      .rpc("reject_invoice_signature", {
        p_signature_id: signatureId,
        p_rejected_by: actor.user.id,
        p_reason: reason
      })
      .single();
    if (error || !data) throw new HttpError(503, error?.message ?? "The signature could not be rejected.");

    return NextResponse.json({ ok: true, signature: signatureFromRow(data as Record<string, unknown>) });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

async function resolveTarget(
  actor: ServerActor,
  target: SignatureTarget,
  purpose: SignaturePurpose,
  signerRole: SignatureSignerRole
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
      documentSha256: invoiceDocumentHash(bundle)
    };
  }

  if (purpose !== "work_completion" || signerRole !== "customer") {
    throw new HttpError(400, "Job completion requires a customer signature.");
  }
  const job = await loadJobForActor(actor, target.id);
  assertJobCanAcceptCompletionSignature(job);
  const { data: invoice } = await actor.supabase.from("invoices").select("id").eq("job_id", job.id).maybeSingle();
  return {
    invoiceId: invoice?.id as string | undefined,
    jobId: job.id,
    documentSha256: jobCompletionDocumentHash(job)
  };
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
