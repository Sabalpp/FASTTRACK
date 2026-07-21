"use client";

import { Download, FileCheck2, FilePlus2, RefreshCw } from "lucide-react";
import { pdf } from "@react-pdf/renderer";
import { useCallback, useEffect, useRef, useState } from "react";
import { InvoicePdfDocument } from "@/components/InvoicePdfDocument";
import { generateProtectedInvoicePdf, loadProtectedInvoicePdf } from "@/lib/invoices-client";
import { demoMode } from "@/lib/runtime";
import type { Customer, Invoice, InvoiceSignature, Job, JobLineItem } from "@/lib/types";

export function InvoicePdfViewer({
  invoice,
  job,
  customer,
  items,
  signatures,
  canGenerate,
  onGenerated
}: {
  invoice: Invoice;
  job: Job;
  customer: Customer;
  items: JobLineItem[];
  signatures: InvoiceSignature[];
  canGenerate: boolean;
  onGenerated?: () => void | Promise<void>;
}) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loadingSaved, setLoadingSaved] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const activeObjectUrl = useRef<string | null>(null);
  const pdfRequestVersion = useRef(0);

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
    .filter((signature) => ["work_authorization", "work_completion", "technician_acknowledgement"].includes(signature.purpose))
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
    clearPdf();
    setPdfError(null);
    if (demoMode) return;
    void loadSavedPdf();
  }, [clearPdf, invoice.pdfSha256, invoice.pdfSizeBytes, invoice.pdfVersion, loadSavedPdf, signatureRevision]);

  useEffect(() => () => {
    pdfRequestVersion.current += 1;
    if (activeObjectUrl.current) URL.revokeObjectURL(activeObjectUrl.current);
    activeObjectUrl.current = null;
  }, []);

  async function generatePdf() {
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
  }

  const fileName = `${invoice.invoiceNumber}-${customer.name}`.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "");

  return (
    <section className="pdf-viewer-shell" aria-labelledby="pdf-preview-heading">
      <div className="pdf-toolbar">
        <div>
          <p className="eyebrow">Generate PDF</p>
          <h2 id="pdf-preview-heading">Print-ready invoice</h2>
          <p className="muted">
            {invoice.pdfGeneratedAt
              ? `Saved PDF version ${invoice.pdfVersion}. Regenerate after payment changes.`
              : "The final PDF is generated from protected server data after the two field checkpoints."}
          </p>
        </div>
        <div className="pdf-toolbar-actions">
          <button
            className="button button-secondary"
            type="button"
            onClick={() => void generatePdf()}
            disabled={!canGenerate || generating}
          >
            <FilePlus2 size={17} aria-hidden="true" />
            {generating ? "Generating..." : pdfUrl ? "Regenerate PDF" : "Generate PDF"}
          </button>
          <a
            className={`button pdf-download-link ${pdfUrl ? "" : "disabled"}`}
            href={pdfUrl ?? "#"}
            download={`${fileName || invoice.invoiceNumber}.pdf`}
            aria-disabled={!pdfUrl}
            onClick={(event) => {
              if (!pdfUrl) event.preventDefault();
            }}
          >
            <Download size={17} aria-hidden="true" />
            Download
          </a>
        </div>
      </div>

      {!canGenerate ? (
        <div className="pdf-prerequisite" role="status">
          <FileCheck2 size={19} aria-hidden="true" />
          Finish authorization and completion in the field workflow before generating the final PDF.
        </div>
      ) : null}

      <div className="invoice-pdf-stage">
        {pdfError ? (
          <div className="pdf-loading error-state" role="alert">
            <strong>PDF unavailable</strong>
            <p>{pdfError}</p>
            {invoice.pdfStoragePath ? (
              <button className="button button-secondary" type="button" onClick={() => void loadSavedPdf()} disabled={loadingSaved}>
                <RefreshCw size={16} aria-hidden="true" />
                {loadingSaved ? "Retrying..." : "Retry"}
              </button>
            ) : null}
          </div>
        ) : pdfUrl ? (
          <>
            <iframe className="invoice-pdf-frame" title={`${invoice.invoiceNumber} PDF preview`} src={pdfUrl} />
            <span className="pdf-ready-badge">PDF ready</span>
          </>
        ) : (
          <div className="pdf-loading">
            {loadingSaved ? "Loading saved PDF..." : "Generate the signed invoice to preview it here."}
          </div>
        )}
      </div>
    </section>
  );
}
