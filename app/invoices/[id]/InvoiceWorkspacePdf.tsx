"use client";

import { pdf } from "@react-pdf/renderer";
import { Download, ExternalLink, FileCheck2, FileText, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { InvoicePdfDocument, invoicePdfDocumentState } from "@/components/InvoicePdfDocument";
import { generateProtectedInvoicePdf, loadProtectedInvoicePdf } from "@/lib/invoices-client";
import { demoMode } from "@/lib/runtime";
import type { Customer, Invoice, InvoiceSignature, Job, JobLineItem } from "@/lib/types";
import styles from "./InvoiceWorkspace.module.css";

export type InvoiceWorkspacePdfProps = {
  invoice: Invoice;
  job: Job;
  customer: Customer;
  items: JobLineItem[];
  signatures: InvoiceSignature[];
  canGenerate: boolean;
  generationRequest?: number;
  onGenerated?: () => void | Promise<void>;
  onBusyChange?: (busy: boolean) => void;
};

export function InvoiceWorkspacePdf({
  invoice,
  job,
  customer,
  items,
  signatures,
  canGenerate,
  generationRequest = 0,
  onGenerated,
  onBusyChange
}: InvoiceWorkspacePdfProps) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loadingSaved, setLoadingSaved] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const activeObjectUrl = useRef<string | null>(null);
  const pdfRequestVersion = useRef(0);
  const handledGenerationRequest = useRef(0);
  const documentState = invoicePdfDocumentState(invoice, job, signatures, !canGenerate);
  const finalEligible = canGenerate && !documentState.isDraft;
  const draftPreview = !finalEligible;

  const clearPdf = useCallback(() => {
    pdfRequestVersion.current += 1;
    if (activeObjectUrl.current) URL.revokeObjectURL(activeObjectUrl.current);
    activeObjectUrl.current = null;
    setPdfUrl(null);
    setLoadingSaved(false);
    setGenerating(false);
  }, []);

  const showBlob = useCallback((blob: Blob, requestVersion: number) => {
    if (requestVersion !== pdfRequestVersion.current) return false;
    if (activeObjectUrl.current) URL.revokeObjectURL(activeObjectUrl.current);
    const nextUrl = URL.createObjectURL(blob);
    activeObjectUrl.current = nextUrl;
    setPdfUrl(nextUrl);
    return true;
  }, []);

  const loadSavedPdf = useCallback(async () => {
    if (demoMode || !finalEligible || !invoice.pdfStoragePath) return;
    const requestVersion = ++pdfRequestVersion.current;
    setLoadingSaved(true);
    setPdfError(null);
    try {
      const blob = await loadProtectedInvoicePdf(invoice.id);
      if (blob) showBlob(blob, requestVersion);
    } catch (error) {
      if (requestVersion === pdfRequestVersion.current) {
        setPdfError(error instanceof Error ? error.message : "The saved PDF could not be loaded.");
      }
    } finally {
      if (requestVersion === pdfRequestVersion.current) setLoadingSaved(false);
    }
  }, [finalEligible, invoice.id, invoice.pdfStoragePath, showBlob]);

  const signatureRevision = signatures
    .filter((signature) => ["work_authorization", "work_completion", "invoice_approval", "technician_acknowledgement"].includes(signature.purpose))
    .map((signature) => [
      signature.id,
      signature.status,
      signature.contentSha256,
      signature.signedAt,
      signature.rejectedAt ?? ""
    ].join(":"))
    .sort()
    .join("|");
  const documentRevision = JSON.stringify([
    invoice.updatedAt,
    invoice.selectedTier,
    invoice.optionLabel,
    invoice.notes,
    invoice.amountPaid,
    invoice.paymentStatus,
    job.serviceAddress,
    job.description,
    job.notes,
    items.map((item) => [item.id, item.tier, item.description, item.quantity, item.unitPrice, item.sortOrder])
  ]);

  useEffect(() => {
    setPdfError(null);
    if (!finalEligible) {
      clearPdf();
      return;
    }
    if (demoMode) {
      if (!invoice.pdfStoragePath || !invoice.pdfGeneratedAt) clearPdf();
      return;
    }
    clearPdf();
    void loadSavedPdf();
  }, [
    clearPdf,
    invoice.id,
    invoice.pdfGeneratedAt,
    invoice.pdfSha256,
    invoice.pdfSizeBytes,
    invoice.pdfStoragePath,
    invoice.pdfVersion,
    loadSavedPdf,
    signatureRevision,
    documentRevision,
    finalEligible
  ]);

  useEffect(() => () => {
    pdfRequestVersion.current += 1;
    if (activeObjectUrl.current) URL.revokeObjectURL(activeObjectUrl.current);
    activeObjectUrl.current = null;
  }, []);

  useEffect(() => {
    onBusyChange?.(generating || loadingSaved);
  }, [generating, loadingSaved, onBusyChange]);

  const generatePdf = useCallback(async () => {
    if (generating) return;
    const requestVersion = ++pdfRequestVersion.current;
    setGenerating(true);
    setPdfError(null);
    try {
      const blob = draftPreview || demoMode
        ? await pdf(<InvoicePdfDocument invoice={invoice} job={job} customer={customer} items={items} signatures={signatures} draft={draftPreview} />).toBlob()
        : await generateProtectedInvoicePdf(invoice.id);
      if (!showBlob(blob, requestVersion)) return;
      if (!draftPreview) await onGenerated?.();
    } catch (error) {
      if (requestVersion === pdfRequestVersion.current) {
        setPdfError(error instanceof Error ? error.message : "The invoice PDF could not be generated.");
      }
    } finally {
      if (requestVersion === pdfRequestVersion.current) setGenerating(false);
    }
  }, [customer, draftPreview, generating, invoice, items, job, onGenerated, showBlob, signatures]);

  useEffect(() => {
    if (generationRequest <= 0 || generationRequest === handledGenerationRequest.current) return;
    handledGenerationRequest.current = generationRequest;
    void generatePdf();
  }, [generatePdf, generationRequest]);

  const fileName = `${invoice.invoiceNumber}-${customer.name}`
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-|-$/g, "");
  const downloadName = `${fileName || invoice.invoiceNumber}${draftPreview ? "-DRAFT" : ""}.pdf`;
  const previewTitle = `${invoice.invoiceNumber}${draftPreview ? " draft" : ""} PDF preview`;

  return (
    <section className={styles.pdfShell} aria-labelledby="workspace-pdf-heading">
      <header className={styles.pdfHeader}>
        <div>
          <h2 id="workspace-pdf-heading">{draftPreview ? "Draft PDF preview" : "Final invoice PDF"}</h2>
          <p>
            {draftPreview
              ? "Preview the current bill without saving or sending a final document."
              : invoice.pdfGeneratedAt
              ? `Protected version ${invoice.pdfVersion} is saved. Creating a PDF does not email it.`
              : "Create the signed document here. Emailing it is a separate next step."}
          </p>
        </div>
        <div className={styles.pdfActions}>
          <a
            className={styles.pdfDownload}
            href={pdfUrl ?? "#"}
            target="_blank"
            rel="noreferrer"
            aria-disabled={!pdfUrl}
            onClick={(event) => {
              if (!pdfUrl) event.preventDefault();
            }}
          >
            <ExternalLink size={16} aria-hidden="true" />
            {draftPreview ? "Open draft PDF" : "Open PDF"}
          </a>
          <a
            className={styles.pdfDownload}
            href={pdfUrl ?? "#"}
            download={downloadName}
            aria-disabled={!pdfUrl}
            onClick={(event) => {
              if (!pdfUrl) event.preventDefault();
            }}
          >
            <Download size={16} aria-hidden="true" />
            {draftPreview ? "Download draft PDF" : "Download PDF"}
          </a>
        </div>
      </header>

      {draftPreview ? (
        <p className={styles.warningNote} role="status">
          <strong>{documentState.banner}.</strong> The bill remains available to review. This preview is created only on this device and is not saved, finalized, or eligible for invoice email delivery.
        </p>
      ) : null}

      <div className={styles.pdfStage}>
        {pdfError ? (
          <div className={`${styles.pdfEmpty} ${styles.pdfError}`} role="alert">
            <div>
              <FileCheck2 size={28} aria-hidden="true" />
              <strong>PDF unavailable</strong>
              <span>{pdfError}</span>
              {invoice.pdfStoragePath && finalEligible ? (
                <button className={styles.secondaryButton} type="button" onClick={() => void loadSavedPdf()} disabled={loadingSaved}>
                  <RefreshCw size={16} aria-hidden="true" />
                  {loadingSaved ? "Retrying..." : "Retry saved PDF"}
                </button>
              ) : null}
            </div>
          </div>
        ) : pdfUrl ? (
          <iframe className={styles.pdfFrame} title={previewTitle} src={pdfUrl} />
        ) : (
          <div className={styles.pdfEmpty} role="status">
            <div>
              <FileText size={30} aria-hidden="true" />
              <strong>{generating ? draftPreview ? "Creating draft PDF..." : "Generating signed PDF..." : loadingSaved ? "Loading saved PDF..." : draftPreview ? "Draft PDF is ready to preview" : "No final PDF preview yet"}</strong>
              <span>{generating || loadingSaved ? "Please keep this workspace open." : draftPreview ? "The preview will show the full bill and clearly mark every missing signature." : "Create the protected document, then open, download, or email it."}</span>
              {!generating && !loadingSaved ? (
                <button className={styles.primaryButton} type="button" onClick={() => void generatePdf()}>
                  <FileCheck2 size={16} aria-hidden="true" />
                  {draftPreview ? "Preview draft PDF" : "Generate signed PDF"}
                </button>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
