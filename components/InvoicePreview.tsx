"use client";

import { branding } from "@/lib/branding";
import { formatDate } from "@/lib/date";
import { tierLabels } from "@/lib/data-store";
import { money, percent } from "@/lib/money";
import type { Customer, Invoice, Job, JobLineItem, Tier } from "@/lib/types";

export function InvoicePreview({
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
  const selectedTier: Tier = invoice.selectedTier ?? "better";
  const totals = {
    good: { subtotal: invoice.subtotalGood, total: invoice.totalGood },
    better: { subtotal: invoice.subtotalBetter, total: invoice.totalBetter },
    best: { subtotal: invoice.subtotalBest, total: invoice.totalBest }
  };
  const selectedItems = items.filter((item) => item.tier === selectedTier);
  const selectedTotals = totals[selectedTier];
  const selectedTax = selectedTotals.total - selectedTotals.subtotal;

  return (
    <div className="invoice-preview">
      <div className="invoice-top">
        <div>
          <p className="eyebrow">Document preview</p>
          <h2>{branding.businessName}</h2>
          <p>{branding.address}</p>
          <p>{branding.phone} · {branding.email}</p>
          <p>{branding.licenseNumber}</p>
        </div>
        <div className="invoice-number">
          <strong>{invoice.invoiceNumber}</strong>
          <span>{formatDate(invoice.createdAt)}</span>
          <span className="pill pill-info">{invoice.status}</span>
        </div>
      </div>

      <div className="invoice-billto">
        <div>
          <p className="eyebrow">Bill to</p>
          <strong>{customer.name}</strong>
          <span>{customer.email}</span>
          <span>{customer.phone}</span>
          <span>{job.serviceAddress}</span>
        </div>
        <div>
          <p className="eyebrow">Job</p>
          <strong>{job.description}</strong>
          <span>{job.status.replace("_", " ")}</span>
          <span>Selected option: {tierLabels[selectedTier]}</span>
        </div>
      </div>

      <div className="invoice-document-body">
        <div className="invoice-document-heading">
          <div>
            <p className="eyebrow">Approved work</p>
            <h3>{tierLabels[selectedTier]}</h3>
          </div>
          <strong>{money(selectedTotals.total)}</strong>
        </div>
        <div className="invoice-line-table">
          <div className="invoice-line-head">
            <span>Description</span>
            <span>Qty</span>
            <span>Rate</span>
            <span>Total</span>
          </div>
          {selectedItems.length === 0 ? (
            <p className="muted">No items on the selected option.</p>
          ) : (
            selectedItems.map((item) => (
              <div key={item.id} className="invoice-line">
                <span>{item.description}</span>
                <span>{item.quantity}</span>
                <span>{money(item.unitPrice)}</span>
                <span>{money(item.quantity * item.unitPrice)}</span>
              </div>
            ))
          )}
        </div>
        <div className="invoice-total-box">
          <p>Subtotal <span>{money(selectedTotals.subtotal)}</span></p>
          <p>Tax {percent(invoice.taxRate)} <span>{money(selectedTax)}</span></p>
          <strong>Total due <span>{money(selectedTotals.total)}</span></strong>
        </div>
      </div>
    </div>
  );
}
