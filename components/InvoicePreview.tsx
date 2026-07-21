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
  const authorization = signatures.find((signature) => signature.status === "active" && signature.purpose === "work_authorization");
  const completion = signatures.find((signature) => signature.status === "active" && signature.purpose === "work_completion");
  const completionOverride = !completion && job.completionSignatureOverrideAt && job.completionSignatureOverrideReason
    ? { at: job.completionSignatureOverrideAt, reason: job.completionSignatureOverrideReason }
    : undefined;

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

        <div className="invoice-signature-grid">
          <FieldSignaturePreview
            title="Authorization of repair"
            signature={authorization}
            pending="Collect before work begins."
          />
          <FieldSignaturePreview
            title="Completion of work"
            signature={completion}
            override={completionOverride}
            pending="Collect after the repair and after photo."
          />
        </div>
      </div>
    </article>
  );
}

function FieldSignaturePreview({
  title,
  signature,
  override,
  pending
}: {
  title: string;
  signature?: InvoiceSignature;
  override?: { at: string; reason: string };
  pending: string;
}) {
  const complete = Boolean(signature || override);
  return (
    <div className={`invoice-signature-preview ${complete ? "signed" : "pending"}`}>
      <div className="invoice-signature-state">
        {complete ? <CheckCircle2 size={19} aria-hidden="true" /> : <Clock3 size={19} aria-hidden="true" />}
        <div>
          <strong>{title}</strong>
          <span>{signature
            ? `${signature.signerName} · ${formatDateTime(signature.signedAt)}`
            : override
              ? `Owner override · ${formatDateTime(override.at)} · ${override.reason}`
              : pending}</span>
        </div>
      </div>
      {signature?.imageUrl ? <img src={signature.imageUrl} alt={`Signature from ${signature.signerName}`} /> : null}
    </div>
  );
}
