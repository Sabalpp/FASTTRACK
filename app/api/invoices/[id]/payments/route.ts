import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  invoicePaymentFromRow,
  type InvoicePaymentMethod,
  type InvoicePaymentRow
} from "@/lib/invoice-payments";
import { loadInvoiceBundle } from "@/lib/invoice-server";
import { createStripeInvoiceCheckout, getStripePaymentConfiguration, retrieveStripeInvoiceCheckout, StripePaymentError } from "@/lib/stripe-payments";
import { HttpError, requireOwner, requireServerActor, routeErrorResponse } from "@/lib/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const requestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const actor = await requireServerActor(request);
    const { id } = await context.params;
    await loadInvoiceBundle(actor, id);
    const [payments, invoice] = await Promise.all([
      listPayments(actor.supabase, id),
      loadInvoiceBundle(actor, id).then((bundle) => bundle.invoice)
    ]);
    return NextResponse.json({ ok: true, payments, invoice }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const actor = await requireServerActor(request);
    const { id } = await context.params;
    const bundle = await loadInvoiceBundle(actor, id);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const method = body.method as InvoicePaymentMethod;
    if (!(["card", "cash", "check"] as InvoicePaymentMethod[]).includes(method)) {
      throw new HttpError(400, "Choose card, cash, or check.");
    }

    const requestId = typeof body.requestId === "string" ? body.requestId.trim().toLowerCase() : "";
    if (!requestIdPattern.test(requestId)) throw new HttpError(400, "A valid payment request ID is required.");
    const amount = roundMoney(Number(body.amount));
    if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, "Enter a payment amount greater than zero.");
    const reference = cleanText(body.reference, 120);
    const note = cleanText(body.note, 500);
    if (method === "check" && !reference) throw new HttpError(400, "Enter the check number or check reference.");
    const configuration = getStripePaymentConfiguration();
    if (method === "card" && !configuration.checkoutConfigured) {
      throw new HttpError(503, `Card payments are not configured. Configure ${configuration.missingCheckout.join(", ")}, then redeploy.`);
    }
    const expiresAt = method === "card"
      ? new Date(Date.now() + configuration.checkoutExpiryMinutes * 60_000)
      : undefined;
    const requestFingerprint = createHash("sha256").update(JSON.stringify({
      invoiceId: id,
      method,
      amountCents: Math.round(amount * 100),
      currency: "usd",
      reference: reference || null,
      note: note || null
    })).digest("hex");
    const { data: claimData, error: claimError } = await actor.supabase.rpc("claim_invoice_payment", {
      p_request_id: requestId,
      p_invoice_id: id,
      p_method: method,
      p_amount: amount,
      p_currency: "usd",
      p_reference: reference || null,
      p_note: note || null,
      p_request_fingerprint: requestFingerprint,
      p_recorded_by: actor.user.id,
      p_expires_at: expiresAt?.toISOString() ?? null
    });
    const claimedRow = Array.isArray(claimData) ? claimData[0] : claimData;
    if (claimError || !claimedRow) throw paymentWriteError(claimError?.message);
    const claimedPayment = invoicePaymentFromRow(claimedRow as InvoicePaymentRow);

    if (method === "card") {
      if (claimedPayment.status !== "pending") {
        return NextResponse.json({
          ok: true,
          payment: claimedPayment,
          payments: await listPayments(actor.supabase, id),
          invoice: (await loadInvoiceBundle(actor, id)).invoice
        });
      }
      if (claimedPayment.checkoutUrl) {
        return NextResponse.json({
          ok: true,
          payment: claimedPayment,
          checkoutUrl: claimedPayment.checkoutUrl,
          invoice: (await loadInvoiceBundle(actor, id)).invoice
        });
      }
      return retryCardCheckout(request, actor, bundle, claimedPayment);
    }

    const [payments, refreshed] = await Promise.all([
      listPayments(actor.supabase, id),
      loadInvoiceBundle(actor, id)
    ]);
    return NextResponse.json({
      ok: true,
      payment: claimedPayment,
      payments,
      invoice: refreshed.invoice
    }, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const actor = await requireServerActor(request);
    const { id } = await context.params;
    await loadInvoiceBundle(actor, id);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    if (body.action === "reconcile_card" || body.action === "expire_card") {
      const paymentId = typeof body.paymentId === "string" ? body.paymentId.trim() : "";
      if (!requestIdPattern.test(paymentId)) throw new HttpError(400, "Choose a valid card payment record.");
      const payment = await loadPayment(actor.supabase, id, paymentId);
      if (payment.method !== "card") throw new HttpError(409, "Only card checkouts can be reconciled with Stripe.");
      if (payment.status !== "pending") {
        return paymentStateResponse(actor, id, payment, payment.providerStatus ?? payment.status);
      }
      if (!payment.stripeCheckoutSessionId) {
        throw new HttpError(409, "This checkout has not been attached to Stripe yet. Retry the original card request.");
      }

      let session;
      try {
        session = await retrieveStripeInvoiceCheckout(payment.stripeCheckoutSessionId, {
          expire: body.action === "expire_card"
        });
      } catch (error) {
        if (error instanceof StripePaymentError) {
          throw new HttpError(error.retryable || error.code === "not_configured" ? 503 : 502, error.message);
        }
        throw error;
      }
      assertStripeSessionMatchesPayment(session, payment);

      const paymentIntent = typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id;
      const patch = session.payment_status === "paid" || session.payment_status === "no_payment_required"
        ? {
          status: "succeeded",
          stripe_payment_intent_id: paymentIntent ?? null,
          provider_status: session.payment_status,
          succeeded_at: new Date().toISOString()
        }
        : session.status === "expired"
          ? { status: "cancelled", provider_status: "expired" }
          : undefined;
      let reconciled = payment;
      if (patch) {
        const { data, error } = await actor.supabase.from("invoice_payments").update(patch)
          .eq("id", payment.id)
          .eq("invoice_id", id)
          .eq("status", "pending")
          .select("*")
          .maybeSingle();
        if (error) throw new HttpError(503, "The verified Stripe state could not be saved.");
        if (data) reconciled = invoicePaymentFromRow(data as InvoicePaymentRow);
        else reconciled = await loadPayment(actor.supabase, id, paymentId);
      }
      return paymentStateResponse(actor, id, reconciled, session.status ?? session.payment_status);
    }

    if (body.action !== "refund_manual") throw new HttpError(400, "Unknown payment action.");
    requireOwner(actor);
    const paymentId = typeof body.paymentId === "string" ? body.paymentId.trim() : "";
    const reason = cleanText(body.reason, 300);
    if (!requestIdPattern.test(paymentId)) throw new HttpError(400, "Choose a valid payment record.");
    if (reason.length < 3) throw new HttpError(400, "Enter a brief reason for reversing this payment.");

    const payment = await loadPayment(actor.supabase, id, paymentId);
    if (payment.method === "card") throw new HttpError(409, "Refund card payments in Stripe. The verified webhook will update this ledger.");
    if (payment.status !== "succeeded") throw new HttpError(409, "Only a completed manual payment can be reversed.");

    const { data, error } = await actor.supabase.from("invoice_payments").update({
      status: "refunded",
      refunded_amount: payment.amount,
      refunded_at: new Date().toISOString(),
      refunded_by: actor.user.id,
      reversal_reason: reason
    }).eq("id", paymentId).eq("invoice_id", id).eq("status", "succeeded").select("*").maybeSingle();
    if (error || !data) throw new HttpError(error ? 503 : 409, error?.message ?? "The payment record changed before it could be reversed.");

    const [payments, refreshed] = await Promise.all([
      listPayments(actor.supabase, id),
      loadInvoiceBundle(actor, id)
    ]);
    return NextResponse.json({
      ok: true,
      payment: invoicePaymentFromRow(data as InvoicePaymentRow),
      payments,
      invoice: refreshed.invoice
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

async function retryCardCheckout(
  request: NextRequest,
  actor: Awaited<ReturnType<typeof requireServerActor>>,
  bundle: Awaited<ReturnType<typeof loadInvoiceBundle>>,
  payment: ReturnType<typeof invoicePaymentFromRow>
) {
  if (payment.status !== "pending" || !payment.expiresAt) {
    throw new HttpError(409, "This card checkout is no longer open. Start a new payment.");
  }

  try {
    const checkout = await createStripeInvoiceCheckout({
      paymentId: payment.id,
      invoiceId: bundle.invoice.id,
      invoiceNumber: bundle.invoice.invoiceNumber,
      customerEmail: bundle.customer.email,
      serviceAddress: bundle.job.serviceAddress,
      amount: payment.amount,
      currency: payment.currency,
      requestId: payment.requestId,
      appOrigin: paymentAppOrigin(request),
      expiresAt: new Date(payment.expiresAt)
    });
    const { data, error } = await actor.supabase.from("invoice_payments").update({
      stripe_checkout_session_id: checkout.sessionId,
      stripe_checkout_url: checkout.url,
      expires_at: new Date(checkout.expiresAt * 1000).toISOString(),
      provider_status: checkout.paymentStatus || checkout.status || "open"
    }).eq("id", payment.id).eq("invoice_id", bundle.invoice.id).eq("status", "pending").select("*").maybeSingle();
    if (error || !data) throw new HttpError(error ? 503 : 409, error?.message ?? "The checkout was created but could not be attached to the invoice. Retry the same payment request.");
    return NextResponse.json({
      ok: true,
      payment: invoicePaymentFromRow(data as InvoicePaymentRow),
      checkoutUrl: checkout.url,
      invoice: (await loadInvoiceBundle(actor, bundle.invoice.id)).invoice
    }, { status: 201 });
  } catch (error) {
    if (error instanceof StripePaymentError) {
      if (!error.retryable) {
        await actor.supabase.from("invoice_payments").update({
          status: "failed",
          provider_status: error.code,
          failed_at: new Date().toISOString()
        }).eq("id", payment.id).eq("status", "pending");
      } else {
        await actor.supabase.from("invoice_payments").update({ provider_status: "outcome_unknown_retry_same_request" }).eq("id", payment.id).eq("status", "pending");
      }
      const hint = error.code === "not_configured" ? " Add STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET, then redeploy." : "";
      throw new HttpError(error.retryable || error.code === "not_configured" ? 503 : 502, `${error.message}${hint}`);
    }
    throw error;
  }
}

async function listPayments(supabase: Awaited<ReturnType<typeof requireServerActor>>["supabase"], invoiceId: string) {
  const { data, error } = await supabase.from("invoice_payments")
    .select("*")
    .eq("invoice_id", invoiceId)
    .order("created_at", { ascending: false });
  if (error) throw new HttpError(503, "Payment history could not be loaded.");
  return ((data ?? []) as InvoicePaymentRow[]).map(invoicePaymentFromRow);
}

async function loadPayment(
  supabase: Awaited<ReturnType<typeof requireServerActor>>["supabase"],
  invoiceId: string,
  paymentId: string
) {
  const { data, error } = await supabase.from("invoice_payments")
    .select("*")
    .eq("id", paymentId)
    .eq("invoice_id", invoiceId)
    .maybeSingle();
  if (error) throw new HttpError(503, "The payment record could not be checked.");
  if (!data) throw new HttpError(404, "Payment record not found.");
  return invoicePaymentFromRow(data as InvoicePaymentRow);
}

function assertStripeSessionMatchesPayment(
  session: Awaited<ReturnType<typeof retrieveStripeInvoiceCheckout>>,
  payment: ReturnType<typeof invoicePaymentFromRow>
) {
  if (
    session.id !== payment.stripeCheckoutSessionId
    || session.metadata?.fast_track_payment_id !== payment.id
    || session.metadata?.fast_track_invoice_id !== payment.invoiceId
    || session.amount_total !== Math.round(payment.amount * 100)
    || session.currency !== payment.currency
  ) {
    throw new HttpError(409, "Stripe checkout identity, amount, or currency does not match the payment ledger.");
  }
}

async function paymentStateResponse(
  actor: Awaited<ReturnType<typeof requireServerActor>>,
  invoiceId: string,
  payment: ReturnType<typeof invoicePaymentFromRow>,
  stripeStatus: string
) {
  const [payments, refreshed] = await Promise.all([
    listPayments(actor.supabase, invoiceId),
    loadInvoiceBundle(actor, invoiceId)
  ]);
  return NextResponse.json({
    ok: true,
    payment,
    payments,
    invoice: refreshed.invoice,
    stripeStatus
  });
}

function paymentAppOrigin(request: NextRequest) {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  const candidate = configured || request.nextUrl.origin;
  try {
    const url = new URL(candidate);
    if (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
      return url.origin;
    }
  } catch {
    // Fall through to the trusted request origin.
  }
  return request.nextUrl.origin;
}

function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function paymentWriteError(message?: string) {
  if (message?.match(/exceed|checkout is already open|open card checkout|different payment details|duplicate key/i)) return new HttpError(409, message);
  return new HttpError(503, "The payment could not be recorded.");
}
