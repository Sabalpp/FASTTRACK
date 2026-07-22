"use client";

import { Banknote, CheckCircle2, CreditCard, ExternalLink, LoaderCircle, ReceiptText, RotateCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatDateTime } from "@/lib/date";
import { balanceDue, selectedTotal } from "@/lib/invoice";
import {
  collectInvoicePayment,
  createInvoiceCardCheckout,
  loadInvoicePayments,
  reconcileInvoiceCardPayment,
  refundManualInvoicePayment
} from "@/lib/invoice-payments-client";
import {
  paymentMethodLabel,
  type InvoicePayment,
  type InvoicePaymentMethod
} from "@/lib/invoice-payments";
import {
  clearPendingInvoicePaymentAttempt,
  readPendingInvoicePaymentAttempt,
  savePendingInvoicePaymentAttempt
} from "@/lib/invoice-payment-attempt-client";
import { createId } from "@/lib/id";
import { money } from "@/lib/money";
import { demoMode } from "@/lib/runtime";
import type { Invoice, Role } from "@/lib/types";
import styles from "./InvoicePaymentsPanel.module.css";

type CollectableMethod = Extract<InvoicePaymentMethod, "card" | "cash" | "check">;

export function InvoicePaymentsPanel({
  invoice,
  role,
  canCollect,
  onInvoiceUpdated
}: {
  invoice: Invoice;
  role: Role;
  canCollect: boolean;
  onInvoiceUpdated: (invoice: Invoice) => void;
}) {
  const [payments, setPayments] = useState<InvoicePayment[]>([]);
  const [method, setMethod] = useState<CollectableMethod>("card");
  const [amount, setAmount] = useState(() => String(balanceDue(invoice)));
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [paymentRequestId, setPaymentRequestId] = useState(() => createId());
  const [loading, setLoading] = useState(!demoMode);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [paymentAttemptNeedsReview, setPaymentAttemptNeedsReview] = useState(false);
  const [paymentAttemptTerminal, setPaymentAttemptTerminal] = useState(false);
  const initializedInvoiceId = useRef<string | undefined>(undefined);

  const refresh = useCallback(async () => {
    if (demoMode) return;
    setLoading(true);
    try {
      const result = await loadInvoicePayments(invoice.id);
      setPayments(result.payments);
      onInvoiceUpdated(result.invoice);
      const pending = readPendingInvoicePaymentAttempt(window.localStorage, invoice.id);
      const recorded = pending
        ? result.payments.find((payment) => payment.requestId === pending.requestId)
        : undefined;
      if (pending && recorded) {
        if (recorded.method === "card" && (recorded.status === "failed" || recorded.status === "cancelled")) {
          setPaymentAttemptNeedsReview(true);
          setPaymentAttemptTerminal(true);
        } else {
          clearPendingInvoicePaymentAttempt(window.localStorage, invoice.id);
          setPaymentRequestId(createId());
          setPaymentAttemptNeedsReview(false);
          setPaymentAttemptTerminal(false);
        }
      }
      setError(undefined);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Payment history could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [invoice.id, onInvoiceUpdated]);

  useEffect(() => {
    if (typeof window === "undefined" || demoMode || initializedInvoiceId.current === invoice.id) return;
    initializedInvoiceId.current = invoice.id;
    const pending = readPendingInvoicePaymentAttempt(window.localStorage, invoice.id);
    if (!pending) return;
    setPaymentRequestId(pending.requestId);
    setMethod(pending.method);
    setAmount(String(pending.amount));
    setReference(pending.reference);
    setNote(pending.note);
    setPaymentAttemptNeedsReview(true);
    setPaymentAttemptTerminal(false);
  }, [invoice.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (typeof window === "undefined" || demoMode) return;
    const result = new URLSearchParams(window.location.search).get("payment");
    if (result === "success") {
      setMessage("Stripe accepted the payment. Confirming the verified webhook record…");
      const timers = [1_500, 3_500, 7_000].map((delay) => window.setTimeout(() => void refresh(), delay));
      return () => timers.forEach((timer) => window.clearTimeout(timer));
    }
    if (result === "cancelled") setMessage("The Checkout page was closed. The card session remains open until Stripe confirms payment, you cancel it here, or it expires.");
  }, [refresh]);

  const currentBalance = balanceDue(invoice);
  useEffect(() => {
    if (!paymentAttemptNeedsReview) setAmount(String(currentBalance));
  }, [currentBalance, paymentAttemptNeedsReview]);

  const activeCheckout = useMemo(() => payments.find((payment) => (
    payment.method === "card"
    && payment.status === "pending"
  )), [payments]);

  async function collect(
    requestId?: string,
    override?: { method: CollectableMethod; amount: number }
  ) {
    if (!canCollect || busy) return;
    const collectionMethod = override?.method ?? method;
    const requestedAmount = Math.round(((override?.amount ?? Number(amount)) + Number.EPSILON) * 100) / 100;
    const effectiveRequestId = requestId ?? paymentRequestId;
    if (!Number.isFinite(requestedAmount) || requestedAmount <= 0 || requestedAmount > currentBalance) {
      setError("Enter an amount greater than zero and no more than the balance due.");
      return;
    }
    setBusy(true);
    setMessage(undefined);
    setError(undefined);
    setPaymentAttemptTerminal(false);
    try {
      if (demoMode) {
        const now = new Date().toISOString();
        const demoRequestId = effectiveRequestId;
        const demoPayment: InvoicePayment = {
          id: demoRequestId,
          invoiceId: invoice.id,
          method: collectionMethod,
          status: "succeeded",
          amount: requestedAmount,
          refundedAmount: 0,
          currency: "usd",
          reference: collectionMethod === "check" ? reference.trim() : undefined,
          note: note.trim() || undefined,
          requestId: demoRequestId,
          requestFingerprint: "demo",
          recordedBy: "demo",
          succeededAt: now,
          refundedBy: undefined,
          reversalReason: undefined,
          createdAt: now,
          updatedAt: now
        };
        const nextPaid = Math.min(selectedTotal(invoice), invoice.amountPaid + requestedAmount);
        const next: Invoice = {
          ...invoice,
          amountPaid: nextPaid,
          paymentStatus: nextPaid === selectedTotal(invoice) ? "paid" : "partially_paid",
          status: nextPaid === selectedTotal(invoice) ? "paid" : invoice.status,
          pdfStoragePath: undefined,
          pdfGeneratedAt: undefined,
          pdfSha256: undefined,
          pdfSizeBytes: undefined,
          pdfWorkflowRevision: undefined,
          updatedAt: now
        };
        setPayments((current) => [demoPayment, ...current]);
        onInvoiceUpdated(next);
        setMessage(collectionMethod === "card"
          ? "Demo card payment recorded. Live mode redirects to Stripe Checkout and waits for a verified webhook."
          : `${paymentMethodLabel(collectionMethod)} payment recorded in demo mode.`);
        setReference("");
        setNote("");
        setPaymentRequestId(createId());
        setPaymentAttemptNeedsReview(false);
        return;
      }

      savePendingInvoicePaymentAttempt(window.localStorage, {
        invoiceId: invoice.id,
        requestId: effectiveRequestId,
        method: collectionMethod,
        amount: requestedAmount,
        reference: collectionMethod === "check" ? reference.trim() : "",
        note: collectionMethod === "card" ? "" : note.trim(),
        createdAt: new Date().toISOString()
      });
      setPaymentAttemptNeedsReview(true);

      if (collectionMethod === "card") {
        const result = await createInvoiceCardCheckout(invoice.id, { amount: requestedAmount, requestId: effectiveRequestId });
        setPayments((current) => [result.payment, ...current.filter((payment) => payment.id !== result.payment.id)]);
        onInvoiceUpdated(result.invoice);
        if (result.checkoutUrl) {
          clearPendingInvoicePaymentAttempt(window.localStorage, invoice.id);
          setPaymentRequestId(createId());
          setPaymentAttemptNeedsReview(false);
          window.location.assign(result.checkoutUrl);
          return;
        }
        if (result.payments) setPayments(result.payments);
        setMessage(`This card request is already ${result.payment.status.replaceAll("_", " ")}; no checkout was reopened.`);
        if (result.payment.status === "failed" || result.payment.status === "cancelled") {
          setPaymentAttemptTerminal(true);
        } else {
          clearPendingInvoicePaymentAttempt(window.localStorage, invoice.id);
          setPaymentRequestId(createId());
          setPaymentAttemptNeedsReview(false);
        }
        return;
      }

      const result = await collectInvoicePayment(invoice.id, {
        method: collectionMethod,
        amount: requestedAmount,
        reference: collectionMethod === "check" ? reference.trim() || undefined : undefined,
        note: note.trim() || undefined,
        requestId: effectiveRequestId
      });
      setPayments(result.payments);
      onInvoiceUpdated(result.invoice);
      setReference("");
      setNote("");
      clearPendingInvoicePaymentAttempt(window.localStorage, invoice.id);
      setPaymentRequestId(createId());
      setPaymentAttemptNeedsReview(false);
      setMessage(`${paymentMethodLabel(collectionMethod)} payment recorded. The invoice balance is updated.`);
    } catch (collectError) {
      setError(collectError instanceof Error ? collectError.message : "The payment could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  function prepareNewPaymentAttempt() {
    if (!demoMode) clearPendingInvoicePaymentAttempt(window.localStorage, invoice.id);
    setPaymentRequestId(createId());
    setPaymentAttemptNeedsReview(false);
    setPaymentAttemptTerminal(false);
    setError(undefined);
    setMessage("A new payment attempt is ready. Confirm the prior payment or Stripe activity first if its outcome was unknown.");
  }

  async function reverse(payment: InvoicePayment) {
    if (role !== "owner" || busy) return;
    setBusy(true);
    setMessage(undefined);
    setError(undefined);
    try {
      if (demoMode) {
        const now = new Date().toISOString();
        setPayments((current) => current.map((candidate) => candidate.id === payment.id
          ? { ...candidate, status: "refunded", refundedAt: now, updatedAt: now }
          : candidate));
        const nextPaid = Math.max(0, invoice.amountPaid - payment.amount);
        onInvoiceUpdated({
          ...invoice,
          amountPaid: nextPaid,
          paymentStatus: nextPaid === 0 ? "refunded" : "partially_paid",
          status: invoice.sentAt ? "sent" : "draft",
          pdfStoragePath: undefined,
          pdfGeneratedAt: undefined,
          pdfSha256: undefined,
          pdfSizeBytes: undefined,
          pdfWorkflowRevision: undefined,
          updatedAt: now
        });
      } else {
        const result = await refundManualInvoicePayment(invoice.id, payment.id, "Owner reversed the manual payment from the invoice workspace.");
        setPayments(result.payments);
        onInvoiceUpdated(result.invoice);
      }
      setMessage("Manual payment reversed with an audit record. The original row was not deleted.");
    } catch (reverseError) {
      setError(reverseError instanceof Error ? reverseError.message : "The payment could not be reversed.");
    } finally {
      setBusy(false);
    }
  }

  async function reconcileCard(payment: InvoicePayment, expire = false) {
    if (busy || payment.method !== "card") return;
    if (expire && typeof window !== "undefined" && !window.confirm("Cancel this Stripe Checkout session? The customer will no longer be able to pay with its open link.")) return;
    setBusy(true);
    setMessage(undefined);
    setError(undefined);
    try {
      if (demoMode) {
        const nextStatus = expire ? "cancelled" : payment.status;
        setPayments((current) => current.map((candidate) => candidate.id === payment.id
          ? { ...candidate, status: nextStatus, providerStatus: expire ? "expired" : candidate.providerStatus }
          : candidate));
        setMessage(expire ? "Demo checkout cancelled." : "Demo checkout status refreshed.");
        return;
      }
      const result = await reconcileInvoiceCardPayment(invoice.id, payment.id, expire);
      setPayments(result.payments);
      onInvoiceUpdated(result.invoice);
      setMessage(expire
        ? `Stripe checkout is ${result.stripeStatus}.`
        : `Stripe status checked: ${result.stripeStatus}. Invoice totals now match the verified provider state.`);
    } catch (reconcileError) {
      setError(reconcileError instanceof Error ? reconcileError.message : "Stripe status could not be reconciled.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="invoice-payment-heading">
      <header className={styles.header}>
        <div>
          <span>Payments</span>
          <h3 id="invoice-payment-heading">Collect and reconcile payment</h3>
          <p>Card details stay on Stripe. Cash and check are saved to the immutable invoice ledger.</p>
        </div>
        <div className={styles.balance}>
          <span>Balance due</span>
          <strong>{money(currentBalance)}</strong>
        </div>
      </header>

      {canCollect && currentBalance > 0 ? (
        <div className={styles.collector}>
          <div className={styles.methodTabs} role="group" aria-label="Payment method">
            <MethodButton method="card" selected={method === "card"} onSelect={setMethod} icon={<CreditCard size={18} />} disabled={busy || paymentAttemptNeedsReview} />
            <MethodButton method="cash" selected={method === "cash"} onSelect={setMethod} icon={<Banknote size={18} />} disabled={busy || paymentAttemptNeedsReview} />
            <MethodButton method="check" selected={method === "check"} onSelect={setMethod} icon={<ReceiptText size={18} />} disabled={busy || paymentAttemptNeedsReview} />
          </div>

          {activeCheckout ? (
            <div className={styles.openCheckout}>
              <div><strong>Card checkout already open</strong><span>{money(activeCheckout.amount)} · {activeCheckout.expiresAt && Date.parse(activeCheckout.expiresAt) <= Date.now() ? "awaiting Stripe expiry confirmation" : `expires ${activeCheckout.expiresAt ? formatDateTime(activeCheckout.expiresAt) : "soon"}`}</span></div>
              <div className={styles.checkoutActions}>
                {activeCheckout.checkoutUrl && (!activeCheckout.expiresAt || Date.parse(activeCheckout.expiresAt) > Date.now()) ? (
                  <a href={activeCheckout.checkoutUrl} target="_self"><ExternalLink size={16} /> Open checkout</a>
                ) : !activeCheckout.checkoutUrl ? (
                  <button type="button" onClick={() => void collect(activeCheckout.requestId, { method: "card", amount: activeCheckout.amount })} disabled={busy || Boolean(activeCheckout.expiresAt && Date.parse(activeCheckout.expiresAt) <= Date.now())}><RotateCw size={16} /> Retry checkout</button>
                ) : null}
                <button type="button" onClick={() => void reconcileCard(activeCheckout)} disabled={busy}><RotateCw size={16} /> Check Stripe</button>
                <button type="button" onClick={() => void reconcileCard(activeCheckout, true)} disabled={busy}>Cancel checkout</button>
              </div>
            </div>
          ) : (
            <>
              <label className={styles.field}>
                <span>Amount</span>
                <input type="number" min="0.01" max={currentBalance} step="0.01" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} disabled={busy || paymentAttemptNeedsReview} />
              </label>
              {method === "check" ? (
                <label className={styles.field}>
                  <span>Check number or reference</span>
                  <input value={reference} maxLength={120} onChange={(event) => setReference(event.target.value)} autoComplete="off" disabled={busy || paymentAttemptNeedsReview} />
                </label>
              ) : null}
              {method !== "card" ? (
                <label className={styles.field}>
                  <span>Internal note <small>optional</small></span>
                  <input value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} placeholder="Receipt, drawer, or collection note" disabled={busy || paymentAttemptNeedsReview} />
                </label>
              ) : null}
              <button className={styles.collectButton} type="button" onClick={() => void collect()} disabled={busy || paymentAttemptNeedsReview || (method === "check" && reference.trim().length === 0)}>
                {busy ? <LoaderCircle className="spin" size={18} /> : method === "card" ? <CreditCard size={18} /> : <CheckCircle2 size={18} />}
                {busy ? "Working…" : method === "card" ? "Open secure card checkout" : `Record ${method} payment`}
              </button>
              <p className={styles.providerNote}>{method === "card"
                ? "Stripe Checkout opens on this iPad. The balance changes only after Stripe signs and sends the payment webhook."
                : "Confirm the money or check is physically received before recording it."}</p>
              {paymentAttemptNeedsReview ? (
                <div className={styles.openCheckout} role="status">
                  <div>
                    <strong>{paymentAttemptTerminal ? "This card request is closed" : "Payment attempt needs review"}</strong>
                    <span>{paymentAttemptTerminal ? "Start a fresh checkout when you are ready." : "The exact draft and request ID are frozen so a retry cannot record the payment twice."}</span>
                  </div>
                  <div className={styles.checkoutActions}>
                    {!paymentAttemptTerminal ? <button type="button" onClick={() => void collect()} disabled={busy}><RotateCw size={16} /> Retry same request</button> : null}
                    <button type="button" onClick={prepareNewPaymentAttempt} disabled={busy}>Start new attempt</button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {message ? <p className={styles.message} role="status">{message}</p> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      <div className={styles.history}>
        <div className={styles.historyHeading}>
          <strong>Payment history</strong>
          {!demoMode ? <button type="button" onClick={() => void refresh()} disabled={loading || busy}><RotateCw size={15} /> Refresh</button> : null}
        </div>
        {loading ? <p className={styles.empty}><LoaderCircle className="spin" size={17} /> Loading payment ledger…</p>
          : payments.length === 0 ? <p className={styles.empty}>No payments recorded yet.</p>
            : payments.map((payment) => (
              <article key={payment.id} className={styles.paymentRow} data-status={payment.status}>
                <span className={styles.paymentIcon}>{payment.method === "card" ? <CreditCard size={17} /> : payment.method === "cash" ? <Banknote size={17} /> : <ReceiptText size={17} />}</span>
                <div>
                  <strong>{paymentMethodLabel(payment.method)} · {money(payment.amount)}</strong>
                  <span>{payment.reference ? `${payment.reference} · ` : ""}{formatDateTime(payment.succeededAt ?? payment.createdAt)}</span>
                  {payment.refundedAmount > 0 ? <small>{money(payment.refundedAmount)} refunded</small> : null}
                  {payment.reversalReason ? <small>{payment.reversalReason}</small> : null}
                  {payment.note ? <small>{payment.note}</small> : null}
                </div>
                <div className={styles.paymentState}>
                  <span>{payment.status.replace("_", " ")}</span>
                  {role === "owner" && payment.method !== "card" && payment.status === "succeeded" ? (
                    <button type="button" onClick={() => void reverse(payment)} disabled={busy}>Reverse</button>
                  ) : null}
                </div>
              </article>
            ))}
      </div>
    </section>
  );
}

function MethodButton({ method, selected, onSelect, icon, disabled = false }: {
  method: CollectableMethod;
  selected: boolean;
  onSelect: (method: CollectableMethod) => void;
  icon: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button type="button" data-selected={selected} aria-pressed={selected} onClick={() => onSelect(method)} disabled={disabled}>
      {icon}{paymentMethodLabel(method)}
    </button>
  );
}
