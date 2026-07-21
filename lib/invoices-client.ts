import { protectedFetch, protectedJson } from "@/lib/protected-api-client";
import type { Invoice, InvoiceOptionLabel, InvoicePaymentStatus, Job, Tier } from "@/lib/types";

export async function createProtectedInvoiceDraft(jobId: string) {
  const result = await protectedJson<{ invoice: Invoice }>("/api/invoices", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jobId })
  });
  return result.invoice;
}

export async function loadProtectedInvoice(invoiceId: string) {
  const result = await protectedJson<{ invoice: Invoice }>(`/api/invoices/${invoiceId}`, { cache: "no-store" });
  return result.invoice;
}

export async function saveProtectedInvoiceReview(invoiceId: string, input: {
  selectedTier: Tier;
  optionLabel: InvoiceOptionLabel;
  notes: string;
}) {
  const result = await protectedJson<{ invoice: Invoice }>(`/api/invoices/${invoiceId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "review", ...input })
  });
  return result.invoice;
}

export async function saveProtectedInvoicePayment(invoiceId: string, input: {
  paymentStatus: InvoicePaymentStatus;
  amountPaid: number;
}) {
  const result = await protectedJson<{ invoice: Invoice }>(`/api/invoices/${invoiceId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "payment", ...input })
  });
  return result.invoice;
}

export async function markProtectedInvoiceSent(
  invoiceId: string,
  email: string,
  requestId = crypto.randomUUID()
) {
  const result = await protectedJson<{ invoice: Invoice }>(`/api/invoices/${invoiceId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "send", email, requestId })
  });
  return result.invoice;
}

export async function loadProtectedInvoicePdf(invoiceId: string) {
  const response = await protectedFetch(`/api/invoices/${invoiceId}/pdf`, { cache: "no-store" });
  if (response.status === 404) return null;
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? "The saved PDF could not be loaded.");
  }
  return response.blob();
}

export async function generateProtectedInvoicePdf(invoiceId: string) {
  const response = await protectedFetch(`/api/invoices/${invoiceId}/pdf`, { method: "POST" });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? "The invoice PDF could not be generated.");
  }
  return response.blob();
}

export async function completeProtectedJob(jobId: string, overrideReason?: string) {
  const result = await protectedJson<{ job: Job }>(`/api/jobs/${jobId}/complete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ overrideReason })
  });
  return result.job;
}
