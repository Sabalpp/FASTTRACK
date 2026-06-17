"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { useAppData } from "@/lib/data-store";
import { canViewInvoice } from "@/lib/access";
import { money } from "@/lib/money";
import { EmptyState, PageHeader, StatusPill } from "@/components/ui";

export default function InvoicesPage() {
  const { currentUser } = useAuth();
  const data = useAppData();
  const visibleInvoices = useMemo(
    () => data.invoices.filter((invoice) => canViewInvoice(currentUser, invoice, data.jobs)),
    [currentUser, data.invoices, data.jobs]
  );

  if (currentUser.role === "call_center") {
    return (
      <main className="page-shell">
        <EmptyState title="Invoices are hidden" description="Call center users cannot view invoices, prices, parts, or dollar amounts." />
      </main>
    );
  }

  return (
    <main className="page-shell">
      <PageHeader eyebrow="Billing" title="Invoices" />
      <div className="record-list">
        {visibleInvoices.length === 0 ? (
          <EmptyState title="No invoices yet" description="Build one from a job after line items are added." />
        ) : (
          visibleInvoices.map((invoice) => {
            const job = data.jobs.find((candidate) => candidate.id === invoice.jobId);
            const customer = data.customers.find((candidate) => candidate.id === job?.customerId);
            return (
              <Link key={invoice.id} href={`/invoices/${invoice.id}`} className="record-row invoice-row">
                <div className="record-main">
                  <strong>{invoice.invoiceNumber}</strong>
                  <span>{customer?.name ?? "Unknown customer"}</span>
                </div>
                <div className="record-meta">
                  <span>Good {money(invoice.totalGood)}</span>
                  <small>Better {money(invoice.totalBetter)} · Best {money(invoice.totalBest)}</small>
                </div>
                <div className="record-side">
                  <StatusPill tone={invoice.status === "sent" || invoice.status === "paid" ? "good" : "warn"}>{invoice.status}</StatusPill>
                </div>
              </Link>
            );
          })
        )}
      </div>
    </main>
  );
}
