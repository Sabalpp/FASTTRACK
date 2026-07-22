import { NextRequest, NextResponse } from "next/server";
import { loadJobForActor } from "@/lib/invoice-server";
import { requireServerActor, routeErrorResponse, HttpError } from "@/lib/server-auth";
import { invoiceFromRow, type InvoiceRow } from "@/lib/supabase-mappers";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const actor = await requireServerActor(request);
    const body = await request.json().catch(() => ({})) as { jobId?: unknown };
    const jobId = typeof body.jobId === "string" ? body.jobId : "";
    if (!isUuid(jobId)) throw new HttpError(400, "A valid job is required.");

    const job = await loadJobForActor(actor, jobId);
    if (job.status === "cancelled") {
      throw new HttpError(409, "A cancelled job cannot create a new invoice draft.");
    }
    const { count, error: countError } = await actor.supabase
      .from("job_line_items")
      .select("id", { count: "exact", head: true })
      .eq("job_id", jobId);
    if (countError) throw new HttpError(503, "The job charges could not be checked.");
    if (!count) throw new HttpError(409, "Add at least one work item before building an invoice.");

    const { data, error } = await actor.supabase
      .rpc("create_or_refresh_invoice_draft", {
        p_job_id: jobId,
        p_created_by: actor.user.id
      })
      .single();
    if (error || !data) throw new HttpError(503, error?.message ?? "The invoice draft could not be created.");

    return NextResponse.json({ ok: true, invoice: invoiceFromRow(data as InvoiceRow) });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
