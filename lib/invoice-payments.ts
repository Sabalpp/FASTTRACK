export type InvoicePaymentMethod = "card" | "cash" | "check" | "other";
export type InvoicePaymentRecordStatus = "pending" | "succeeded" | "failed" | "cancelled" | "partially_refunded" | "refunded";

export type InvoicePayment = {
  id: string;
  invoiceId: string;
  method: InvoicePaymentMethod;
  status: InvoicePaymentRecordStatus;
  amount: number;
  refundedAmount: number;
  currency: string;
  reference?: string;
  note?: string;
  requestId: string;
  requestFingerprint: string;
  stripeCheckoutSessionId?: string;
  stripePaymentIntentId?: string;
  checkoutUrl?: string;
  providerStatus?: string;
  recordedBy?: string;
  expiresAt?: string;
  succeededAt?: string;
  failedAt?: string;
  refundedAt?: string;
  refundedBy?: string;
  reversalReason?: string;
  createdAt: string;
  updatedAt: string;
};

export type InvoicePaymentRow = {
  id: string;
  invoice_id: string;
  method: InvoicePaymentMethod;
  status: InvoicePaymentRecordStatus;
  amount: string | number;
  refunded_amount: string | number;
  currency: string;
  reference: string | null;
  note: string | null;
  request_id: string;
  request_fingerprint: string;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  stripe_checkout_url: string | null;
  provider_status: string | null;
  recorded_by: string | null;
  expires_at: string | null;
  succeeded_at: string | null;
  failed_at: string | null;
  refunded_at: string | null;
  refunded_by: string | null;
  reversal_reason: string | null;
  created_at: string;
  updated_at: string;
};

export function invoicePaymentFromRow(row: InvoicePaymentRow): InvoicePayment {
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    method: row.method,
    status: row.status,
    amount: Number(row.amount),
    refundedAmount: Number(row.refunded_amount ?? 0),
    currency: row.currency,
    reference: row.reference ?? undefined,
    note: row.note ?? undefined,
    requestId: row.request_id,
    requestFingerprint: row.request_fingerprint,
    stripeCheckoutSessionId: row.stripe_checkout_session_id ?? undefined,
    stripePaymentIntentId: row.stripe_payment_intent_id ?? undefined,
    checkoutUrl: row.stripe_checkout_url ?? undefined,
    providerStatus: row.provider_status ?? undefined,
    recordedBy: row.recorded_by ?? undefined,
    expiresAt: row.expires_at ?? undefined,
    succeededAt: row.succeeded_at ?? undefined,
    failedAt: row.failed_at ?? undefined,
    refundedAt: row.refunded_at ?? undefined,
    refundedBy: row.refunded_by ?? undefined,
    reversalReason: row.reversal_reason ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function paymentMethodLabel(method: InvoicePaymentMethod) {
  if (method === "card") return "Card";
  if (method === "cash") return "Cash";
  if (method === "check") return "Check";
  return "Imported payment";
}
