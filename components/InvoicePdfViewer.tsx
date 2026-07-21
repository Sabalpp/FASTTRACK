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

  const showBlob = useCallback((blob: Blob) => {
    if (activeObjectUrl.current) URL.revokeObjectURL(activeObjectUrl.current);
    const nextUrl = URL.createObjectURL(blob);
    activeObjectUrl.current = nextUrl;
    setPdfUrl(nextUrl);
  }, []);

  const loadSavedPdf = useCallback(async () => {
    if (demoMode || !invoice.pdfStoragePath) return;
    setLoadingSaved(true);
    setPdfError(null);
    try {
      const blob = await loadProtectedInvoicePdf(invoice.id);
      if (blob) showBlob(blob);
    } catch (error) {
      setPdfError(error instanceof Error ? error.message : "The saved PDF could not be loaded.");
    } finally {
      setLoadingSaved(false);
    }
  }, [invoice.id, invoice.pdfStoragePath, showBlob]);

  useEffect(() => {
    if (demoMode) return;
    setPdfUrl(null);
    if (activeObjectUrl.current) {
      URL.revokeObjectURL(activeObjectUrl.current);
      activeObjectUrl.current = null;
    }
    void loadSavedPdf();
  }, [invoice.pdfVersion, loadSavedPdf]);

  useEffect(() => () => {
    if (activeObjectUrl.current) URL.revokeObjectURL(activeObjectUrl.current);
    activeObjectUrl.current = null;
  }, []);

  async function generatePdf() {
    setGenerating(true);
    setPdfError(null);
    try {
      const blob = demoMode
        ? await pdf(<InvoicePdfDocument invoice={invoice} job={job} customer={customer} items={items} signatures={signatures} />).toBlob()
        : await generateProtectedInvoicePdf(invoice.id);
      showBlob(blob);
      await onGenerated?.();
    } catch (error) {
      setPdfError(error instanceof Error ? error.message : "The invoice PDF could not be generated.");
    } finally {
      setGenerating(false);
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
              : "The final PDF is generated from protected server data after customer approval."}
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
          Save the customer approval signature before generating the final PDF.
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
