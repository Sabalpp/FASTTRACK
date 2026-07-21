"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Check, FileCheck2, LoaderCircle, Mail, PenLine, RotateCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { InvoicePreview } from "@/components/InvoicePreview";
import { SignatureDialog } from "@/components/SignatureDialog";
import { SignatureStatusCard } from "@/components/SignatureStatusCard";
import { Button, Card, EmptyState, Field, PageHeader, StatusPill, TwoColumn } from "@/components/ui";
import { canSendInvoices, canViewInvoice } from "@/lib/access";
import { useAuth } from "@/lib/auth";
import { tierLabels, tierOptions, useAppData } from "@/lib/data-store";
import { firstPopulatedTier, invoiceOptionLabels } from "@/lib/invoice";
import {
  loadProtectedInvoice,
  markProtectedInvoiceSent,
  saveProtectedInvoicePayment,
  saveProtectedInvoiceReview
} from "@/lib/invoices-client";
import { money } from "@/lib/money";
import { demoMode } from "@/lib/runtime";
import { loadSignatures, rejectSignature, saveSignature } from "@/lib/signatures-client";
import type {
  Invoice,
  InvoiceOptionLabel,
  InvoicePaymentStatus,
  InvoiceSignature,
  SignaturePurpose,
  SignatureSignerRole,
  Tier
} from "@/lib/types";

const InvoicePdfViewer = dynamic(
  () => import("@/components/InvoicePdfViewer").then((module) => module.InvoicePdfViewer),
  {
    ssr: false,
    loading: () => <div className="pdf-loading compact-pdf-loading">Preparing PDF tools...</div>
  }
);

type DialogConfig = {
  purpose: SignaturePurpose;
  signerRole: SignatureSignerRole;
  title: string;
  description: string;
  defaultSignerName: string;
};

export default function InvoiceDetailPage() {
  const params = useParams<{ id: string | string[] }>();
  const invoiceId = Array.isArray(params.id) ? params.id[0] : params.id;
  const { currentUser } = useAuth();
  const data = useAppData();
  const invoice = data.invoices.find((candidate) => candidate.id === invoiceId);
  const job = invoice ? data.jobs.find((candidate) => candidate.id === invoice.jobId) : undefined;
  const customer = job ? data.customers.find((candidate) => candidate.id === job.customerId) : undefined;
  const items = useMemo(
    () => invoice ? data.jobLineItems.filter((item) => item.jobId === invoice.jobId).sort((left, right) => left.sortOrder - right.sortOrder) : [],
    [data.jobLineItems, invoice]
  );
  const [selectedTier, setSelectedTier] = useState<Tier | undefined>();
  const [optionLabel, setOptionLabel] = useState<InvoiceOptionLabel>("approved_work");
  const [notes, setNotes] = useState("");
  const [email, setEmail] = useState("");
  const [paymentStatus, setPaymentStatus] = useState<InvoicePaymentStatus>("unpaid");
  const [amountPaid, setAmountPaid] = useState("0");
  const [detailLoading, setDetailLoading] = useState(!demoMode);
  const [detailError, setDetailError] = useState<string | undefined>();
  const [reviewBusy, setReviewBusy] = useState(false);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [sendBusy, setSendBusy] = useState(false);
  const [message, setMessage] = useState<string | undefined>();
  const [actionError, setActionError] = useState<string | undefined>();
  const [signatures, setSignatures] = useState<InvoiceSignature[]>([]);
  const [signaturesLoading, setSignaturesLoading] = useState(false);
  const [signatureError, setSignatureError] = useState<string | undefined>();
  const [dialog, setDialog] = useState<DialogConfig | undefined>();

  function replaceInvoice(nextInvoice: Invoice) {
    data.setState((current) => ({
      ...current,
      invoices: current.invoices.some((candidate) => candidate.id === nextInvoice.id)
        ? current.invoices.map((candidate) => candidate.id === nextInvoice.id ? nextInvoice : candidate)
        : [nextInvoice, ...current.invoices]
    }));
  }

  async function refreshInvoice(showLoading = false) {
    if (demoMode || !invoiceId) return invoice;
    if (showLoading) setDetailLoading(true);
    setDetailError(undefined);
    try {
      const refreshed = await loadProtectedInvoice(invoiceId);
      replaceInvoice(refreshed);
      return refreshed;
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "The invoice draft could not be loaded.");
      return undefined;
    } finally {
      if (showLoading) setDetailLoading(false);
    }
  }

  useEffect(() => {
    if (!data.loaded || !invoiceId || demoMode) return;
    let cancelled = false;
    setDetailLoading(!invoice);
    setDetailError(undefined);
    void loadProtectedInvoice(invoiceId)
      .then((refreshed) => {
        if (!cancelled) replaceInvoice(refreshed);
      })
      .catch((error) => {
        if (!cancelled) setDetailError(error instanceof Error ? error.message : "The invoice draft could not be loaded.");
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => { cancelled = true; };
    // The invoice id is the refresh boundary. App state updates must not restart this request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.loaded, invoiceId]);

  useEffect(() => {
    if (!invoice) return;
    setSelectedTier(firstPopulatedTier(invoice));
    setOptionLabel(invoice.optionLabel);
    setNotes(invoice.notes);
    setPaymentStatus(invoice.paymentStatus);
    setAmountPaid(String(invoice.amountPaid));
    setEmail(invoice.sentToEmail ?? customer?.email ?? "");
  }, [customer?.email, invoice?.id, invoice?.updatedAt]);

  async function refreshSignatures() {
    if (!invoiceId) return;
    setSignaturesLoading(true);
    setSignatureError(undefined);
    try {
      setSignatures(await loadSignatures({ type: "invoice", id: invoiceId }));
    } catch (error) {
      setSignatureError(error instanceof Error ? error.message : "Signatures could not be loaded.");
    } finally {
      setSignaturesLoading(false);
    }
  }

  useEffect(() => {
    if (!invoice?.id) return;
    void refreshSignatures();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice?.id]);

  if (!data.loaded || (detailLoading && !invoice)) {
    return (
      <main className="page-shell">
        <Card className="invoice-route-loading">
          <LoaderCircle className="spin" size={28} aria-hidden="true" />
          <div><h2>Loading invoice draft</h2><p className="muted">Restoring the customer, job, charges, and saved signatures.</p></div>
        </Card>
      </main>
    );
  }

  if (!invoice) {
    return (
      <main className="page-shell">
        <EmptyState
          title="Invoice draft did not load"
          description={detailError ?? "The invoice may have moved or the connection may be slow."}
          action={<Button onClick={() => void refreshInvoice(true)}><RotateCw size={16} aria-hidden="true" /> Retry invoice</Button>}
        />
      </main>
    );
  }

  if (!canViewInvoice(currentUser, invoice, data.jobs)) {
    return <main className="page-shell"><EmptyState title="Invoice not available" description="This invoice is outside this role's access." /></main>;
  }
  if (!job || !customer) {
    return <main className="page-shell"><EmptyState title="Invoice data is incomplete" description="The related job or customer could not be found." /></main>;
  }

  const invoiceRecord = invoice;
  const jobRecord = job;
  const customerRecord = customer;
  const canEdit = canSendInvoices(currentUser.role);
  const approval = signatures.find((signature) => signature.status === "active" && signature.purpose === "invoice_approval");
  const rejectedApproval = signatures.find((signature) => signature.status === "rejected" && signature.purpose === "invoice_approval");
  const technicianSignature = signatures.find((signature) => signature.status === "active" && signature.purpose === "technician_acknowledgement");
  const rejectedTechnicianSignature = signatures.find((signature) => signature.status === "rejected" && signature.purpose === "technician_acknowledgement");
  const previewInvoice: Invoice = { ...invoice, selectedTier, optionLabel, notes };
  const totalByTier = { good: invoice.totalGood, better: invoice.totalBetter, best: invoice.totalBest };
  const selectedSaved = Boolean(invoice.selectedTier);
  const reviewDirty = selectedTier !== invoice.selectedTier
    || optionLabel !== invoice.optionLabel
    || notes.trim() !== invoice.notes;
  const readyToSign = selectedSaved && !reviewDirty;
  const generated = Boolean(invoice.pdfStoragePath && invoice.pdfGeneratedAt);

  async function saveReview() {
    if (!selectedTier) return;
    setReviewBusy(true);
    setMessage(undefined);
    setActionError(undefined);
    try {
      const next = demoMode
        ? { ...invoiceRecord, selectedTier, optionLabel, notes: notes.trim(), updatedAt: new Date().toISOString(), pdfStoragePath: undefined, pdfGeneratedAt: undefined, pdfSha256: undefined, pdfSizeBytes: undefined }
        : await saveProtectedInvoiceReview(invoiceRecord.id, { selectedTier, optionLabel, notes: notes.trim() });
      if (demoMode) data.updateInvoice(invoiceRecord.id, next);
      replaceInvoice(next);
      setMessage("Invoice review saved. It is ready for the customer signature.");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The invoice review could not be saved.");
    } finally {
      setReviewBusy(false);
    }
  }

  async function savePayment() {
    setPaymentBusy(true);
    setMessage(undefined);
    setActionError(undefined);
    try {
      const requestedAmount = Number(amountPaid);
      const next = demoMode
        ? demoPaymentInvoice(invoiceRecord, paymentStatus, requestedAmount)
        : await saveProtectedInvoicePayment(invoiceRecord.id, { paymentStatus, amountPaid: requestedAmount });
      if (demoMode) data.updateInvoice(invoiceRecord.id, next);
      replaceInvoice(next);
      setAmountPaid(String(next.amountPaid));
      setMessage("Payment status saved. Regenerate the PDF if one was already created.");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Payment status could not be saved.");
    } finally {
      setPaymentBusy(false);
    }
  }

  async function markSent() {
    setSendBusy(true);
    setMessage(undefined);
    setActionError(undefined);
    try {
      const now = new Date().toISOString();
      const next = demoMode
        ? { ...invoiceRecord, status: invoiceRecord.paymentStatus === "paid" ? "paid" as const : "sent" as const, sentToEmail: email.trim(), sentAt: now, updatedAt: now }
        : await markProtectedInvoiceSent(invoiceRecord.id, email);
      if (demoMode) data.updateInvoice(invoiceRecord.id, next);
      replaceInvoice(next);
      setMessage(`Invoice marked sent to ${email.trim()}.`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The invoice could not be marked sent.");
    } finally {
      setSendBusy(false);
    }
  }

  async function saveDrawnSignature(input: { signerName: string; signerRole: SignatureSignerRole; image: Blob; width: number; height: number }) {
    if (!dialog) return;
    const saved = await saveSignature({
      target: { type: "invoice", id: invoiceRecord.id },
      purpose: dialog.purpose,
      signerName: input.signerName,
      signerRole: input.signerRole,
      image: input.image,
      width: input.width,
      height: input.height,
      invoiceId: invoiceRecord.id,
      jobId: jobRecord.id,
      collectedBy: currentUser.id
    });
    setSignatures((current) => [saved, ...current.map((signature) => (
      signature.status === "active" && signature.purpose === saved.purpose
        ? { ...signature, status: "rejected" as const, rejectedAt: saved.signedAt, rejectionReason: "Replaced by a newly collected signature." }
        : signature
    ))]);
    const next: Invoice = {
      ...invoiceRecord,
      ...(saved.purpose === "invoice_approval"
        ? { approvalStatus: "signed" as const, approvedAt: saved.signedAt }
        : {}),
      pdfStoragePath: undefined,
      pdfGeneratedAt: undefined,
      pdfSha256: undefined,
      pdfSizeBytes: undefined,
      updatedAt: saved.signedAt
    };
    replaceInvoice(next);
    if (demoMode) data.updateInvoice(invoiceRecord.id, next);
    else await Promise.all([refreshInvoice(), refreshSignatures()]);
    setDialog(undefined);
    setMessage("Signature saved with its signer and audit timestamp. Generate a new PDF when signatures are final.");
  }

  async function rejectSavedSignature(signature: InvoiceSignature, reason: string) {
    const rejected = await rejectSignature({ type: "invoice", id: invoiceRecord.id }, signature.id, reason);
    setSignatures((current) => current.map((candidate) => candidate.id === rejected.id ? { ...candidate, ...rejected } : candidate));
    const rejectedAt = rejected.rejectedAt ?? new Date().toISOString();
    const next: Invoice = {
      ...invoiceRecord,
      ...(signature.purpose === "invoice_approval"
        ? { approvalStatus: "not_signed" as const, approvedAt: undefined }
        : {}),
      pdfStoragePath: undefined,
      pdfGeneratedAt: undefined,
      pdfSha256: undefined,
      pdfSizeBytes: undefined,
      updatedAt: rejectedAt
    };
    replaceInvoice(next);
    if (demoMode) data.updateInvoice(invoiceRecord.id, next);
    else await Promise.all([refreshInvoice(), refreshSignatures()]);
    setMessage("Signature rejected. A new signature is required.");
  }

  function openCustomerSignature() {
    setDialog({
      purpose: "invoice_approval",
      signerRole: "customer",
      title: "Customer invoice approval",
      description: "Ask the customer to review the approved work and total, then sign in the box.",
      defaultSignerName: customerRecord.name
    });
  }

  function openTechnicianSignature() {
    setDialog({
      purpose: "technician_acknowledgement",
      signerRole: "technician",
      title: "Technician acknowledgement",
      description: "Sign to record the technician or company acknowledgement for this invoice.",
      defaultSignerName: currentUser.displayName
    });
  }

  return (
    <main className="page-shell invoice-detail-page">
      <PageHeader
        eyebrow="Invoice"
        title={invoice.invoiceNumber}
        description={`${customer.name} · ${job.description}`}
        action={<Link href={`/jobs/${job.id}`} className="button button-secondary">Back to job</Link>}
      />

      <ol className="invoice-flow" aria-label="Invoice workflow">
        <FlowStep label="Review" complete={readyToSign} active={!readyToSign} />
        <FlowStep label="Sign & save" complete={Boolean(approval)} active={readyToSign && !approval} />
        <FlowStep label="Generate PDF" complete={generated} active={Boolean(approval) && !generated} />
        <FlowStep label="Send / download" complete={Boolean(invoice.sentAt)} active={generated && !invoice.sentAt} />
      </ol>

      {detailError ? <p className="inline-warning" role="status">Using the loaded draft. Refresh warning: {detailError}</p> : null}
      {message ? <p className="success-message" role="status">{message}</p> : null}
      {actionError ? <p className="field-error" role="alert">{actionError}</p> : null}

      <Card className="invoice-review-card">
        <div className="section-head">
          <div><p className="eyebrow">1 · Review</p><h2>Confirm the approved work</h2><p className="muted">Estimate tiers are shown only here for comparison. The invoice and PDF use one neutral service label.</p></div>
          <StatusPill tone={invoice.status === "paid" || invoice.status === "sent" ? "good" : "warn"}>{invoice.status}</StatusPill>
        </div>

        <section className="estimate-comparison" aria-label="Estimate comparison">
          {tierOptions.map((tier) => {
            const tierItems = items.filter((item) => item.tier === tier);
            return (
              <button
                key={tier}
                type="button"
                className={`estimate-choice ${selectedTier === tier ? "selected" : ""}`}
                onClick={() => setSelectedTier(tier)}
                disabled={!canEdit || Boolean(approval) || tierItems.length === 0}
              >
                <span>{tierLabels[tier]} estimate</span>
                <strong>{money(totalByTier[tier])}</strong>
                <small>{tierItems.length} item{tierItems.length === 1 ? "" : "s"}</small>
                {selectedTier === tier ? <Check size={17} aria-label="Selected" /> : null}
              </button>
            );
          })}
        </section>

        <TwoColumn>
          <Field label="Invoice service label">
            <select value={optionLabel} onChange={(event) => setOptionLabel(event.target.value as InvoiceOptionLabel)} disabled={!canEdit || Boolean(approval)}>
              {Object.entries(invoiceOptionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <div className="approved-total-readout">
            <span>Invoice total</span>
            <strong>{selectedTier ? money(totalByTier[selectedTier]) : "Select an estimate"}</strong>
          </div>
        </TwoColumn>
        <Field label="Work summary and invoice notes">
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} disabled={!canEdit || Boolean(approval)} placeholder="Summarize completed work, warranty details, or payment instructions." />
        </Field>
        <div className="invoice-review-actions">
          {approval ? <p className="muted">Reject the saved customer signature before changing signed invoice content.</p> : null}
          <Button onClick={() => void saveReview()} disabled={!canEdit || !selectedTier || reviewBusy || Boolean(approval)}>
            <FileCheck2 size={17} aria-hidden="true" /> {reviewBusy ? "Saving review..." : "Save review"}
          </Button>
        </div>
      </Card>

      <InvoicePreview invoice={previewInvoice} job={job} customer={customer} items={items} signatures={signatures} />

      <Card className="invoice-signatures-card">
        <div className="section-head">
          <div><p className="eyebrow">2 · Sign & save</p><h2>Invoice signatures</h2><p className="muted">Saving must finish successfully before this invoice is approved.</p></div>
          <PenLine size={24} aria-hidden="true" />
        </div>
        {reviewDirty ? <p className="inline-warning">Save the review before collecting a signature so the customer approves exactly what is shown.</p> : null}
        <div className="invoice-signature-grid">
          <SignatureStatusCard
            title="Customer approval"
            signature={approval}
            rejectedSignature={rejectedApproval}
            loading={signaturesLoading}
            error={signatureError}
            onRetry={() => void refreshSignatures()}
            onDraw={openCustomerSignature}
            drawLabel="Draw signature"
            drawDisabled={!readyToSign}
            canReject={canEdit}
            onReject={approval ? (reason) => rejectSavedSignature(approval, reason) : undefined}
          />
          <SignatureStatusCard
            title="Technician / company"
            signature={technicianSignature}
            rejectedSignature={rejectedTechnicianSignature}
            loading={signaturesLoading}
            error={signatureError}
            onRetry={() => void refreshSignatures()}
            onDraw={openTechnicianSignature}
            drawLabel="Add technician signature"
            drawDisabled={!readyToSign}
            canReject={canEdit}
            onReject={technicianSignature ? (reason) => rejectSavedSignature(technicianSignature, reason) : undefined}
          />
        </div>
      </Card>

      <Card className="invoice-payment-card">
        <div className="section-head"><div><p className="eyebrow">Payment</p><h2>Payment status</h2></div><StatusPill tone={invoice.paymentStatus === "paid" ? "good" : "info"}>{invoice.paymentStatus.replace("_", " ")}</StatusPill></div>
        <TwoColumn>
          <Field label="Payment status">
            <select value={paymentStatus} onChange={(event) => setPaymentStatus(event.target.value as InvoicePaymentStatus)} disabled={!canEdit}>
              <option value="unpaid">Unpaid</option>
              <option value="partially_paid">Partially paid</option>
              <option value="paid">Paid</option>
              <option value="refunded">Refunded</option>
              <option value="void">Void</option>
            </select>
          </Field>
          <Field label="Amount paid">
            <input type="number" min="0" step="0.01" value={paymentStatus === "paid" && selectedTier ? totalByTier[selectedTier] : amountPaid} onChange={(event) => setAmountPaid(event.target.value)} disabled={!canEdit || paymentStatus !== "partially_paid"} />
          </Field>
        </TwoColumn>
        {canEdit ? <Button variant="secondary" onClick={() => void savePayment()} disabled={paymentBusy || !selectedSaved}>{paymentBusy ? "Saving payment..." : "Save payment status"}</Button> : <p className="muted">Only an owner can change payment status.</p>}
      </Card>

      <InvoicePdfViewer
        invoice={invoice}
        job={job}
        customer={customer}
        items={items}
        signatures={signatures}
        canGenerate={Boolean(approval && selectedSaved)}
        onGenerated={async () => {
          if (demoMode) {
            const now = new Date().toISOString();
            const next = { ...invoice, pdfStoragePath: `demo/${invoice.id}.pdf`, pdfVersion: invoice.pdfVersion + 1, pdfGeneratedAt: now, updatedAt: now };
            data.updateInvoice(invoice.id, next);
            replaceInvoice(next);
          } else {
            await refreshInvoice();
          }
          setMessage("Signed PDF generated and saved.");
        }}
      />

      <Card className="invoice-send-card">
        <div className="section-head"><div><p className="eyebrow">4 · Send or download</p><h2>Finish the invoice</h2><p className="muted">Download is available beside the PDF preview. Owners can record the customer delivery below.</p></div><Mail size={23} aria-hidden="true" /></div>
        <div className="invoice-send-grid">
          <Field label="Customer email"><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} disabled={!canEdit} /></Field>
          <div className="invoice-send-actions">
            <Button onClick={() => void markSent()} disabled={!canEdit || !generated || !approval || sendBusy}>{sendBusy ? "Saving delivery..." : "Mark sent"}</Button>
          </div>
        </div>
      </Card>

      <SignatureDialog
        open={Boolean(dialog)}
        title={dialog?.title ?? "Signature"}
        description={dialog?.description ?? "Review and sign."}
        signerRole={dialog?.signerRole ?? "customer"}
        defaultSignerName={dialog?.defaultSignerName}
        onCancel={() => setDialog(undefined)}
        onSave={saveDrawnSignature}
      />
    </main>
  );
}

function FlowStep({ label, complete, active }: { label: string; complete: boolean; active: boolean }) {
  return <li className={complete ? "complete" : active ? "active" : ""}><span>{complete ? <Check size={14} aria-hidden="true" /> : null}</span>{label}</li>;
}

function demoPaymentInvoice(invoice: Invoice, status: InvoicePaymentStatus, requestedAmount: number): Invoice {
  if (!invoice.selectedTier) throw new Error("Select approved work before recording payment.");
  const total = invoice.selectedTier === "good" ? invoice.totalGood : invoice.selectedTier === "best" ? invoice.totalBest : invoice.totalBetter;
  let amountPaid = 0;
  if (status === "paid") amountPaid = total;
  if (status === "partially_paid") {
    amountPaid = Math.round((requestedAmount + Number.EPSILON) * 100) / 100;
    if (!Number.isFinite(amountPaid) || amountPaid <= 0 || amountPaid >= total) throw new Error("Enter a partial payment below the invoice total.");
  }
  const now = new Date().toISOString();
  return {
    ...invoice,
    paymentStatus: status,
    amountPaid,
    status: status === "paid" ? "paid" : invoice.sentAt ? "sent" : "draft",
    pdfStoragePath: undefined,
    pdfGeneratedAt: undefined,
    pdfSha256: undefined,
    pdfSizeBytes: undefined,
    updatedAt: now
  };
}
