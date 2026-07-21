"use client";

import { CheckCircle2, Clock3 } from "lucide-react";
import { branding } from "@/lib/branding";
import { formatDate, formatDateTime } from "@/lib/date";
import { balanceDue, firstPopulatedTier, invoiceOptionLabels, selectedSubtotal, selectedTotal } from "@/lib/invoice";
import { money, percent } from "@/lib/money";
import type { Customer, Invoice, InvoiceSignature, Job, JobLineItem } from "@/lib/types";

export function InvoicePreview({
  invoice,
  job,
  customer,
  items,
  signatures = []
}: {
  invoice: Invoice;
  job: Job;
  customer: Customer;
  items: JobLineItem[];
  signatures?: InvoiceSignature[];
}) {
  const selectedTier = firstPopulatedTier(invoice);
  const selectedInvoice = selectedTier ? { ...invoice, selectedTier } : invoice;
  const selectedItems = selectedTier ? items.filter((item) => item.tier === selectedTier) : [];
  const subtotal = selectedTier ? selectedSubtotal(selectedInvoice) : 0;
  const total = selectedTier ? selectedTotal(selectedInvoice) : 0;
  const selectedTax = total - subtotal;
  const approval = signatures.find((signature) => signature.status === "active" && signature.purpose === "invoice_approval");

  return (
    <article className="invoice-preview invoice-review-preview" aria-label="Invoice review preview">
      <div className="invoice-top">
        <div>
          <p className="eyebrow">Invoice preview</p>
          <h2>{branding.businessName}</h2>
          <p>{branding.address}</p>
          <p>{branding.phone} · {branding.email}</p>
        </div>
        <div className="invoice-number">
          <strong>{invoice.invoiceNumber}</strong>
          <span>Issued {formatDate(invoice.createdAt)}</span>
          <span className={`pill ${invoice.paymentStatus === "paid" ? "pill-good" : "pill-info"}`}>
            {invoice.paymentStatus.replace("_", " ")}
          </span>
        </div>
      </div>

      <div className="invoice-billto">
        <div>
          <p className="eyebrow">Bill to</p>
          <strong>{customer.name}</strong>
          <span>{customer.email || "No email on file"}</span>
          <span>{customer.phone}</span>
        </div>
        <div>
          <p className="eyebrow">Service location</p>
          <strong>{job.serviceAddress}</strong>
          <span>Service date {formatDate(job.completedAt ?? job.arrivedAt ?? job.scheduledAt)}</span>
        </div>
      </div>

      <div className="invoice-document-body">
        <div className="invoice-document-heading">
          <div>
            <p className="eyebrow">Service details</p>
            <h3>{invoiceOptionLabels[invoice.optionLabel]}</h3>
          </div>
          <strong>{money(total)}</strong>
        </div>
        <div className="invoice-line-table">
          <div className="invoice-line-head">
            <span>Description</span>
            <span>Qty</span>
            <span>Rate</span>
            <span>Amount</span>
          </div>
          {selectedItems.length === 0 ? (
            <p className="muted invoice-empty-lines">Select the approved estimate option to review invoice items.</p>
          ) : selectedItems.map((item) => (
            <div key={item.id} className="invoice-line">
              <span>{item.description}</span>
              <span>{item.quantity}</span>
              <span>{money(item.unitPrice)}</span>
              <span>{money(item.quantity * item.unitPrice)}</span>
            </div>
          ))}
        </div>
        <div className="invoice-review-summary">
          <div className="invoice-notes-preview">
            <p className="eyebrow">Work summary & notes</p>
            <p>{invoice.notes || job.notes || "No additional notes."}</p>
          </div>
          <div className="invoice-total-box">
            <p>Subtotal <span>{money(subtotal)}</span></p>
            <p>Tax {percent(invoice.taxRate)} <span>{money(selectedTax)}</span></p>
            <p>Paid <span>{money(invoice.amountPaid)}</span></p>
            <strong>Balance due <span>{money(balanceDue(selectedInvoice))}</span></strong>
          </div>
        </div>

        <div className={`invoice-signature-preview ${approval ? "signed" : "pending"}`}>
          <div className="invoice-signature-state">
            {approval ? <CheckCircle2 size={19} aria-hidden="true" /> : <Clock3 size={19} aria-hidden="true" />}
            <div>
              <strong>{approval ? "Customer approval saved" : "Customer signature not saved"}</strong>
              <span>{approval ? `${approval.signerName} · ${formatDateTime(approval.signedAt)}` : "Draw and save the signature before generating the PDF."}</span>
            </div>
          </div>
          {approval?.imageUrl ? <img src={approval.imageUrl} alt={`Signature from ${approval.signerName}`} /> : null}
        </div>
      </div>
    </article>
  );
}
