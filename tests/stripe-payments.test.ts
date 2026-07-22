import { describe, expect, it, vi } from "vitest";
import {
  createStripeInvoiceCheckout,
  getStripePaymentConfiguration,
  StripePaymentError
} from "@/lib/stripe-payments";

describe("Stripe invoice checkout adapter", () => {
  it("is activated entirely by server environment values", () => {
    expect(getStripePaymentConfiguration({})).toMatchObject({
      checkoutConfigured: false,
      webhookConfigured: false,
      currency: "usd",
      checkoutExpiryMinutes: 31,
      mode: null
    });
    expect(getStripePaymentConfiguration({
      STRIPE_SECRET_KEY: "sk_test_example",
      STRIPE_WEBHOOK_SECRET: "whsec_example",
      STRIPE_MODE: "test",
      STRIPE_CURRENCY: "USD",
      STRIPE_CHECKOUT_EXPIRY_MINUTES: "45"
    })).toMatchObject({
      checkoutConfigured: true,
      webhookConfigured: true,
      currency: "usd",
      checkoutExpiryMinutes: 45,
      mode: "test"
    });
  });

  it("creates a hosted card checkout with invoice metadata and idempotency", async () => {
    const create = vi.fn().mockResolvedValue({
      id: "cs_test_123",
      url: "https://checkout.stripe.com/c/pay/cs_test_123",
      payment_status: "unpaid",
      status: "open",
      expires_at: 1_785_000_000,
      livemode: false
    });
    const expiresAt = new Date("2026-07-22T18:30:00.000Z");
    const result = await createStripeInvoiceCheckout({
      paymentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      invoiceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      invoiceNumber: "FT-1042",
      customerEmail: "customer@example.com",
      serviceAddress: "123 Main Street, Fairfax, VA 22030",
      amount: 312.45,
      currency: "usd",
      requestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      appOrigin: "https://fasttrack-delta.vercel.app",
      expiresAt
    }, {
      env: { STRIPE_SECRET_KEY: "sk_test_example", STRIPE_WEBHOOK_SECRET: "whsec_example", STRIPE_MODE: "test" },
      stripe: { checkout: { sessions: { create } } } as never
    });

    expect(result.url).toContain("checkout.stripe.com");
    expect(create).toHaveBeenCalledOnce();
    const [params, requestOptions] = create.mock.calls[0];
    expect(params.mode).toBe("payment");
    expect(params.payment_method_types).toEqual(["card"]);
    expect(params.line_items[0].price_data.unit_amount).toBe(31_245);
    expect(params.metadata.fast_track_invoice_id).toBe("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(params.success_url).toContain("{CHECKOUT_SESSION_ID}");
    expect(params.expires_at).toBe(Math.floor(expiresAt.getTime() / 1000));
    expect(requestOptions.idempotencyKey).toContain("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
  });

  it("fails closed before contacting Stripe when the key is missing", async () => {
    await expect(createStripeInvoiceCheckout({
      paymentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      invoiceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      invoiceNumber: "FT-1042",
      serviceAddress: "123 Main Street",
      amount: 10,
      currency: "usd",
      requestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      appOrigin: "https://fasttrack-delta.vercel.app",
      expiresAt: new Date(Date.now() + 30 * 60_000)
    }, { env: {} })).rejects.toEqual(expect.objectContaining<Partial<StripePaymentError>>({
      code: "not_configured"
    }));
  });

  it("will not charge unless webhook reconciliation and USD are configured", () => {
    expect(getStripePaymentConfiguration({ STRIPE_SECRET_KEY: "sk_test_example" })).toMatchObject({
      checkoutConfigured: false,
      missingCheckout: expect.arrayContaining(["STRIPE_WEBHOOK_SECRET"])
    });
    expect(getStripePaymentConfiguration({
      STRIPE_SECRET_KEY: "sk_test_example",
      STRIPE_WEBHOOK_SECRET: "whsec_example",
      STRIPE_MODE: "test",
      STRIPE_CURRENCY: "jpy"
    })).toMatchObject({
      checkoutConfigured: false,
      currency: "usd",
      missingCheckout: expect.arrayContaining(["STRIPE_CURRENCY must be usd"])
    });
  });
});
