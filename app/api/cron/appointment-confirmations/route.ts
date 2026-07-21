import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { deliverClaimedAppointmentNotification } from "@/lib/appointment-confirmation-delivery-server";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import { appointmentNotificationFromRow } from "@/lib/supabase-mappers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type AppointmentNotificationRow = Parameters<typeof appointmentNotificationFromRow>[0];
const JOB_QUERY_LIMIT = 100;
const JOB_BATCH_SIZE = 2;
const WORKER_BUDGET_MS = 45_000;

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json(
      { error: "Cron authorization failed." },
      { status: 401, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }

  const admin = getSupabaseAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "The notification worker is not configured." },
      { status: 503, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }

  const now = new Date().toISOString();
  const { data: pendingRows, error: pendingError } = await admin
    .from("appointment_notifications")
    .select("job_id,status,last_error_code")
    .in("status", ["queued", "processing", "failed"])
    .not("job_id", "is", null)
    .lte("available_at", now)
    .order("queued_at", { ascending: true })
    .limit(JOB_QUERY_LIMIT);

  if (pendingError) {
    return NextResponse.json(
      { error: "The notification queue could not be inspected." },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }

  const jobIds = [...new Set((pendingRows ?? [])
    .filter((row) => row.status === "queued"
      || row.status === "processing"
      || (row.status === "failed" && row.last_error_code === "provider_temporary_failure"))
    .map((row) => typeof row.job_id === "string" ? row.job_id : undefined)
    .filter((jobId): jobId is string => Boolean(jobId)))]
    .slice(0, JOB_QUERY_LIMIT);
  let claimedCount = 0;
  let acceptedCount = 0;
  let failedCount = 0;
  let jobsInspected = 0;
  let persistenceFailed = false;
  const deadline = Date.now() + WORKER_BUDGET_MS;

  for (let offset = 0; offset < jobIds.length && Date.now() < deadline; offset += JOB_BATCH_SIZE) {
    const batch = jobIds.slice(offset, offset + JOB_BATCH_SIZE);
    const claimResults = await Promise.all(batch.map((jobId) => admin.rpc("claim_job_confirmations", {
      p_job_id: jobId,
      p_include_failed: true
    })));
    jobsInspected += batch.length;
    if (claimResults.some((result) => result.error)) {
      return NextResponse.json(
        { error: "The notification worker could not claim queued work." },
        { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } }
      );
    }

    const claimed = claimResults.flatMap(({ data: claimedRows }) => Array.isArray(claimedRows)
      ? claimedRows.map((row) => appointmentNotificationFromRow(row as AppointmentNotificationRow))
      : []);
    claimedCount += claimed.length;

    const outcomes = await Promise.allSettled(
      claimed.map((notification) => deliverClaimedAppointmentNotification(admin, notification))
    );
    for (const outcome of outcomes) {
      if (outcome.status === "rejected") {
        persistenceFailed = true;
        continue;
      }
      if (outcome.value.status === "accepted") acceptedCount += 1;
      if (outcome.value.status === "failed") failedCount += 1;
    }
  }

  if (persistenceFailed) {
    return NextResponse.json(
      { error: "The notification worker could not persist every provider result." },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      jobsInspected,
      claimedCount,
      acceptedCount,
      failedCount
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}

function isAuthorizedCronRequest(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  const authorization = request.headers.get("authorization") ?? "";
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!secret || !supplied) return false;

  const expectedDigest = createHash("sha256").update(secret).digest();
  const suppliedDigest = createHash("sha256").update(supplied).digest();
  return timingSafeEqual(expectedDigest, suppliedDigest);
}
