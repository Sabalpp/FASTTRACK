import type { InvoicePaymentMethod } from "@/lib/invoice-payments";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STORAGE_PREFIX = "fasttrack:invoice-payment:v1:";

type CollectableMethod = Extract<InvoicePaymentMethod, "card" | "cash" | "check">;

export type PendingInvoicePaymentAttempt = {
  invoiceId: string;
  requestId: string;
  method: CollectableMethod;
  amount: number;
  reference: string;
  note: string;
  createdAt: string;
};

export function readPendingInvoicePaymentAttempt(
  storage: Pick<Storage, "getItem">,
  invoiceId: string
): PendingInvoicePaymentAttempt | undefined {
  const value = storage.getItem(storageKey(invoiceId));
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as Partial<PendingInvoicePaymentAttempt>;
    if (
      parsed.invoiceId !== invoiceId
      || typeof parsed.requestId !== "string"
      || !UUID_PATTERN.test(parsed.requestId)
      || (parsed.method !== "card" && parsed.method !== "cash" && parsed.method !== "check")
      || typeof parsed.amount !== "number"
      || !Number.isFinite(parsed.amount)
      || parsed.amount <= 0
      || Math.abs(parsed.amount * 100 - Math.round(parsed.amount * 100)) > 1e-6
      || typeof parsed.reference !== "string"
      || parsed.reference.length > 120
      || typeof parsed.note !== "string"
      || parsed.note.length > 500
      || typeof parsed.createdAt !== "string"
      || !Number.isFinite(Date.parse(parsed.createdAt))
    ) return undefined;
    return {
      invoiceId,
      requestId: parsed.requestId.toLowerCase(),
      method: parsed.method,
      amount: parsed.amount,
      reference: parsed.reference,
      note: parsed.note,
      createdAt: parsed.createdAt
    };
  } catch {
    return undefined;
  }
}

export function savePendingInvoicePaymentAttempt(
  storage: Pick<Storage, "setItem">,
  attempt: PendingInvoicePaymentAttempt
): void {
  storage.setItem(storageKey(attempt.invoiceId), JSON.stringify(attempt));
}

export function clearPendingInvoicePaymentAttempt(
  storage: Pick<Storage, "removeItem">,
  invoiceId: string
): void {
  storage.removeItem(storageKey(invoiceId));
}

function storageKey(invoiceId: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(invoiceId)}`;
}
