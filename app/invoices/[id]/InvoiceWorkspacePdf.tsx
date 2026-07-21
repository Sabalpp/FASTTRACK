"use client";

import { pdf } from "@react-pdf/renderer";
import { Download, FileCheck2, FileText, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { InvoicePdfDocument } from "@/components/InvoicePdfDocument";
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
    if (demoMode || !invoice.pdfStoragePath) return;
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
  }, [invoice.id, invoice.pdfStoragePath, showBlob]);

  const signatureRevision = signatures
    .filter((signature) => signature.purpose === "invoice_approval" || signature.purpose === "technician_acknowledgement")
    .map((signature) => [
      signature.id,
      signature.status,
      signature.contentSha256,
      signature.signedAt,
      signature.rejectedAt ?? ""
    ].join(":"))
    .sort()
    .join("|");

  useEffect(() => {
    setPdfError(null);
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
    signatureRevision
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
    if (!canGenerate || generating) return;
    const requestVersion = ++pdfRequestVersion.current;
    setGenerating(true);
    setPdfError(null);
    try {
      const blob = demoMode
        ? await pdf(<InvoicePdfDocument invoice={invoice} job={job} customer={customer} items={items} signatures={signatures} />).toBlob()
        : await generateProtectedInvoicePdf(invoice.id);
      if (!showBlob(blob, requestVersion)) return;
      await onGenerated?.();
    } catch (error) {
      if (requestVersion === pdfRequestVersion.current) {
        setPdfError(error instanceof Error ? error.message : "The invoice PDF could not be generated.");
      }
    } finally {
      if (requestVersion === pdfRequestVersion.current) setGenerating(false);
    }
  }, [canGenerate, customer, generating, invoice, items, job, onGenerated, showBlob, signatures]);

  useEffect(() => {
    if (generationRequest <= 0 || generationRequest === handledGenerationRequest.current) return;
    handledGenerationRequest.current = generationRequest;
    void generatePdf();
  }, [generatePdf, generationRequest]);

  const fileName = `${invoice.invoiceNumber}-${customer.name}`
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-|-$/g, "");

  return (
    <section className={styles.pdfShell} aria-labelledby="workspace-pdf-heading">
      <header className={styles.pdfHeader}>
        <div>
          <h2 id="workspace-pdf-heading">Final invoice PDF</h2>
          <p>
            {invoice.pdfGeneratedAt
              ? `Protected version ${invoice.pdfVersion} is saved.`
              : "Generate the signed invoice when the customer approval is final."}
          </p>
        </div>
        <a
          className={styles.pdfDownload}
          href={pdfUrl ?? "#"}
          download={`${fileName || invoice.invoiceNumber}.pdf`}
          aria-disabled={!pdfUrl}
          onClick={(event) => {
            if (!pdfUrl) event.preventDefault();
          }}
        >
          <Download size={16} aria-hidden="true" />
          Download PDF
        </a>
      </header>

      {!canGenerate ? (
        <p className={styles.warningNote} role="status">
          Save the customer approval signature before generating the final PDF.
        </p>
      ) : null}

      <div className={styles.pdfStage}>
        {pdfError ? (
          <div className={`${styles.pdfEmpty} ${styles.pdfError}`} role="alert">
            <div>
              <FileCheck2 size={28} aria-hidden="true" />
              <strong>PDF unavailable</strong>
              <span>{pdfError}</span>
              {invoice.pdfStoragePath ? (
                <button className={styles.secondaryButton} type="button" onClick={() => void loadSavedPdf()} disabled={loadingSaved}>
                  <RefreshCw size={16} aria-hidden="true" />
                  {loadingSaved ? "Retrying..." : "Retry saved PDF"}
                </button>
              ) : null}
            </div>
          </div>
        ) : pdfUrl ? (
          <iframe className={styles.pdfFrame} title={`${invoice.invoiceNumber} PDF preview`} src={pdfUrl} />
        ) : (
          <div className={styles.pdfEmpty} role="status">
            <div>
              <FileText size={30} aria-hidden="true" />
              <strong>{generating ? "Generating signed PDF..." : loadingSaved ? "Loading saved PDF..." : "No final PDF preview yet"}</strong>
              <span>{generating || loadingSaved ? "Please keep this workspace open." : "Use the primary action to generate the protected document."}</span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
