import { describe, expect, it, vi } from "vitest";
import {
  clearPendingInvoiceDeliveryAttempt,
  readPendingInvoiceDeliveryAttempt,
  savePendingInvoiceDeliveryAttempt,
  type PendingInvoiceDeliveryAttempt
} from "@/lib/invoice-delivery-client";

const attempt: PendingInvoiceDeliveryAttempt = {
  invoiceId: "invoice-1",
  requestId: "11111111-1111-4111-8111-111111111111",
  channel: "email",
  destination: "customer@example.com",
  pdfSha256: "a".repeat(64),
  createdAt: "2026-07-22T18:00:00.000Z"
};

describe("pending invoice delivery continuity", () => {
  it("restores the same delivery tuple and request ID after a reload", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key)
    };

    savePendingInvoiceDeliveryAttempt(storage, attempt);
    expect(readPendingInvoiceDeliveryAttempt(storage, attempt.invoiceId)).toEqual(attempt);
    clearPendingInvoiceDeliveryAttempt(storage, attempt.invoiceId);
    expect(readPendingInvoiceDeliveryAttempt(storage, attempt.invoiceId)).toBeUndefined();
  });

  it("refuses malformed state instead of silently minting delivery details", () => {
    const storage = { getItem: vi.fn(() => JSON.stringify({ ...attempt, requestId: "not-a-uuid" })) };
    expect(readPendingInvoiceDeliveryAttempt(storage, attempt.invoiceId)).toBeUndefined();
  });
});
