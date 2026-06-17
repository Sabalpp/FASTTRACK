import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import { normalizePhone } from "@/lib/phone";

type CallRailPayload = {
  id?: string;
  call_id?: string;
  event_type?: string;
  direction?: string;
  caller_phone_number?: string;
  customer_phone_number?: string;
  caller_name?: string;
  tracking_phone_number?: string;
  start_time?: string;
  duration?: number;
  answered?: boolean;
  recording?: string;
  recording_url?: string;
  transcript?: string;
  summary?: string;
  source?: string;
  tags?: string[];
  score?: number;
  [key: string]: unknown;
};

export async function POST(request: NextRequest) {
  const receivedAt = new Date().toISOString();
  let payload: CallRailPayload;

  try {
    payload = (await request.json()) as CallRailPayload;
  } catch (error) {
    return NextResponse.json({ ok: false, error: "Invalid JSON payload" }, { status: 400 });
  }

  const supabase = getSupabaseAdminClient();
  const eventType = normalizeEventType(payload.event_type);
  const callerPhone = String(payload.caller_phone_number ?? payload.customer_phone_number ?? "");
  const callerPhoneDigits = normalizePhone(callerPhone);
  const signatureHeader = request.headers.get("x-callrail-signature") ?? request.headers.get("x-signature");

  // Phase 2 TODO: replace this placeholder with CallRail's exact webhook signature verification once
  // the contractor provides the CallRail account/webhook settings and signing secret.
  const signatureValid = Boolean(process.env.CALLRAIL_WEBHOOK_SECRET ? signatureHeader : false);

  if (!supabase) {
    return NextResponse.json({
      ok: true,
      phase: "Phase 2 scaffold only",
      credentialsConfigured: false,
      message: "Supabase service role credentials are not configured, so this POST was accepted but not persisted.",
      normalizedPhoneDigits: callerPhoneDigits,
      eventType,
      receivedAt
    });
  }

  let callLogId: string | null = null;
  let processedOk = false;
  let errorMessage: string | null = null;

  try {
    const { data: matchingCustomer } = callerPhoneDigits
      ? await supabase.from("customers").select("id").eq("phone_digits", callerPhoneDigits).maybeSingle()
      : { data: null };

    const externalId = String(payload.id ?? payload.call_id ?? crypto.randomUUID());
    const { data: callLog, error: callLogError } = await supabase
      .from("call_logs")
      .upsert(
        {
          external_id: externalId,
          customer_id: matchingCustomer?.id ?? null,
          direction: payload.direction === "outbound" ? "outbound" : "inbound",
          caller_phone: callerPhone,
          caller_name: payload.caller_name ?? null,
          tracking_number: payload.tracking_phone_number ?? null,
          started_at: payload.start_time ? new Date(payload.start_time).toISOString() : receivedAt,
          duration_seconds: Number(payload.duration ?? 0),
          answered: Boolean(payload.answered),
          recording_url: String(payload.recording_url ?? payload.recording ?? "") || null,
          transcript: payload.transcript ?? null,
          summary: payload.summary ?? null,
          source: payload.source ?? null,
          tags: Array.isArray(payload.tags) ? payload.tags : null,
          score: typeof payload.score === "number" ? payload.score : null,
          raw_payload: payload,
          received_at: receivedAt
        },
        { onConflict: "external_id" }
      )
      .select("id")
      .single();

    if (callLogError) throw callLogError;
    callLogId = callLog.id;
    processedOk = true;
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "Unknown CallRail webhook processing error";
  }

  await supabase.from("call_log_events").insert({
    call_log_id: callLogId,
    event_type: eventType,
    signature_valid: signatureValid,
    processed_ok: processedOk,
    error: errorMessage,
    received_at: receivedAt
  });

  return NextResponse.json({
    ok: processedOk,
    phase: "Phase 2 scaffold only",
    callLogId,
    normalizedPhoneDigits: callerPhoneDigits,
    eventType,
    error: errorMessage
  }, { status: processedOk ? 200 : 202 });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "/api/webhooks/callrail",
    phase: "Phase 2 scaffold only",
    accepts: "POST",
    note: "Wire real signature verification and CallRail event mapping when credentials are available."
  });
}

function normalizeEventType(value: unknown) {
  const normalized = String(value ?? "unknown").toLowerCase();
  if (["pre_call", "post_call", "call_modified"].includes(normalized)) return normalized;
  return "unknown";
}
