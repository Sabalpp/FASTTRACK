import type { InvoiceDeliveryChannel } from "@/lib/invoice-delivery";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
const STORAGE_PREFIX = "fasttrack:invoice-delivery:v1:";

export type PendingInvoiceDeliveryAttempt = {
  invoiceId: string;
  requestId: string;
  channel: InvoiceDeliveryChannel;
  destination: string;
  pdfSha256: string;
  createdAt: string;
};

export function readPendingInvoiceDeliveryAttempt(
  storage: Pick<Storage, "getItem">,
  invoiceId: string
): PendingInvoiceDeliveryAttempt | undefined {
  const value = storage.getItem(storageKey(invoiceId));
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as Partial<PendingInvoiceDeliveryAttempt>;
    if (
      parsed.invoiceId !== invoiceId
      || typeof parsed.requestId !== "string"
      || !UUID_PATTERN.test(parsed.requestId)
      || (parsed.channel !== "email" && parsed.channel !== "sms")
      || typeof parsed.destination !== "string"
      || parsed.destination.trim().length === 0
      || parsed.destination.length > 320
      || typeof parsed.pdfSha256 !== "string"
      || !SHA256_PATTERN.test(parsed.pdfSha256)
      || typeof parsed.createdAt !== "string"
      || !Number.isFinite(Date.parse(parsed.createdAt))
    ) return undefined;
    return {
      invoiceId,
      requestId: parsed.requestId.toLowerCase(),
      channel: parsed.channel,
      destination: parsed.destination,
      pdfSha256: parsed.pdfSha256.toLowerCase(),
      createdAt: parsed.createdAt
    };
  } catch {
    return undefined;
  }
}

export function savePendingInvoiceDeliveryAttempt(
  storage: Pick<Storage, "setItem">,
  attempt: PendingInvoiceDeliveryAttempt
): void {
  storage.setItem(storageKey(attempt.invoiceId), JSON.stringify(attempt));
}

export function clearPendingInvoiceDeliveryAttempt(
  storage: Pick<Storage, "removeItem">,
  invoiceId: string
): void {
  storage.removeItem(storageKey(invoiceId));
}

function storageKey(invoiceId: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(invoiceId)}`;
}
