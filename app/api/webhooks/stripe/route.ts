import { createHash } from "node:crypto";
import type Stripe from "stripe";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import { constructStripeEvent, stripeLivemodeMatchesConfiguration, StripePaymentError } from "@/lib/stripe-payments";
import { processStripeEvent } from "@/lib/stripe-webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const supabase = getSupabaseAdminClient();
  if (!supabase) return NextResponse.json({ ok: false, error: "Stripe webhook persistence is not configured." }, { status: 503 });
  const signature = request.headers.get("stripe-signature") ?? "";
  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = constructStripeEvent(rawBody, signature);
  } catch (error) {
    const status = error instanceof StripePaymentError && error.code === "not_configured" ? 503 : 400;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Invalid Stripe webhook." }, { status });
  }
  if (!stripeLivemodeMatchesConfiguration(event.livemode)) {
    return NextResponse.json({ ok: false, error: "Stripe event mode does not match STRIPE_MODE." }, { status: 409 });
  }

  const payloadSha256 = createHash("sha256").update(rawBody).digest("hex");
  const { data: claimData, error: claimError } = await supabase.rpc("claim_stripe_webhook_event", {
    p_event_id: event.id,
    p_event_type: event.type,
    p_payload_sha256: payloadSha256
  });
  if (claimError) {
    const conflict = claimError.code === "23505";
    return NextResponse.json({ ok: false, error: conflict ? "Stripe event identity conflict." : "Stripe event could not be claimed." }, { status: conflict ? 409 : 503 });
  }
  const claim = (Array.isArray(claimData) ? claimData[0] : claimData) as { decision?: string; completion_token?: string | null } | null;
  if (claim?.decision === "duplicate") return NextResponse.json({ ok: true, duplicate: true });
  if (claim?.decision === "in_flight") {
    return NextResponse.json({ ok: false, error: "Stripe event is already being processed." }, { status: 503 });
  }
  if (claim?.decision !== "process" || !claim.completion_token) {
    return NextResponse.json({ ok: false, error: "Stripe event claim returned an invalid response." }, { status: 503 });
  }

  try {
    const outcome = await processStripeEvent(supabase, event);
    const { error } = await supabase.rpc("complete_stripe_webhook_event", {
      p_event_id: event.id,
      p_claim_token: claim.completion_token,
      p_status: outcome,
      p_error_message: null
    });
    if (error) throw new Error("Stripe event completion could not be saved.");
    return NextResponse.json({ ok: true, status: outcome });
  } catch (error) {
    await supabase.rpc("complete_stripe_webhook_event", {
      p_event_id: event.id,
      p_claim_token: claim.completion_token,
      p_status: "failed",
      p_error_message: safeError(error)
    });
    return NextResponse.json({ ok: false, error: "Stripe event processing failed." }, { status: 503 });
  }
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown Stripe processing error.";
  return message.replace(/[\r\n]+/g, " ").slice(0, 500);
}
