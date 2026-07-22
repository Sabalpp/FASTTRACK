import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { stripeLivemodeMatchesConfiguration } from "@/lib/stripe-payments";
import { processStripeRefund } from "@/lib/stripe-webhook";

describe("Stripe webhook reconciliation", () => {
  beforeEach(() => {
    vi.stubEnv("STRIPE_MODE", "test");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_example");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_example");
  });

  it("records a refund by immutable refund ID even when it arrives before checkout success", async () => {
    const rpc = vi.fn(async () => ({ data: { id: "re_test_1" }, error: null }));
    const supabase = refundDatabase(paymentRow({ status: "pending", stripe_payment_intent_id: null }), rpc);

    const outcome = await processStripeRefund(supabase as never, refund({
      id: "re_test_1",
      status: "pending",
      amount: 2_500
    }));

    expect(outcome).toBe("processed");
    expect(rpc).toHaveBeenCalledExactlyOnceWith("record_stripe_payment_refund", expect.objectContaining({
      p_refund_id: "re_test_1",
      p_payment_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      p_payment_intent_id: "pi_test_1",
      p_amount: 25,
      p_status: "pending"
    }));
  });

  it("reduces the ledger only from provider-succeeded refund rows", async () => {
    const rpc = vi.fn(async () => ({ data: { id: "re_test_2" }, error: null }));
    const supabase = refundDatabase(paymentRow(), rpc);

    await processStripeRefund(supabase as never, refund({
      id: "re_test_2",
      status: "succeeded",
      amount: 5_000
    }));

    expect(rpc).toHaveBeenCalledWith("record_stripe_payment_refund", expect.objectContaining({
      p_amount: 50,
      p_status: "succeeded",
      p_provider_status: "succeeded"
    }));
  });

  it("rejects live events while the app is explicitly in Stripe test mode", async () => {
    const rpc = vi.fn();
    const supabase = refundDatabase(paymentRow(), rpc);
    await expect(processStripeRefund(supabase as never, refund({ livemode: true })))
      .rejects.toThrow("mode does not match STRIPE_MODE");
    expect(rpc).not.toHaveBeenCalled();
    expect(stripeLivemodeMatchesConfiguration(false)).toBe(true);
    expect(stripeLivemodeMatchesConfiguration(true)).toBe(false);
  });
});

function refund(overrides: (Partial<Stripe.Refund> & { livemode?: boolean }) = {}) {
  return {
    id: "re_test_1",
    object: "refund",
    amount: 2_500,
    balance_transaction: null,
    charge: "ch_test_1",
    created: 1_784_742_400,
    currency: "usd",
    destination_details: null,
    failure_balance_transaction: null,
    failure_reason: null,
    instructions_email: null,
    metadata: { fast_track_payment_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    next_action: null,
    payment_intent: "pi_test_1",
    pending_reason: null,
    reason: null,
    receipt_number: null,
    source_transfer_reversal: null,
    status: "succeeded",
    transfer_reversal: null,
    livemode: false,
    ...overrides
  } as unknown as Stripe.Refund;
}

function paymentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    invoice_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    method: "card",
    status: "succeeded",
    amount: 100,
    refunded_amount: 0,
    currency: "usd",
    reference: null,
    note: null,
    request_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    request_fingerprint: "f".repeat(64),
    stripe_checkout_session_id: "cs_test_1",
    stripe_payment_intent_id: "pi_test_1",
    stripe_checkout_url: null,
    provider_status: "paid",
    recorded_by: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    expires_at: null,
    succeeded_at: "2026-07-22T12:00:00.000Z",
    failed_at: null,
    refunded_at: null,
    refunded_by: null,
    reversal_reason: null,
    created_at: "2026-07-22T12:00:00.000Z",
    updated_at: "2026-07-22T12:00:00.000Z",
    ...overrides
  };
}

function refundDatabase(row: ReturnType<typeof paymentRow>, rpc: ReturnType<typeof vi.fn>) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(async () => ({ data: row, error: null }))
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return { from: vi.fn(() => query), rpc };
}
