"use client";

import { Download, FileText } from "lucide-react";
import { pdf } from "@react-pdf/renderer";
import { useEffect, useState } from "react";
import { InvoiceCanvasPreview } from "@/components/InvoiceCanvasPreview";
import { InvoicePdfDocument } from "@/components/InvoicePdfDocument";
import type { Customer, Invoice, Job, JobLineItem } from "@/lib/types";

export function InvoicePdfViewer({
  invoice,
  job,
  customer,
  items
}: {
  invoice: Invoice;
  job: Job;
  customer: Customer;
  items: JobLineItem[];
}) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | undefined;
    let cancelled = false;

    setPdfUrl(null);
    setPdfError(null);

    async function buildPdf() {
      try {
        const blob = await pdf(
          <InvoicePdfDocument invoice={invoice} job={job} customer={customer} items={items} />
        ).toBlob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setPdfUrl(objectUrl);
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "Could not build invoice PDF.";
        setPdfError(message);
      }
    }

    void buildPdf();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [invoice, job, customer, items]);

  const fileName = `${invoice.invoiceNumber}-${customer.name}`.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "");

  return (
    <section className="pdf-viewer-shell">
      <div className="pdf-dock">
        <a
          className={`download-button ${pdfUrl ? "" : "disabled"}`}
          href={pdfUrl ?? "#"}
          download={`${fileName || invoice.invoiceNumber}.pdf`}
          onClick={(event) => {
            if (!pdfUrl) event.preventDefault();
          }}
        >
          <span className="docs">
            <FileText size={18} aria-hidden="true" />
            Download PDF
          </span>
          <span className="download">
            <Download size={18} aria-hidden="true" />
          </span>
        </a>
      </div>

      <div className="invoice-pdf-stage">
        {pdfError ? (
          <div className="pdf-loading error-state">
            <strong>PDF failed to build</strong>
            <p>{pdfError}</p>
          </div>
        ) : (
          <>
            <InvoiceCanvasPreview invoice={invoice} job={job} customer={customer} items={items} />
            <span className="pdf-ready-badge">{pdfUrl ? "PDF ready" : "Building PDF"}</span>
          </>
        )}
      </div>
    </section>
  );
}
