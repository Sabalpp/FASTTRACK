import type Stripe from "stripe";
import { invoicePaymentFromRow, type InvoicePaymentRow } from "@/lib/invoice-payments";
import type { getSupabaseAdminClient } from "@/lib/supabase-admin";
import { retrieveStripePaymentIntent, stripeLivemodeMatchesConfiguration } from "@/lib/stripe-payments";

type AdminSupabase = NonNullable<ReturnType<typeof getSupabaseAdminClient>>;

export async function processStripeEvent(
  supabase: AdminSupabase,
  event: Stripe.Event
): Promise<"processed" | "ignored"> {
  if (![
    "checkout.session.completed",
    "checkout.session.async_payment_succeeded",
    "checkout.session.async_payment_failed",
    "checkout.session.expired",
    "refund.created",
    "refund.updated",
    "refund.failed"
  ].includes(event.type)) return "ignored";

  if (event.type === "refund.created" || event.type === "refund.updated" || event.type === "refund.failed") {
    return processStripeRefund(supabase, event.data.object as Stripe.Refund);
  }

  const session = event.data.object as Stripe.Checkout.Session;
  if (!stripeLivemodeMatchesConfiguration(session.livemode)) {
    throw new Error("Stripe checkout session mode does not match STRIPE_MODE.");
  }
  const paymentId = session.metadata?.fast_track_payment_id;
  const invoiceId = session.metadata?.fast_track_invoice_id;
  if (!paymentId || !invoiceId) return "ignored";

  const { data, error } = await supabase.from("invoice_payments")
    .select("*")
    .eq("id", paymentId)
    .eq("invoice_id", invoiceId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return "ignored";
  const payment = invoicePaymentFromRow(data as InvoicePaymentRow);
  if (payment.method !== "card") throw new Error("Stripe event points to a non-card payment.");
  if (payment.stripeCheckoutSessionId && payment.stripeCheckoutSessionId !== session.id) {
    throw new Error("Stripe checkout session does not match the payment ledger.");
  }

  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") return "ignored";
    const expectedAmount = Math.round(payment.amount * 100);
    if (session.amount_total !== expectedAmount || session.currency !== payment.currency) {
      throw new Error("Stripe checkout amount or currency does not match the payment ledger.");
    }
    const paymentIntent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
    if (["succeeded", "partially_refunded", "refunded"].includes(payment.status)) {
      if (payment.stripePaymentIntentId && paymentIntent && payment.stripePaymentIntentId !== paymentIntent) {
        throw new Error("Stripe payment intent does not match the completed ledger payment.");
      }
      return "processed";
    }
    const { data: updated, error: updateError } = await supabase.from("invoice_payments").update({
      status: "succeeded",
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id: paymentIntent ?? null,
      provider_status: session.payment_status,
      succeeded_at: new Date().toISOString()
    }).eq("id", payment.id).eq("invoice_id", invoiceId).in("status", ["pending", "failed", "cancelled"]).select("id").maybeSingle();
    if (updateError) throw updateError;
    if (!updated) throw new Error("Verified Stripe payment could not transition the payment ledger.");
    return "processed";
  }

  const nextStatus = event.type === "checkout.session.expired" ? "cancelled" : "failed";
  const patch = nextStatus === "failed"
    ? { status: nextStatus, provider_status: session.payment_status || event.type, failed_at: new Date().toISOString() }
    : { status: nextStatus, provider_status: event.type };
  if (payment.status !== "pending") return "processed";
  const { data: updated, error: updateError } = await supabase.from("invoice_payments").update(patch)
    .eq("id", payment.id)
    .eq("invoice_id", invoiceId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (updateError) throw updateError;
  if (!updated) throw new Error("Stripe terminal state could not transition the payment ledger.");
  return "processed";
}

export async function processStripeRefund(
  supabase: AdminSupabase,
  refund: Stripe.Refund
): Promise<"processed" | "ignored"> {
  const paymentIntentId = typeof refund.payment_intent === "string"
    ? refund.payment_intent
    : refund.payment_intent?.id;
  if (!paymentIntentId) return "ignored";
  const livemode = "livemode" in refund ? Boolean(refund.livemode) : undefined;
  if (livemode !== undefined && !stripeLivemodeMatchesConfiguration(livemode)) {
    throw new Error("Stripe refund mode does not match STRIPE_MODE.");
  }
  let metadataPaymentId = refund.metadata?.fast_track_payment_id;

  let paymentQuery = supabase.from("invoice_payments").select("*");
  paymentQuery = metadataPaymentId
    ? paymentQuery.eq("id", metadataPaymentId)
    : paymentQuery.eq("stripe_payment_intent_id", paymentIntentId);
  const { data, error } = await paymentQuery.maybeSingle();
  if (error) throw error;
  let paymentData = data;
  if (!paymentData && !metadataPaymentId) {
    const paymentIntent = await retrieveStripePaymentIntent(paymentIntentId);
    metadataPaymentId = paymentIntent.metadata?.fast_track_payment_id;
    if (metadataPaymentId) {
      const retry = await supabase.from("invoice_payments").select("*").eq("id", metadataPaymentId).maybeSingle();
      if (retry.error) throw retry.error;
      paymentData = retry.data;
    }
  }
  if (!paymentData) {
    if (metadataPaymentId) throw new Error("Stripe refund references a Fast Track payment that is not available yet.");
    return "ignored";
  }
  const payment = invoicePaymentFromRow(paymentData as InvoicePaymentRow);
  if (payment.method !== "card") throw new Error("Stripe refund points to a non-card payment.");
  if (payment.stripePaymentIntentId && payment.stripePaymentIntentId !== paymentIntentId) {
    throw new Error("Stripe refund payment intent does not match the payment ledger.");
  }

  if (!Number.isSafeInteger(refund.amount) || refund.amount <= 0 || refund.currency !== payment.currency) {
    throw new Error("Stripe refund amount or currency does not match the payment ledger.");
  }
  const status = refund.status === "succeeded"
    ? "succeeded"
    : refund.status === "failed"
      ? "failed"
      : refund.status === "canceled"
        ? "cancelled"
        : "pending";
  const { error: refundError } = await supabase.rpc("record_stripe_payment_refund", {
    p_refund_id: refund.id,
    p_payment_id: payment.id,
    p_payment_intent_id: paymentIntentId,
    p_amount: refund.amount / 100,
    p_currency: refund.currency,
    p_status: status,
    p_provider_status: refund.status ?? "unknown",
    p_failure_reason: refund.failure_reason ?? null,
    p_provider_created_at: new Date(refund.created * 1000).toISOString()
  });
  if (refundError) throw refundError;
  return "processed";
}
