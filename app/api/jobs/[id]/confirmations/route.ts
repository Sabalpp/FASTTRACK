import { NextResponse } from "next/server";
import {
  maskNotificationDestination
} from "@/lib/appointment-confirmations";
import { deliverClaimedAppointmentNotification } from "@/lib/appointment-confirmation-delivery-server";
import { getAppointmentProviderConfiguration } from "@/lib/appointment-providers";
import { appointmentNotificationFromRow } from "@/lib/supabase-mappers";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  getAuthenticatedSupabase,
  RequestAuthError,
  type AuthenticatedSupabase
} from "@/lib/supabase-user-server";
import type { AppointmentNotification, AppointmentNotificationSummary } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type RouteContext = {
  params: Promise<{ id: string }>;
};

type DispatchMode = "pending" | "retry" | "resend";

type ConfirmationRequest = {
  mode?: unknown;
  requestId?: unknown;
};

type AppointmentNotificationRow = Parameters<typeof appointmentNotificationFromRow>[0];
type AppointmentNotificationSummaryRow = {
  id: string;
  job_revision: number;
  event_type: AppointmentNotification["eventType"];
  channel: AppointmentNotification["channel"];
  destination: string;
  status: AppointmentNotification["status"];
  provider_status: string | null;
  provider_status_at: string | null;
  attempt_count: number;
  last_error_code: string | null;
  error_message: string | null;
  queued_at: string;
  processing_at: string | null;
  accepted_at: string | null;
  failed_at: string | null;
};

const CONFIRMATION_HISTORY_COLUMNS = [
  "id",
  "job_revision",
  "event_type",
  "channel",
  "destination",
  "status",
  "provider_status",
  "provider_status_at",
  "attempt_count",
  "last_error_code",
  "error_message",
  "queued_at",
  "processing_at",
  "accepted_at",
  "failed_at"
].join(",");

export async function GET(request: Request, context: RouteContext) {
  try {
    const jobId = await readJobId(context);
    const auth = await getAuthenticatedSupabase(request);
    if (auth.role !== "owner" && auth.role !== "call_center") {
      throw new RequestAuthError("Only owners and call-center staff can view customer confirmations.", 403);
    }
    return confirmationResponse(auth, jobId, 0);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const jobId = await readJobId(context);
    const auth = await getAuthenticatedSupabase(request);
    if (auth.role !== "owner" && auth.role !== "call_center") {
      throw new RequestAuthError("Only owners and call-center staff can send customer confirmations.", 403);
    }
    const admin = getSupabaseAdminClient();
    if (!admin) {
      throw new PublicRouteError("Customer confirmation delivery is not configured.", 503);
    }

    const body = await readRequestBody(request);
    const mode = readDispatchMode(body.mode);

    if (mode === "resend") {
      const requestId = readRequestId(body.requestId) ?? crypto.randomUUID();
      const { error } = await admin.rpc("queue_manual_job_confirmations", {
        p_job_id: jobId,
        p_request_id: requestId,
        p_requested_by: auth.allowedUserId
      });
      if (error) throw databaseError("The confirmation could not be queued for resending.", error.code);
    }

    const { data: claimedRows, error: claimError } = await admin.rpc("claim_job_confirmations", {
      p_job_id: jobId,
      p_include_failed: mode === "retry"
    });
    if (claimError) throw databaseError("The confirmation queue could not be claimed.", claimError.code);

    const claimed = mapNotifications(claimedRows);
    await Promise.all(
      claimed.map((notification) => deliverClaimedAppointmentNotification(admin, notification))
    );

    return confirmationResponse(auth, jobId, claimed.length);
  } catch (error) {
    return errorResponse(error);
  }
}

async function confirmationResponse(
  auth: AuthenticatedSupabase,
  jobId: string,
  processedCount: number
) {
  const { data, error } = await auth.client
    .from("appointment_notifications")
    .select(CONFIRMATION_HISTORY_COLUMNS)
    .eq("job_id", jobId)
    .order("queued_at", { ascending: false })
    .limit(100);
  if (error) throw databaseError("Confirmation history could not be loaded.", error.code);

  const providerConfiguration = getAppointmentProviderConfiguration();
  return NextResponse.json(
    {
      notifications: mapNotificationSummaries(data),
      processedCount,
      providerConfigured: {
        email: providerConfiguration.email.configured,
        sms: providerConfiguration.sms.configured
      }
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0"
      }
    }
  );
}

function mapNotificationSummaries(rows: unknown): AppointmentNotificationSummary[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => toClientSummary(row as AppointmentNotificationSummaryRow));
}

function toClientSummary(row: AppointmentNotificationSummaryRow): AppointmentNotificationSummary {
  return {
    id: row.id,
    jobRevision: row.job_revision,
    eventType: row.event_type,
    channel: row.channel,
    maskedDestination: maskNotificationDestination(row.channel, row.destination),
    status: row.status,
    providerStatus: row.provider_status ?? undefined,
    providerStatusAt: row.provider_status_at ?? undefined,
    attemptCount: row.attempt_count,
    lastErrorCode: row.last_error_code ?? undefined,
    errorMessage: row.error_message ?? undefined,
    queuedAt: row.queued_at,
    processingAt: row.processing_at ?? undefined,
    acceptedAt: row.accepted_at ?? undefined,
    failedAt: row.failed_at ?? undefined
  };
}

function mapNotifications(rows: unknown): AppointmentNotification[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => appointmentNotificationFromRow(row as AppointmentNotificationRow));
}

async function readJobId(context: RouteContext): Promise<string> {
  const { id } = await context.params;
  if (!isUuid(id)) throw new PublicRouteError("A valid job ID is required.", 400);
  return id;
}

async function readRequestBody(request: Request): Promise<ConfirmationRequest> {
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("invalid");
    }
    return body as ConfirmationRequest;
  } catch {
    throw new PublicRouteError("A valid confirmation request is required.", 400);
  }
}

function readDispatchMode(value: unknown): DispatchMode {
  if (value === undefined) return "pending";
  if (value === "pending" || value === "retry" || value === "resend") return value;
  throw new PublicRouteError("Confirmation mode must be pending, retry, or resend.", 400);
}

function readRequestId(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string" && isUuid(value)) return value;
  throw new PublicRouteError("A valid resend request ID is required.", 400);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

class PublicRouteError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function databaseError(message: string, code?: string): PublicRouteError {
  const notFound = code === "P0002";
  const forbidden = code === "42501";
  const badRequest = code === "22004" || code === "22023" || code === "22P02";
  const conflict = code === "55000";
  const rateLimited = code === "54000";
  return new PublicRouteError(
    message,
    notFound ? 404 : forbidden ? 403 : badRequest ? 400 : conflict ? 409 : rateLimited ? 429 : 500
  );
}

function errorResponse(error: unknown) {
  if (error instanceof RequestAuthError || error instanceof PublicRouteError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.status, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }

  return NextResponse.json(
    { error: "Customer confirmation delivery is temporarily unavailable." },
    { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
