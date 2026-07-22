import Stripe from "stripe";

if (typeof window !== "undefined" && process.env.NODE_ENV !== "test") {
  throw new Error("Stripe credentials can only be used by server modules.");
}

type StripeEnvironment = Record<string, string | undefined>;

export type StripePaymentConfiguration = {
  checkoutConfigured: boolean;
  webhookConfigured: boolean;
  missingCheckout: string[];
  missingWebhook: string[];
  currency: string;
  checkoutExpiryMinutes: number;
  mode: "test" | "live" | null;
};

export class StripePaymentError extends Error {
  constructor(
    message: string,
    public readonly code: "not_configured" | "invalid_response" | "provider_rejected" | "provider_unavailable",
    public readonly retryable = false
  ) {
    super(message);
    this.name = "StripePaymentError";
  }
}

export function getStripePaymentConfiguration(
  env: StripeEnvironment = process.env
): StripePaymentConfiguration {
  const secretKey = readEnv(env, "STRIPE_SECRET_KEY");
  const webhookSecret = readEnv(env, "STRIPE_WEBHOOK_SECRET");
  const requestedCurrency = readEnv(env, "STRIPE_CURRENCY").toLowerCase();
  const requestedMode = readEnv(env, "STRIPE_MODE").toLowerCase();
  const mode = requestedMode === "test" || requestedMode === "live" ? requestedMode : null;
  const currencySupported = !requestedCurrency || requestedCurrency === "usd";
  const currency = "usd";
  const requestedExpiry = Number(readEnv(env, "STRIPE_CHECKOUT_EXPIRY_MINUTES"));
  const checkoutExpiryMinutes = Number.isFinite(requestedExpiry)
    ? Math.min(24 * 60, Math.max(31, Math.round(requestedExpiry)))
    : 31;

  const missingCheckout = [
    secretKey ? undefined : "STRIPE_SECRET_KEY",
    webhookSecret ? undefined : "STRIPE_WEBHOOK_SECRET",
    mode ? undefined : "STRIPE_MODE (test or live)",
    mode && secretKey.startsWith("sk_test_") && mode !== "test" ? "STRIPE_MODE must match STRIPE_SECRET_KEY" : undefined,
    mode && secretKey.startsWith("sk_live_") && mode !== "live" ? "STRIPE_MODE must match STRIPE_SECRET_KEY" : undefined,
    currencySupported ? undefined : "STRIPE_CURRENCY must be usd"
  ].filter((name): name is string => Boolean(name));

  return {
    checkoutConfigured: missingCheckout.length === 0,
    webhookConfigured: Boolean(secretKey && webhookSecret && mode),
    missingCheckout,
    missingWebhook: [secretKey ? undefined : "STRIPE_SECRET_KEY", webhookSecret ? undefined : "STRIPE_WEBHOOK_SECRET", mode ? undefined : "STRIPE_MODE (test or live)"]
      .filter((name): name is string => Boolean(name)),
    currency,
    checkoutExpiryMinutes,
    mode
  };
}

export async function createStripeInvoiceCheckout(
  input: {
    paymentId: string;
    invoiceId: string;
    invoiceNumber: string;
    customerEmail?: string;
    serviceAddress: string;
    amount: number;
    currency: string;
    requestId: string;
    appOrigin: string;
    expiresAt: Date;
  },
  options: {
    env?: StripeEnvironment;
    stripe?: Pick<Stripe, "checkout">;
  } = {}
) {
  const env = options.env ?? process.env;
  const configuration = getStripePaymentConfiguration(env);
  const secretKey = readEnv(env, "STRIPE_SECRET_KEY");
  if (!configuration.checkoutConfigured || !secretKey) {
    throw new StripePaymentError("Card payments are not configured.", "not_configured");
  }

  const amountInCents = Math.round(input.amount * 100);
  if (!Number.isSafeInteger(amountInCents) || amountInCents < 50) {
    throw new StripePaymentError("The card payment amount is invalid.", "provider_rejected");
  }

  const stripe = options.stripe ?? new Stripe(secretKey, {
    appInfo: { name: "Fast Track Field Service", version: "1.0.0" },
    maxNetworkRetries: 2,
    timeout: 15_000
  });
  const metadata = {
    fast_track_invoice_id: input.invoiceId,
    fast_track_payment_id: input.paymentId,
    fast_track_request_id: input.requestId
  };

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      client_reference_id: input.invoiceId,
      customer_email: input.customerEmail || undefined,
      expires_at: Math.floor(input.expiresAt.getTime() / 1000),
      line_items: [{
        quantity: 1,
        price_data: {
          currency: input.currency,
          unit_amount: amountInCents,
          product_data: {
            name: `Fast Track invoice ${input.invoiceNumber}`,
            description: input.serviceAddress.slice(0, 500),
            metadata
          }
        }
      }],
      metadata,
      payment_intent_data: { metadata },
      submit_type: "pay",
      success_url: `${input.appOrigin}/invoices/${input.invoiceId}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${input.appOrigin}/invoices/${input.invoiceId}?payment=cancelled`
    }, {
      idempotencyKey: `invoice-checkout/${input.invoiceId}/${input.requestId}`
    });

    if (!session.id || !session.url) {
      throw new StripePaymentError("Stripe did not return a checkout link.", "invalid_response", true);
    }
    if (typeof session.livemode === "boolean" && session.livemode !== (configuration.mode === "live")) {
      throw new StripePaymentError("Stripe returned a checkout from the wrong account mode.", "invalid_response");
    }
    return {
      sessionId: session.id,
      url: session.url,
      expiresAt: session.expires_at,
      paymentStatus: session.payment_status,
      status: session.status
    };
  } catch (error) {
    if (error instanceof StripePaymentError) throw error;
    if (error instanceof Stripe.errors.StripeError) {
      const retryable = error.type === "StripeConnectionError" || error.type === "StripeAPIError";
      throw new StripePaymentError(
        retryable ? "Stripe could not be reached. The same request can be retried safely." : "Stripe rejected the checkout request.",
        retryable ? "provider_unavailable" : "provider_rejected",
        retryable
      );
    }
    throw new StripePaymentError("Stripe could not be reached. The same request can be retried safely.", "provider_unavailable", true);
  }
}

export function stripeLivemodeMatchesConfiguration(
  livemode: boolean,
  env: StripeEnvironment = process.env
) {
  const configuration = getStripePaymentConfiguration(env);
  return configuration.mode !== null && livemode === (configuration.mode === "live");
}

export function constructStripeEvent(
  rawBody: string,
  signature: string,
  env: StripeEnvironment = process.env
) {
  const secretKey = readEnv(env, "STRIPE_SECRET_KEY");
  const webhookSecret = readEnv(env, "STRIPE_WEBHOOK_SECRET");
  if (!secretKey || !webhookSecret) {
    throw new StripePaymentError("Stripe webhooks are not configured.", "not_configured");
  }
  const stripe = new Stripe(secretKey, {
    appInfo: { name: "Fast Track Field Service", version: "1.0.0" },
    maxNetworkRetries: 0,
    timeout: 10_000
  });
  try {
    return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch {
    throw new StripePaymentError("The Stripe webhook signature is invalid.", "provider_rejected");
  }
}

export async function retrieveStripeInvoiceCheckout(
  sessionId: string,
  options: {
    expire?: boolean;
    env?: StripeEnvironment;
    stripe?: Pick<Stripe, "checkout">;
  } = {}
) {
  const env = options.env ?? process.env;
  const configuration = getStripePaymentConfiguration(env);
  const secretKey = readEnv(env, "STRIPE_SECRET_KEY");
  if (!configuration.checkoutConfigured || !secretKey) {
    throw new StripePaymentError("Card payments are not configured.", "not_configured");
  }
  if (!/^cs_[a-zA-Z0-9_]+$/.test(sessionId)) {
    throw new StripePaymentError("The Stripe checkout session ID is invalid.", "provider_rejected");
  }
  const stripe = options.stripe ?? new Stripe(secretKey, {
    appInfo: { name: "Fast Track Field Service", version: "1.0.0" },
    maxNetworkRetries: 2,
    timeout: 15_000
  });
  try {
    const session = options.expire
      ? await stripe.checkout.sessions.expire(sessionId)
      : await stripe.checkout.sessions.retrieve(sessionId);
    if (!stripeLivemodeMatchesConfiguration(session.livemode, env)) {
      throw new StripePaymentError("Stripe returned a checkout from the wrong account mode.", "invalid_response");
    }
    return session;
  } catch (error) {
    if (error instanceof StripePaymentError) throw error;
    if (error instanceof Stripe.errors.StripeError) {
      const retryable = error.type === "StripeConnectionError" || error.type === "StripeAPIError";
      throw new StripePaymentError(
        retryable ? "Stripe could not be reached. Try reconciliation again." : "Stripe rejected the reconciliation request.",
        retryable ? "provider_unavailable" : "provider_rejected",
        retryable
      );
    }
    throw new StripePaymentError("Stripe could not be reached. Try reconciliation again.", "provider_unavailable", true);
  }
}

export async function retrieveStripePaymentIntent(
  paymentIntentId: string,
  options: {
    env?: StripeEnvironment;
    stripe?: Pick<Stripe, "paymentIntents">;
  } = {}
) {
  const env = options.env ?? process.env;
  const configuration = getStripePaymentConfiguration(env);
  const secretKey = readEnv(env, "STRIPE_SECRET_KEY");
  if (!configuration.checkoutConfigured || !secretKey) {
    throw new StripePaymentError("Card payments are not configured.", "not_configured");
  }
  if (!/^pi_[a-zA-Z0-9_]+$/.test(paymentIntentId)) {
    throw new StripePaymentError("The Stripe payment intent ID is invalid.", "provider_rejected");
  }
  const stripe = options.stripe ?? new Stripe(secretKey, {
    appInfo: { name: "Fast Track Field Service", version: "1.0.0" },
    maxNetworkRetries: 2,
    timeout: 15_000
  });
  try {
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (!stripeLivemodeMatchesConfiguration(paymentIntent.livemode, env)) {
      throw new StripePaymentError("Stripe returned a payment intent from the wrong account mode.", "invalid_response");
    }
    return paymentIntent;
  } catch (error) {
    if (error instanceof StripePaymentError) throw error;
    if (error instanceof Stripe.errors.StripeError) {
      const retryable = error.type === "StripeConnectionError" || error.type === "StripeAPIError";
      throw new StripePaymentError(
        retryable ? "Stripe could not be reached while reconciling a refund." : "Stripe rejected the refund reconciliation request.",
        retryable ? "provider_unavailable" : "provider_rejected",
        retryable
      );
    }
    throw new StripePaymentError("Stripe could not be reached while reconciling a refund.", "provider_unavailable", true);
  }
}

function readEnv(env: StripeEnvironment, name: string) {
  return env[name]?.trim() ?? "";
}
