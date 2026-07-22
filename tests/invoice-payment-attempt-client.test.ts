import { describe, expect, it } from "vitest";
import {
  clearPendingInvoicePaymentAttempt,
  readPendingInvoicePaymentAttempt,
  savePendingInvoicePaymentAttempt,
  type PendingInvoicePaymentAttempt
} from "@/lib/invoice-payment-attempt-client";

const attempt: PendingInvoicePaymentAttempt = {
  invoiceId: "invoice-1",
  requestId: "11111111-1111-4111-8111-111111111111",
  method: "check",
  amount: 125.5,
  reference: "1042",
  note: "Received at the job",
  createdAt: "2026-07-22T18:00:00.000Z"
};

describe("pending invoice payment continuity", () => {
  it("restores the exact frozen payment draft and request ID", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key)
    };
    savePendingInvoicePaymentAttempt(storage, attempt);
    expect(readPendingInvoicePaymentAttempt(storage, attempt.invoiceId)).toEqual(attempt);
    clearPendingInvoicePaymentAttempt(storage, attempt.invoiceId);
    expect(readPendingInvoicePaymentAttempt(storage, attempt.invoiceId)).toBeUndefined();
  });

  it("accepts ordinary two-decimal amounts despite binary floating-point representation", () => {
    const value = JSON.stringify({ ...attempt, amount: 19.99 });
    const storage = { getItem: () => value };
    expect(readPendingInvoicePaymentAttempt(storage, attempt.invoiceId)?.amount).toBe(19.99);
  });
});
