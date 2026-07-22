import { createId } from "@/lib/id";
import { protectedJson } from "@/lib/protected-api-client";
import type { InvoicePayment, InvoicePaymentMethod } from "@/lib/invoice-payments";
import type { Invoice } from "@/lib/types";

export async function loadInvoicePayments(invoiceId: string) {
  return protectedJson<{ payments: InvoicePayment[]; invoice: Invoice }>(`/api/invoices/${invoiceId}/payments`, {
    cache: "no-store"
  });
}

export async function collectInvoicePayment(invoiceId: string, input: {
  method: Extract<InvoicePaymentMethod, "cash" | "check">;
  amount: number;
  reference?: string;
  note?: string;
  requestId?: string;
}) {
  return protectedJson<{ payment: InvoicePayment; payments: InvoicePayment[]; invoice: Invoice }>(`/api/invoices/${invoiceId}/payments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...input, requestId: input.requestId ?? createId() })
  });
}

export async function createInvoiceCardCheckout(invoiceId: string, input: {
  amount: number;
  requestId?: string;
}) {
  return protectedJson<{ payment: InvoicePayment; checkoutUrl?: string; payments?: InvoicePayment[]; invoice: Invoice }>(`/api/invoices/${invoiceId}/payments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method: "card", ...input, requestId: input.requestId ?? createId() })
  });
}

export async function refundManualInvoicePayment(invoiceId: string, paymentId: string, reason: string) {
  return protectedJson<{ payment: InvoicePayment; payments: InvoicePayment[]; invoice: Invoice }>(`/api/invoices/${invoiceId}/payments`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "refund_manual", paymentId, reason })
  });
}

export async function reconcileInvoiceCardPayment(
  invoiceId: string,
  paymentId: string,
  expire = false
) {
  return protectedJson<{ payment: InvoicePayment; payments: InvoicePayment[]; invoice: Invoice; stripeStatus: string }>(`/api/invoices/${invoiceId}/payments`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: expire ? "expire_card" : "reconcile_card", paymentId })
  });
}
