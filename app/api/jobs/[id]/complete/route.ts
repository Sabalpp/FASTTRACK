import { NextRequest, NextResponse } from "next/server";
import { loadJobForActor } from "@/lib/invoice-server";
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
    if (!job.arrivedAt) throw new HttpError(409, "Record the technician arrival before completing this job.");

    const { data: signature, error: signatureError } = await actor.supabase
      .from("invoice_signatures")
      .select("id")
      .eq("job_id", id)
      .eq("purpose", "work_completion")
      .eq("status", "active")
      .maybeSingle();
    if (signatureError) throw new HttpError(503, "The customer signature could not be checked.");

    const body = await request.json().catch(() => ({})) as { overrideReason?: unknown };
    const overrideReason = typeof body.overrideReason === "string" ? body.overrideReason.trim() : "";
    const patch: Record<string, unknown> = {
      status: "complete",
      completed_at: new Date().toISOString()
    };

    if (!signature) {
      if (actor.user.role !== "owner") throw new HttpError(409, "Collect the customer signature before completing this job.");
      if (overrideReason.length < 10 || overrideReason.length > 500) {
        throw new HttpError(400, "Owner override requires a clear reason of at least 10 characters.");
      }
      patch.completion_signature_override_at = new Date().toISOString();
      patch.completion_signature_override_by = actor.user.id;
      patch.completion_signature_override_reason = overrideReason;
    }

    const { data, error } = await actor.supabase.from("jobs").update(patch).eq("id", id).select("*").single();
    if (error || !data) throw new HttpError(409, error?.message ?? "The job could not be completed.");
    return NextResponse.json({ ok: true, job: jobFromRow(data as JobRow) });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
