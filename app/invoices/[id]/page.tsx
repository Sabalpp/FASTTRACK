"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  FileCheck2,
  FileText,
  LoaderCircle,
  Mail,
  PenLine,
  RotateCw,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { InvoicePreview } from "@/components/InvoicePreview";
import { SignatureDialog } from "@/components/SignatureDialog";
import { SignatureStatusCard } from "@/components/SignatureStatusCard";
import { Button, Card, EmptyState } from "@/components/ui";
import { canSendInvoices, canViewInvoice } from "@/lib/access";
import { useAuth } from "@/lib/auth";
import { tierLabels, useAppData } from "@/lib/data-store";
import { formatDateTime } from "@/lib/date";
import { balanceDue, firstPopulatedTier, invoiceOptionLabels, selectedTotal } from "@/lib/invoice";
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
import {
  invoiceReadinessBlockers,
  invoiceWorkspaceStatus,
  preferredInvoiceDeliveryEmail,
  resolveInvoiceWorkspaceAction,
  type InvoiceWorkspaceActionId
} from "./InvoiceWorkspaceParts";
import type { InvoiceWorkspacePdfProps } from "./InvoiceWorkspacePdf";
import styles from "./InvoiceWorkspace.module.css";

const InvoiceWorkspacePdf = dynamic<InvoiceWorkspacePdfProps>(
  () => import("./InvoiceWorkspacePdf").then((module) => module.InvoiceWorkspacePdf),
  {
    ssr: false,
    loading: () => <div className={styles.pdfLoading}>Opening the protected PDF workspace…</div>
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
  const [documentView, setDocumentView] = useState<"invoice" | "pdf">("invoice");
  const [paymentEditorOpen, setPaymentEditorOpen] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfGenerationRequest, setPdfGenerationRequest] = useState(0);

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
    setEmail(preferredInvoiceDeliveryEmail(invoice.sentToEmail, customer?.email));
    setPaymentEditorOpen(false);
  }, [customer?.email, invoice?.id, invoice?.updatedAt]);

  async function refreshSignatures() {
    if (!job?.id || !invoiceId) return;
    setSignaturesLoading(true);
    setSignatureError(undefined);
    try {
      const [jobSignatures, invoiceSignatures] = await Promise.all([
        loadSignatures({ type: "job", id: job.id }),
        loadSignatures({ type: "invoice", id: invoiceId })
      ]);
      setSignatures(Array.from(
        new Map([...jobSignatures, ...invoiceSignatures].map((signature) => [signature.id, signature])).values()
      ));
    } catch (error) {
      setSignatureError(error instanceof Error ? error.message : "Signatures could not be loaded.");
    } finally {
      setSignaturesLoading(false);
    }
  }

  useEffect(() => {
    if (!job?.id) return;
    void refreshSignatures();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id]);

  const workAuthorization = signatures.find((signature) => signature.status === "active" && signature.purpose === "work_authorization");
  const rejectedWorkAuthorization = signatures.find((signature) => signature.status === "rejected" && signature.purpose === "work_authorization");
  const workCompletion = signatures.find((signature) => signature.status === "active" && signature.purpose === "work_completion");
  const rejectedWorkCompletion = signatures.find((signature) => signature.status === "rejected" && signature.purpose === "work_completion");
  const invoiceApproval = signatures.find((signature) => signature.status === "active" && signature.purpose === "invoice_approval");
  const rejectedInvoiceApproval = signatures.find((signature) => signature.status === "rejected" && signature.purpose === "invoice_approval");
  const technicianSignature = signatures.find((signature) => signature.status === "active" && signature.purpose === "technician_acknowledgement");
  const rejectedTechnicianSignature = signatures.find((signature) => signature.status === "rejected" && signature.purpose === "technician_acknowledgement");

  useEffect(() => {
    if (workAuthorization?.selectedTier) setSelectedTier(workAuthorization.selectedTier);
  }, [workAuthorization?.id, workAuthorization?.selectedTier]);

  if (!data.loaded || (detailLoading && !invoice)) {
    return (
      <main className={`page-shell ${styles.page}`}>
        <Card className={styles.loadingCard}>
          <LoaderCircle className="spin" size={28} aria-hidden="true" />
          <div><h2>Loading invoice draft</h2><p className="muted">Restoring the customer, job, charges, and saved signatures.</p></div>
        </Card>
      </main>
    );
  }

  if (!invoice) {
    return (
      <main className={`page-shell ${styles.page}`}>
        <EmptyState
          title="Invoice draft did not load"
          description={detailError ?? "The invoice may have moved or the connection may be slow."}
          action={<Button onClick={() => void refreshInvoice(true)}><RotateCw size={16} aria-hidden="true" /> Retry invoice</Button>}
        />
      </main>
    );
  }

  if (!canViewInvoice(currentUser, invoice, data.jobs)) {
    return <main className={`page-shell ${styles.page}`}><EmptyState title="Invoice not available" description="This invoice is outside this role's access." /></main>;
  }
  if (!job || !customer) {
    return <main className={`page-shell ${styles.page}`}><EmptyState title="Invoice data is incomplete" description="The related job or customer could not be found." /></main>;
  }

  const invoiceRecord = invoice;
  const jobRecord = job;
  const canEdit = canSendInvoices(currentUser.role);
  const previewInvoice: Invoice = { ...invoice, selectedTier, optionLabel, notes };
  const totalByTier = {
    standard: invoice.totalStandard ?? 0,
    good: invoice.totalGood,
    better: invoice.totalBetter,
    best: invoice.totalBest
  };
  const authorizedTier = workAuthorization?.selectedTier;
  const completionOverridden = Boolean(job.completionSignatureOverrideAt && job.completionSignatureOverrideBy && job.completionSignatureOverrideReason?.trim());
  const fieldSignaturesReady = Boolean(workAuthorization && (workCompletion || completionOverridden));
  const tierConflict = Boolean(authorizedTier && invoice.selectedTier !== authorizedTier);
  const selectedSaved = Boolean(invoice.selectedTier && (!authorizedTier || invoice.selectedTier === authorizedTier));
  const reviewDirty = optionLabel !== invoice.optionLabel
    || notes.trim() !== invoice.notes;
  const readyToFinalize = selectedSaved && fieldSignaturesReady && !reviewDirty && !tierConflict;
  const generated = Boolean(invoice.pdfStoragePath && invoice.pdfGeneratedAt);
  const displayTotal = selectedTier ? totalByTier[selectedTier] : 0;
  const displayBalance = selectedTier ? balanceDue(previewInvoice) : 0;
  const deliveryRecorded = Boolean(invoice.sentAt);
  const primaryAction = resolveInvoiceWorkspaceAction({
    canManageInvoice: canEdit,
    selectedSaved,
    reviewDirty,
    fieldSignaturesReady,
    pdfGenerated: generated,
    deliveryRecorded,
    paymentStatus: invoice.paymentStatus,
    paymentEditorOpen
  });
  const readinessBlockers = invoiceReadinessBlockers({
    hasWorkAuthorization: Boolean(workAuthorization),
    tierConflict,
    hasCompletionRecord: Boolean(workCompletion || completionOverridden),
    reviewDirty
  });
  const workspaceStatus = invoiceWorkspaceStatus(invoice);

  async function saveReview() {
    const reviewTier = authorizedTier ?? selectedTier ?? firstPopulatedTier(invoiceRecord);
    if (!reviewTier) {
      setActionError("Add at least one invoice item before saving this draft.");
      return;
    }
    setReviewBusy(true);
    setMessage(undefined);
    setActionError(undefined);
    try {
      if (authorizedTier && invoiceRecord.selectedTier !== authorizedTier) {
        throw new Error("The invoice scope does not match the customer's authorized work. Refresh the invoice draft.");
      }
      const next = demoMode
        ? { ...invoiceRecord, selectedTier: reviewTier, optionLabel, notes: notes.trim(), updatedAt: new Date().toISOString(), pdfStoragePath: undefined, pdfGeneratedAt: undefined, pdfSha256: undefined, pdfSizeBytes: undefined }
        : await saveProtectedInvoiceReview(invoiceRecord.id, { selectedTier: reviewTier, optionLabel, notes: notes.trim() });
      if (demoMode) data.updateInvoice(invoiceRecord.id, next);
      replaceInvoice(next);
      setMessage("Invoice details saved. Missing signatures remain clearly marked and can still be collected.");
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
      setPaymentEditorOpen(false);
      setMessage("Payment record saved. This did not charge the customer. Generate an updated PDF for the final record.");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Payment status could not be saved.");
    } finally {
      setPaymentBusy(false);
    }
  }

  async function sendInvoicePdf() {
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
      setMessage(demoMode
        ? `Demo mode: invoice email simulated for ${email.trim()}. No external email was sent.`
        : `Invoice email accepted by the delivery provider for ${email.trim()}.`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The invoice PDF could not be emailed. It remains unsent.");
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
    setMessage(saved.purpose === "invoice_approval"
      ? "Current invoice approval saved with its signer and timestamp. Missing historical field records remain clearly marked on the draft."
      : "Signature saved with its signer and audit timestamp. Generate a new PDF when signatures are final.");
  }

  async function rejectSavedSignature(signature: InvoiceSignature, reason: string) {
    const rejected = await rejectSignature({ type: "invoice", id: invoiceRecord.id }, signature.id, reason);
    setSignatures((current) => current.map((candidate) => candidate.id === rejected.id ? { ...candidate, ...rejected } : candidate));
    const rejectedAt = rejected.rejectedAt ?? new Date().toISOString();
    const next: Invoice = {
      ...invoiceRecord,
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

  function openTechnicianSignature() {
    setDialog({
      purpose: "technician_acknowledgement",
      signerRole: "technician",
      title: "Technician acknowledgement",
      description: "Sign to record the technician or company acknowledgement for this invoice.",
      defaultSignerName: currentUser.displayName
    });
  }

  async function openCurrentInvoiceApproval() {
    const approvalTier = invoiceRecord.selectedTier ?? selectedTier ?? firstPopulatedTier(invoiceRecord);
    if (!approvalTier) {
      setActionError("Add at least one invoice item before collecting approval.");
      return;
    }
    if (!invoiceRecord.selectedTier) {
      setReviewBusy(true);
      setActionError(undefined);
      try {
        const next = demoMode
          ? { ...invoiceRecord, selectedTier: approvalTier, updatedAt: new Date().toISOString() }
          : await saveProtectedInvoiceReview(invoiceRecord.id, { selectedTier: approvalTier, optionLabel, notes: notes.trim() });
        if (demoMode) data.updateInvoice(invoiceRecord.id, next);
        replaceInvoice(next);
      } catch (error) {
        setActionError(error instanceof Error ? error.message : "The invoice scope could not be prepared for approval.");
        return;
      } finally {
        setReviewBusy(false);
      }
    }
    setDialog({
      purpose: "invoice_approval",
      signerRole: "customer",
      title: "Approve current invoice",
      description: "This records the customer's approval of the invoice shown now. It does not claim that authorization was collected before completed work.",
      defaultSignerName: customer?.name ?? "Customer"
    });
  }

  function openPaymentEditor() {
    setActionError(undefined);
    setMessage(undefined);
    if (invoiceRecord.paymentStatus === "unpaid") {
      setPaymentStatus("paid");
      setAmountPaid(String(displayTotal));
    }
    setPaymentEditorOpen(true);
  }

  async function runPrimaryAction() {
    switch (primaryAction.id) {
      case "save_review":
        await saveReview();
        return;
      case "generate_pdf":
        setDocumentView("pdf");
        setPdfGenerationRequest((current) => current + 1);
        return;
      case "preview_draft_pdf":
        setDocumentView("pdf");
        setPdfGenerationRequest((current) => current + 1);
        return;
      case "record_sent":
        await sendInvoicePdf();
        return;
      case "open_payment":
        openPaymentEditor();
        return;
      case "save_payment":
        await savePayment();
        return;
      case "view_pdf":
        setDocumentView("pdf");
        return;
      case "return_to_job":
        return;
    }
  }

  const customerEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const primaryBusy = reviewBusy || paymentBusy || sendBusy || pdfBusy;
  const primaryDisabled = primaryBusy
    || (primaryAction.id === "save_review" && (!canEdit || !selectedTier || tierConflict))
    || (primaryAction.id === "generate_pdf" && !readyToFinalize)
    || (primaryAction.id === "record_sent" && (!canEdit || !customerEmailValid))
    || (primaryAction.id === "save_payment" && (!canEdit || !selectedSaved));
  const primaryLabel = primaryBusy
    ? reviewBusy ? "Saving invoice details..."
      : paymentBusy ? "Saving payment record..."
        : sendBusy ? "Sending invoice PDF..."
          : primaryAction.id === "preview_draft_pdf" ? "Creating draft PDF..." : "Generating signed PDF..."
    : primaryAction.label;

  return (
    <main className={`page-shell ${styles.page}`}>
      <header className={styles.header}>
        <Link className={styles.breadcrumb} href={`/jobs/${job.id}`}>
          <ArrowLeft size={17} aria-hidden="true" />
          Back to job
        </Link>
        <div className={styles.headerMain}>
          <div className={styles.headerTitle}>
            <h1>{invoice.invoiceNumber}</h1>
            <p>{customer.name} · {job.description}</p>
          </div>
          <div className={styles.headerStatus} aria-label="Invoice status">
            <span className={styles.statusPill} data-tone={workspaceStatus.tone}>
              {workspaceStatus.label}
            </span>
          </div>
        </div>
      </header>

      <div aria-live="polite">
        {detailError ? <p className={styles.warningNote}>Using the loaded draft. Refresh warning: {detailError}</p> : null}
        {message ? <p className={styles.successNote}>{message}</p> : null}
        {actionError ? <p className={styles.errorNote} role="alert">{actionError}</p> : null}
      </div>

      {!fieldSignaturesReady ? (
        <section className={styles.signatureNotice} aria-label="Invoice signature status">
          <div>
            <strong>{workAuthorization ? "Completion signature not saved" : "Customer authorization not signed"}</strong>
            <span>
              {job.status === "complete"
                ? invoiceApproval
                  ? `The historic before-work authorization is not in this record. ${invoiceApproval.signerName} approved the current invoice on ${formatDateTime(invoiceApproval.signedAt)}. It remains a clearly marked draft until the historical field records are resolved.`
                  : "The bill and draft PDF are still available. Because this job is already complete, collect approval of the current invoice without pretending it was signed before work."
                : workAuthorization
                  ? "The bill stays visible. Collect the completion acknowledgment before final sending."
                  : "The bill stays visible. Open the signature pad now or continue reviewing the unsigned draft."}
            </span>
          </div>
          {job.status === "complete" ? (
            invoiceApproval ? <span className={styles.signatureNoticeState}><CheckCircle2 size={17} aria-hidden="true" />Current approval saved · draft only</span> : (
              <button type="button" onClick={() => void openCurrentInvoiceApproval()} disabled={reviewBusy}><PenLine size={17} aria-hidden="true" />{reviewBusy ? "Preparing…" : "Sign current invoice"}</button>
            )
          ) : (
            <Link href={`/jobs/${job.id}?stage=${workAuthorization ? "completion" : "approval"}${workAuthorization ? "" : "&sign=work_authorization"}`}>
              <PenLine size={17} aria-hidden="true" />{workAuthorization ? "Open completion signature" : "Sign authorization now"}
            </Link>
          )}
        </section>
      ) : null}

      <div className={styles.workspace}>
        <section className={styles.documentColumn} aria-label="Invoice document workspace">
          <div className={styles.documentToolbar}>
            <div className={styles.documentToolbarTitle}>
              <strong>Customer document</strong>
            </div>
            <div className={styles.documentTabs} role="tablist" aria-label="Document views">
              <button
                className={styles.documentTab}
                type="button"
                role="tab"
                id="invoice-preview-tab"
                aria-controls="invoice-preview-panel"
                aria-selected={documentView === "invoice"}
                data-active={documentView === "invoice"}
                onClick={() => setDocumentView("invoice")}
              >
                <FileText size={16} aria-hidden="true" />
                Invoice
              </button>
              <button
                className={styles.documentTab}
                type="button"
                role="tab"
                id="invoice-pdf-tab"
                aria-controls="invoice-pdf-panel"
                aria-selected={documentView === "pdf"}
                data-active={documentView === "pdf"}
                onClick={() => setDocumentView("pdf")}
              >
                <FileCheck2 size={16} aria-hidden="true" />
                PDF
              </button>
            </div>
          </div>

          <div className={styles.documentStage}>
            <div
              id="invoice-preview-panel"
              className={`${styles.documentPane} ${styles.previewPane}`}
              role="tabpanel"
              aria-labelledby="invoice-preview-tab"
              hidden={documentView !== "invoice"}
            >
              <InvoicePreview invoice={previewInvoice} job={job} customer={customer} items={items} signatures={signatures} />
            </div>
            {documentView === "pdf" ? (
              <div
                id="invoice-pdf-panel"
                className={styles.documentPane}
                role="tabpanel"
                aria-labelledby="invoice-pdf-tab"
              >
                <InvoiceWorkspacePdf
                  invoice={invoice}
                  job={job}
                  customer={customer}
                  items={items}
                  signatures={signatures}
                  canGenerate={readyToFinalize}
                  generationRequest={pdfGenerationRequest}
                  onBusyChange={setPdfBusy}
                  onGenerated={async () => {
                    if (demoMode) {
                      const now = new Date().toISOString();
                      const next = {
                        ...invoice,
                        pdfStoragePath: `demo/${invoice.id}.pdf`,
                        pdfVersion: invoice.pdfVersion + 1,
                        pdfGeneratedAt: now,
                        updatedAt: now
                      };
                      data.updateInvoice(invoice.id, next);
                      replaceInvoice(next);
                    } else {
                      await refreshInvoice();
                    }
                    setMessage("Signed PDF created and saved. It has not been emailed yet.");
                  }}
                />
              </div>
            ) : null}
          </div>
        </section>

        <aside className={styles.actionRail} aria-label="Invoice actions and status">
          <div className={styles.actionRailInner}>
            <section className={styles.railCard} aria-label="Invoice totals and blockers">
              <div className={styles.moneySummary}>
                <div className={styles.moneyMetric}>
                  <span>Invoice total</span>
                  <strong>{selectedTier ? money(displayTotal) : "—"}</strong>
                </div>
                <div className={styles.moneyMetric} data-emphasis="true">
                  <span>Balance due</span>
                  <strong>{selectedTier ? money(displayBalance) : "—"}</strong>
                </div>
              </div>
              {readinessBlockers.length ? (
                <div className={styles.blockerPanel} role="status">
                  <strong>{readinessBlockers.length === 1 ? "1 item needs attention" : `${readinessBlockers.length} items need attention`}</strong>
                  <ul>{readinessBlockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
                </div>
              ) : (
                <div className={styles.quietState}>
                  <CheckCircle2 size={17} aria-hidden="true" />
                  Required field records are complete.
                </div>
              )}
            </section>

            <section className={styles.contextCard} aria-labelledby="next-invoice-action">
              <div className={styles.contextHeader}>
                <span className={styles.contextIcon} aria-hidden="true"><PrimaryActionIcon action={primaryAction.id} /></span>
                <div>
                  <h2 id="next-invoice-action">{primaryAction.title}</h2>
                  <p>{primaryAction.helper}</p>
                </div>
              </div>

              {primaryAction.id === "record_sent" ? (
                <div className={styles.deliveryEditor}>
                  <label className={styles.field}>
                    <span>Email invoice to</span>
                    <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" disabled={!canEdit} />
                  </label>
                  <p className={styles.truthNote}>The signed PDF will be attached. The invoice stays unsent unless the email provider accepts it.</p>
                  {email.trim() && !customerEmailValid ? <p className={styles.errorNote}>Enter a valid customer email before sending.</p> : null}
                  <button className={styles.textButton} type="button" onClick={openPaymentEditor} disabled={!canEdit}>
                    Payment already received? Record it without emailing first
                  </button>
                </div>
              ) : null}

              {paymentEditorOpen ? (
                <div className={styles.paymentEditor}>
                  <label className={styles.field}>
                    <span>Payment status</span>
                    <select value={paymentStatus} onChange={(event) => setPaymentStatus(event.target.value as InvoicePaymentStatus)} disabled={!canEdit}>
                      <option value="unpaid">Unpaid</option>
                      <option value="partially_paid">Partially paid</option>
                      <option value="paid">Paid</option>
                      <option value="refunded">Refunded</option>
                      <option value="void">Void</option>
                    </select>
                  </label>
                  <label className={styles.field}>
                    <span>Amount paid</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={paymentStatus === "paid" && selectedTier ? displayTotal : amountPaid}
                      onChange={(event) => setAmountPaid(event.target.value)}
                      disabled={!canEdit || paymentStatus !== "partially_paid"}
                    />
                  </label>
                  <p className={styles.truthNote}>This records payment received elsewhere. No card or bank account is charged.</p>
                  <div className={styles.inlineUtilityRow}>
                    <button className={styles.textButton} type="button" onClick={() => setPaymentEditorOpen(false)} disabled={paymentBusy}>Cancel payment edit</button>
                  </div>
                </div>
              ) : null}

              <div className={styles.primaryDock}>
                {primaryAction.id === "return_to_job" ? (
                  <Link className={styles.primaryButton} href={`/jobs/${job.id}`}>
                    <ArrowLeft size={18} aria-hidden="true" />
                    {primaryAction.label}
                  </Link>
                ) : (
                  <button className={styles.primaryButton} type="button" onClick={() => void runPrimaryAction()} disabled={primaryDisabled}>
                    <PrimaryActionIcon action={primaryAction.id} />
                    {primaryLabel}
                  </button>
                )}
                {primaryAction.id === "record_sent" && !customerEmailValid ? (
                  <span className={styles.primaryHint}>A valid customer email is required to send the PDF.</span>
                ) : null}
              </div>
            </section>

            <div className={styles.utilityStack}>
              <details className={styles.utilityDetails} open={(!selectedSaved || reviewDirty) || undefined}>
                <summary className={styles.utilitySummary}>
                  <FileText size={18} aria-hidden="true" />
                  Invoice notes
                  <ChevronDown size={17} aria-hidden="true" />
                </summary>
                <div className={styles.utilityContent}>
                  {tierConflict ? <p className={styles.errorNote}>This draft does not match the signed field authorization. Refresh the invoice before continuing.</p> : null}
                  <label className={styles.field}>
                    <span>Invoice service label</span>
                    <select value={optionLabel} onChange={(event) => setOptionLabel(event.target.value as InvoiceOptionLabel)} disabled={!canEdit}>
                      {Object.entries(invoiceOptionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </label>
                  <label className={styles.field}>
                    <span>Work summary and invoice notes</span>
                    <textarea
                      value={notes}
                      onChange={(event) => setNotes(event.target.value)}
                      disabled={!canEdit}
                      placeholder="Summarize completed work, warranty details, or payment instructions."
                    />
                  </label>
                  {reviewDirty ? <p className={styles.warningNote}>Save the label and notes before generating the final PDF.</p> : null}
                </div>
              </details>

              <details className={styles.utilityDetails}>
                <summary className={styles.utilitySummary}>
                  <PenLine size={18} aria-hidden="true" />
                  Field signatures
                  <ChevronDown size={17} aria-hidden="true" />
                </summary>
                <div className={styles.utilityContent}>
                  <div className="invoice-signature-grid">
                    <FieldSignatureCard
                      title="Authorization of repair"
                      signature={workAuthorization}
                      rejectedSignature={rejectedWorkAuthorization}
                      loading={signaturesLoading}
                      error={signatureError}
                      detail={authorizedTier ? `${tierLabels[authorizedTier]} scope authorized before work began.` : "Return to the job to collect authorization."}
                    />
                    <FieldSignatureCard
                      title="Completion of work"
                      signature={workCompletion}
                      rejectedSignature={rejectedWorkCompletion}
                      loading={signaturesLoading}
                      error={signatureError}
                      override={completionOverridden ? {
                        at: job.completionSignatureOverrideAt!,
                        reason: job.completionSignatureOverrideReason!
                      } : undefined}
                      detail="Customer acknowledgment collected after the repair and after photo."
                    />
                    {job.status === "complete" || invoiceApproval ? (
                      <SignatureStatusCard
                        title="Current invoice approval (legacy record)"
                        signature={invoiceApproval}
                        rejectedSignature={rejectedInvoiceApproval}
                        loading={signaturesLoading}
                        error={signatureError}
                        onRetry={() => void refreshSignatures()}
                        onDraw={() => void openCurrentInvoiceApproval()}
                        drawLabel="Sign current invoice"
                        drawDisabled={!selectedTier || reviewBusy}
                        canReject={canEdit}
                        onReject={invoiceApproval ? (reason) => rejectSavedSignature(invoiceApproval, reason) : undefined}
                      />
                    ) : null}
                    <SignatureStatusCard
                      title="Technician / company (optional)"
                      signature={technicianSignature}
                      rejectedSignature={rejectedTechnicianSignature}
                      loading={signaturesLoading}
                      error={signatureError}
                      onRetry={() => void refreshSignatures()}
                      onDraw={openTechnicianSignature}
                      drawLabel="Add technician signature"
                      drawDisabled={!readyToFinalize}
                      canReject={canEdit}
                      onReject={technicianSignature ? (reason) => rejectSavedSignature(technicianSignature, reason) : undefined}
                    />
                  </div>
                </div>
              </details>

              <details className={styles.utilityDetails}>
                <summary className={styles.utilitySummary}>
                  <CircleDollarSign size={18} aria-hidden="true" />
                  Delivery and payment record
                  <ChevronDown size={17} aria-hidden="true" />
                </summary>
                <div className={styles.utilityContent}>
                  <div className={styles.identitySummary}>
                    <div className={styles.identityRow}>
                      <Mail size={18} aria-hidden="true" />
                      <div>
                        <strong>{invoice.sentAt ? `Email accepted for ${invoice.sentToEmail}` : "Invoice email not sent"}</strong>
                        <span>{invoice.sentAt ? formatDateTime(invoice.sentAt) : "Generate the signed PDF, then send it from the main action."}</span>
                      </div>
                    </div>
                    <div className={styles.identityRow}>
                      <CircleDollarSign size={18} aria-hidden="true" />
                      <div><strong>{humanizeState(invoice.paymentStatus)}</strong><span>{money(invoice.amountPaid)} recorded as paid</span></div>
                    </div>
                    <div className={styles.identityRow}>
                      <FileCheck2 size={18} aria-hidden="true" />
                      <div><strong>{generated ? `PDF version ${invoice.pdfVersion}` : "Final PDF not generated"}</strong><span>{invoice.pdfGeneratedAt ? formatDateTime(invoice.pdfGeneratedAt) : "Generate after both field checkpoints and any payment changes."}</span></div>
                    </div>
                  </div>

                  {canEdit && invoice.sentAt ? (
                    <>
                      <label className={styles.field}>
                        <span>Send invoice again to</span>
                        <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
                      </label>
                      <p className={styles.truthNote}>This sends the same signed PDF. The audit record updates only after provider acceptance.</p>
                      <button className={styles.secondaryButton} type="button" onClick={() => void sendInvoicePdf()} disabled={!generated || !fieldSignaturesReady || !customerEmailValid || sendBusy}>
                        <Mail size={17} aria-hidden="true" />
                        {sendBusy ? "Sending invoice..." : "Email invoice PDF"}
                      </button>
                    </>
                  ) : null}

                  {canEdit && invoice.sentAt ? (
                    <button className={styles.secondaryButton} type="button" onClick={openPaymentEditor} disabled={paymentBusy}>
                      <CircleDollarSign size={17} aria-hidden="true" />
                      Edit payment record
                    </button>
                  ) : null}
                </div>
              </details>
            </div>
          </div>
        </aside>
      </div>

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

function FieldSignatureCard({
  title,
  signature,
  rejectedSignature,
  loading,
  error,
  override,
  detail
}: {
  title: string;
  signature?: InvoiceSignature;
  rejectedSignature?: InvoiceSignature;
  loading: boolean;
  error?: string;
  override?: { at: string; reason: string };
  detail: string;
}) {
  const complete = Boolean(signature || override);
  return (
    <section className={styles.fieldSignatureCard} data-complete={complete}>
      <div className={styles.fieldSignatureHeading}>
        <span aria-hidden="true">{complete ? <CheckCircle2 size={20} /> : <Clock3 size={20} />}</span>
        <div>
          <p>{title}</p>
          <strong>{loading ? "Loading..." : signature ? "Customer signed" : override ? "Audited owner override" : "Required"}</strong>
        </div>
      </div>
      {signature?.imageUrl ? <img src={signature.imageUrl} alt={`Signature from ${signature.signerName}`} /> : null}
      <p className={styles.fieldSignatureDetail}>{detail}</p>
      {signature ? (
        <span className={styles.fieldSignatureMeta}>{signature.signerName} · {formatDateTime(signature.signedAt)}</span>
      ) : override ? (
        <span className={styles.fieldSignatureMeta}>{formatDateTime(override.at)} · {override.reason}</span>
      ) : (
        <span className={styles.fieldSignatureMeta}>{error ?? rejectedSignature?.rejectionReason ?? "Finish this checkpoint from the job."}</span>
      )}
    </section>
  );
}

function PrimaryActionIcon({ action }: { action: InvoiceWorkspaceActionId }) {
  if (action === "save_review") return <FileCheck2 size={18} aria-hidden="true" />;
  if (action === "preview_draft_pdf" || action === "generate_pdf" || action === "view_pdf") return <FileText size={18} aria-hidden="true" />;
  if (action === "record_sent") return <Mail size={18} aria-hidden="true" />;
  if (action === "open_payment" || action === "save_payment") return <CircleDollarSign size={18} aria-hidden="true" />;
  if (action === "return_to_job") return <ArrowLeft size={18} aria-hidden="true" />;
  return <CheckCircle2 size={18} aria-hidden="true" />;
}

function humanizeState(value: string) {
  return value.replaceAll("_", " ");
}

function demoPaymentInvoice(invoice: Invoice, status: InvoicePaymentStatus, requestedAmount: number): Invoice {
  if (!invoice.selectedTier) throw new Error("Select approved work before recording payment.");
  const total = selectedTotal(invoice);
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
