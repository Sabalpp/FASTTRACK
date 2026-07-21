import { NextRequest, NextResponse } from "next/server";
import { assertSignatureDocumentCurrent, jobCompletionDocumentHash, loadJobForActor } from "@/lib/invoice-server";
import { HttpError, requireServerActor, routeErrorResponse } from "@/lib/server-auth";
import { jobFromRow, type JobRow } from "@/lib/supabase-mappers";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const actor = await requireServerActor(request);
    const { id } = await context.params;
    const job = await loadJobForActor(actor, id);
    if (job.status === "complete") return NextResponse.json({ ok: true, job });
    if (job.status === "cancelled") throw new HttpError(409, "A cancelled job cannot be completed.");
    if (!job.arrivedAt || job.status !== "in_progress") {
      throw new HttpError(409, "Only an arrived job in progress can be completed.");
    }

    const { data: signature, error: signatureError } = await actor.supabase
      .from("invoice_signatures")
      .select("id,document_sha256")
      .eq("job_id", id)
      .eq("purpose", "work_completion")
      .eq("status", "active")
      .maybeSingle();
    if (signatureError) throw new HttpError(503, "The customer signature could not be checked.");
    if (signature) {
      assertSignatureDocumentCurrent(
        signature.document_sha256,
        jobCompletionDocumentHash(job),
        "The job changed after the customer signed. Reject and collect the completion signature again."
      );
    }

    const body = await request.json().catch(() => ({})) as { overrideReason?: unknown };
    const overrideReason = typeof body.overrideReason === "string" ? body.overrideReason.trim() : "";

    if (!signature) {
      if (actor.user.role !== "owner") throw new HttpError(409, "Collect the customer signature before completing this job.");
      if (overrideReason.length < 10 || overrideReason.length > 500) {
        throw new HttpError(400, "Owner override requires a clear reason of at least 10 characters.");
      }
    }

    const { data, error } = await actor.supabase.rpc("complete_job_with_signature", {
      p_job_id: id,
      p_expected_status: job.status,
      p_expected_customer_id: job.customerId,
      p_expected_assigned_tech_id: job.assignedTechId ?? null,
      p_expected_service_address: job.serviceAddress,
      p_expected_description: job.description,
      p_expected_notes: job.notes,
      p_expected_arrived_at: job.arrivedAt,
      p_expected_signature_id: signature?.id ?? null,
      p_expected_signature_document_sha256: signature?.document_sha256 ?? null,
      p_override_by: signature ? null : actor.user.id,
      p_override_reason: signature ? null : overrideReason
    }).single();
    if (error || !data) throw new HttpError(409, error?.message ?? "The job could not be completed.");
    return NextResponse.json({ ok: true, job: jobFromRow(data as JobRow) });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
