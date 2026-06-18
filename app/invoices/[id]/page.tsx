"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { tierLabels, tierOptions, useAppData } from "@/lib/data-store";
import { canSendInvoices, canViewInvoice } from "@/lib/access";
import { money } from "@/lib/money";
import { TierColumns } from "@/components/TierColumns";
import { Button, Card, EmptyState, Field, PageHeader, StatusPill } from "@/components/ui";
import type { Tier } from "@/lib/types";

const InvoicePdfViewer = dynamic(
  () => import("@/components/InvoicePdfViewer").then((module) => module.InvoicePdfViewer),
  {
    ssr: false,
    loading: () => (
      <section className="pdf-viewer-shell">
        <div className="invoice-pdf-stage">
          <div className="pdf-loading">Building PDF...</div>
        </div>
      </section>
    )
  }
);

export default function InvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  const { currentUser } = useAuth();
  const data = useAppData();
  const invoice = data.invoices.find((candidate) => candidate.id === params.id);
  const job = invoice ? data.jobs.find((candidate) => candidate.id === invoice.jobId) : undefined;
  const customer = job ? data.customers.find((candidate) => candidate.id === job.customerId) : undefined;
  const [selectedTier, setSelectedTier] = useState<Tier>(invoice?.selectedTier ?? "better");
  const [editingOptions, setEditingOptions] = useState(false);
  const [email, setEmail] = useState(invoice?.sentToEmail ?? customer?.email ?? "");
  const [sent, setSent] = useState(false);

  if (!invoice || !canViewInvoice(currentUser, invoice, data.jobs)) {
    return (
      <main className="page-shell">
        <EmptyState title="Invoice not available" description="This invoice either does not exist or is outside this role's access." />
      </main>
    );
  }

  const items = data.jobLineItems.filter((item) => item.jobId === invoice.jobId).sort((a, b) => a.sortOrder - b.sortOrder);

  if (!job || !customer) {
    return (
      <main className="page-shell">
        <EmptyState title="Invoice data is incomplete" description="The related job or customer could not be found." />
      </main>
    );
  }

  const invoiceId = invoice.id;
  const totalByTier = {
    good: invoice.totalGood,
    better: invoice.totalBetter,
    best: invoice.totalBest
  };
  const canEditDraft = canSendInvoices(currentUser.role) && invoice.status === "draft";

  function saveTier() {
    data.updateInvoice(invoiceId, { selectedTier });
  }

  function sendInvoice() {
    data.updateInvoice(invoiceId, { selectedTier });
    data.sendInvoice(invoiceId, email);
    setSent(true);
  }

  return (
    <main className="page-shell">
      <PageHeader
        eyebrow="Invoice"
        title={invoice.invoiceNumber}
        description={`${customer.name} · ${job.description}`}
        action={<Link href={`/jobs/${job.id}`} className="button button-secondary">Back to job</Link>}
      />

      <section className="invoice-tier-grid" aria-label="Invoice options">
        {tierOptions.map((tier) => (
          <button
            key={tier}
            type="button"
            className={`invoice-option-card ${selectedTier === tier ? "selected-card" : ""}`}
            onClick={() => {
              setSelectedTier(tier);
              data.updateInvoice(invoiceId, { selectedTier: tier });
            }}
            onDoubleClick={() => {
              if (!canEditDraft) return;
              setSelectedTier(tier);
              setEditingOptions(true);
              data.updateInvoice(invoiceId, { selectedTier: tier });
            }}
          >
            <p className="eyebrow">{tierLabels[tier]}</p>
            <h2>{money(totalByTier[tier])}</h2>
            <p className="muted">{items.filter((item) => item.tier === tier).length} line items</p>
            <span className="option-card-status">{editingOptions && selectedTier === tier ? "Editing" : selectedTier === tier ? "Selected" : "Select option"}</span>
          </button>
        ))}
      </section>

      {canEditDraft && editingOptions ? (
        <Card className="invoice-edit-card">
          <div className="section-head">
            <div>
              <p className="eyebrow">Estimate</p>
              <h2>Edit Good / Better / Best</h2>
              <p className="muted">Change descriptions, quantities, prices, and move items between packages.</p>
            </div>
            <Button variant="secondary" onClick={() => setEditingOptions(false)}>Done</Button>
          </div>
          <TierColumns
            items={items}
            taxRate={invoice.taxRate}
            editable
            onEdit={data.updateLineItem}
            onDelete={data.deleteLineItem}
          />
        </Card>
      ) : null}

      <Card className="invoice-send-card">
        <div className="section-head">
          <div>
            <p className="eyebrow">Invoice</p>
            <h2>Review and mark sent</h2>
          </div>
          <StatusPill tone={invoice.status === "sent" ? "good" : "warn"}>{sent ? "sent" : invoice.status}</StatusPill>
        </div>
        <div className="invoice-send-grid">
          <Field label="Customer email">
            <input value={email} onChange={(event) => setEmail(event.target.value)} disabled={!canSendInvoices(currentUser.role)} />
          </Field>
          <div className="invoice-send-actions">
            {canSendInvoices(currentUser.role) ? (
              <>
                <Button variant="secondary" onClick={saveTier}>Save option</Button>
                <Button onClick={sendInvoice}>Mark sent</Button>
              </>
            ) : (
              <p className="muted">Owner sends.</p>
            )}
          </div>
        </div>
        {canSendInvoices(currentUser.role) ? (
          <p className="muted invoice-send-note">Demo send records the recipient and marks the PDF sent. Real email delivery needs an email provider key.</p>
        ) : null}
        {sent ? <p className="success-message">Invoice marked sent for {email || "customer"}.</p> : null}
      </Card>

      <InvoicePdfViewer invoice={{ ...invoice, selectedTier }} job={job} customer={customer} items={items} />
    </main>
  );
}
