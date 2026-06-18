"use client";

import { Download, FileText } from "lucide-react";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { useEffect, useState } from "react";
import { formatDate } from "@/lib/date";
import { money } from "@/lib/money";
import type { Customer, Invoice, Job, JobLineItem, Tier } from "@/lib/types";

const tierNames: Record<Tier, string> = {
  good: "Good",
  better: "Better",
  best: "Best"
};

const tierOrder: Tier[] = ["good", "better", "best"];

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
        const blob = await buildTemplatePdf(invoice, job, customer, items);
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
        ) : pdfUrl ? (
          <>
            <iframe className="invoice-pdf-frame" title={`${invoice.invoiceNumber} PDF preview`} src={pdfUrl} />
            <span className="pdf-ready-badge">PDF ready</span>
          </>
        ) : (
          <div className="pdf-loading">Building PDF...</div>
        )}
      </div>
    </section>
  );
}

async function buildTemplatePdf(invoice: Invoice, job: Job, customer: Customer, items: JobLineItem[]) {
  const templateBytes = await fetch("/templates/fast_track_invoice_fillable.pdf").then((response) => {
    if (!response.ok) throw new Error("Invoice template could not be loaded.");
    return response.arrayBuffer();
  });
  const pdfDoc = await PDFDocument.load(templateBytes);
  const form = pdfDoc.getForm();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const selectedTier = invoice.selectedTier ?? "good";
  const subtotal = totalFor(invoice, selectedTier, "subtotal");
  const total = totalFor(invoice, selectedTier, "total");
  const tax = total - subtotal;

  setText(form, "invoice_no", invoice.invoiceNumber);
  setText(form, "date", formatDate(invoice.createdAt));
  setText(form, "customer_name", customer.name);
  setText(form, "phone", customer.phone);
  setText(form, "job_street", customer.addressLine1);
  setText(form, "unit_no", customer.addressLine2 ?? "");
  setText(form, "city", customer.city);
  setText(form, "state", customer.state);
  setText(form, "zip_code", customer.zip);
  setText(form, "customer_email", customer.email ?? "");
  setText(form, "nature_service_request", job.description);
  setText(form, "description", optionSummary(invoice, items));
  setText(form, "service_performed_diagnosis", job.notes || "Technician diagnosis and completed work.");
  setText(form, "job_cost", money(subtotal));
  setText(form, "service_call", "Included");
  setText(form, "sub_total", money(subtotal));
  setText(form, "tax", money(tax));
  setText(form, "deposit", "$0.00");
  setText(form, "total", money(total));
  setText(form, "pay_this_amount", money(total));
  setText(form, "repair_estimate_amount", money(total));
  setText(form, "technician", "");
  setText(form, "approved", tierNames[selectedTier]);
  setText(form, "revised_estimate", tierNames[selectedTier]);
  form.updateFieldAppearances(font);

  const bytes = await pdfDoc.save();
  const arrayBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(arrayBuffer).set(bytes);
  return new Blob([arrayBuffer], { type: "application/pdf" });
}

function setText(form: ReturnType<PDFDocument["getForm"]>, name: string, value: string) {
  try {
    form.getTextField(name).setText(value);
  } catch {
    // The template is the source of truth; skip missing fields if a future copy changes.
  }
}

function optionSummary(invoice: Invoice, items: JobLineItem[]) {
  return tierOrder
    .map((tier) => {
      const tierItems = items.filter((item) => item.tier === tier);
      const total = totalFor(invoice, tier, "total");
      const lines = tierItems.length === 0
        ? ["No items listed."]
        : tierItems.map((item) => `${item.description} - ${item.quantity} x ${money(item.unitPrice)}`);
      return `${tierNames[tier].toUpperCase()} - ${money(total)}\n${lines.join("\n")}`;
    })
    .join("\n\n");
}

function totalFor(invoice: Invoice, tier: Tier, kind: "subtotal" | "total") {
  if (tier === "good") return kind === "subtotal" ? invoice.subtotalGood : invoice.totalGood;
  if (tier === "best") return kind === "subtotal" ? invoice.subtotalBest : invoice.totalBest;
  return kind === "subtotal" ? invoice.subtotalBetter : invoice.totalBetter;
}
