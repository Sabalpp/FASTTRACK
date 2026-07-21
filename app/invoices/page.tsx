"use client";

import { ArrowRight, CircleDollarSign, FileCheck2, FileText, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { canViewInvoice } from "@/lib/access";
import { useAuth } from "@/lib/auth";
import { useAppData } from "@/lib/data-store";
import { formatDateTime } from "@/lib/date";
import { invoiceOptionLabels, selectedTotal } from "@/lib/invoice";
import { money } from "@/lib/money";
import type { Invoice } from "@/lib/types";
import styles from "./invoices.module.css";

type InvoiceFilter = "draft" | "unpaid" | "all";

export default function InvoicesPage() {
  const { currentUser } = useAuth();
  const data = useAppData();
  const [filter, setFilter] = useState<InvoiceFilter>("unpaid");
  const [query, setQuery] = useState("");

  const visibleInvoices = useMemo(
    () => data.invoices
      .filter((invoice) => canViewInvoice(currentUser, invoice, data.jobs))
      .sort((a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt)),
    [currentUser, data.invoices, data.jobs]
  );

  const filteredInvoices = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return visibleInvoices.filter((invoice) => {
      const job = data.jobs.find((candidate) => candidate.id === invoice.jobId);
      const customer = data.customers.find((candidate) => candidate.id === job?.customerId);
      const matchesFilter = filter === "all"
        || (filter === "draft" && invoice.status === "draft")
        || (filter === "unpaid" && invoice.status === "sent" && invoice.paymentStatus !== "paid");
      const searchable = `${invoice.invoiceNumber} ${customer?.name ?? ""} ${customer?.email ?? ""} ${job?.description ?? ""}`.toLowerCase();
      return matchesFilter && (!normalizedQuery || searchable.includes(normalizedQuery));
    });
  }, [data.customers, data.jobs, filter, query, visibleInvoices]);

  if (currentUser.role === "call_center") {
    return (
      <main className={`page-shell ${styles.page}`}>
        <div className={styles.restricted}><FileText size={24} /><strong>Invoices are not part of the call-center workspace</strong><p>Financial records remain available to owners and assigned technicians.</p></div>
      </main>
    );
  }

  const draftCount = visibleInvoices.filter((invoice) => invoice.status === "draft").length;
  const unpaidInvoices = visibleInvoices.filter((invoice) => invoice.status === "sent" && invoice.paymentStatus !== "paid");
  const unpaidBalance = unpaidInvoices.reduce((sum, invoice) => sum + invoiceBalance(invoice), 0);
  const paidCount = visibleInvoices.filter((invoice) => invoice.paymentStatus === "paid").length;

  return (
    <main className={`page-shell ${styles.page}`}>
      <header className={styles.hero}>
        <div><p className={styles.kicker}>Billing</p><h1>Invoices</h1><p>Review drafts, customer delivery records, and balances from one workspace.</p></div>
      </header>

      <section className={styles.summary} aria-label="Invoice summary">
        <div><span><CircleDollarSign size={18} /></span><span><strong>{money(unpaidBalance)}</strong><small>Outstanding balance</small></span></div>
        <div><span><FileText size={18} /></span><span><strong>{draftCount}</strong><small>Drafts to review</small></span></div>
        <div><span><FileCheck2 size={18} /></span><span><strong>{paidCount}</strong><small>Paid invoices</small></span></div>
      </section>

      <section className={styles.workspace} aria-labelledby="invoice-list-title">
        <div className={styles.workspaceHeader}>
          <div><h2 id="invoice-list-title">Invoice list</h2><p>{filteredInvoices.length} shown</p></div>
          <div className={styles.filters}>
            <label className={styles.searchField}>
              <Search size={17} aria-hidden="true" /><span className={styles.srOnly}>Search invoices</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Number, customer, email" />
            </label>
            <div className={styles.tabs} aria-label="Filter invoices">
              {(["draft", "unpaid", "all"] as const).map((value) => (
                <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>
                  {value === "draft" ? "Drafts" : value === "unpaid" ? "Unpaid" : "All"}
                </button>
              ))}
            </div>
          </div>
        </div>

        {filteredInvoices.length === 0 ? (
          <div className={styles.empty}><FileText size={24} /><strong>No invoices in this view</strong><p>Invoices are created from jobs after work items are added.</p></div>
        ) : (
          <div className={styles.list} role="table" aria-label="Invoices">
            <div className={styles.tableHeader} role="row">
              <span role="columnheader">Invoice</span><span role="columnheader">Customer</span><span role="columnheader">Delivery</span><span role="columnheader">Balance</span><span role="columnheader">Status</span><span role="columnheader">Updated</span><span />
            </div>
            {filteredInvoices.map((invoice) => {
              const job = data.jobs.find((candidate) => candidate.id === invoice.jobId);
              const customer = data.customers.find((candidate) => candidate.id === job?.customerId);
              const total = invoice.selectedTier ? selectedTotal(invoice) : undefined;
              return (
                <Link key={invoice.id} href={`/invoices/${invoice.id}`} className={styles.row} role="row">
                  <span className={styles.invoiceCell} role="cell" data-label="Invoice"><strong>{invoice.invoiceNumber}</strong><small>{invoiceOptionLabels[invoice.optionLabel]}</small></span>
                  <span className={styles.customerCell} role="cell" data-label="Customer"><strong>{customer?.name ?? "Unknown customer"}</strong><small>{job?.description ?? "Service invoice"}</small></span>
                  <span className={styles.deliveryCell} role="cell" data-label="Delivery"><strong>{invoice.sentAt ? `Recorded ${formatDateTime(invoice.sentAt)}` : customer?.email ? "Ready for delivery" : "Email required"}</strong><small>{invoice.sentToEmail ?? customer?.email ?? "Add customer email"}</small></span>
                  <span className={styles.moneyCell} role="cell" data-label="Balance"><strong>{total === undefined ? "—" : money(Math.max(0, total - invoice.amountPaid))}</strong><small>{total === undefined ? "Select approved work" : `${money(total)} total`}</small></span>
                  <span role="cell" data-label="Status"><span className={styles.status} data-status={displayStatus(invoice)}>{displayStatus(invoice)}</span></span>
                  <span className={styles.dateCell} role="cell" data-label="Updated">{formatDateTime(invoice.updatedAt || invoice.createdAt)}</span>
                  <ArrowRight className={styles.arrow} size={17} aria-hidden="true" />
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}

function invoiceBalance(invoice: Invoice) {
  if (!invoice.selectedTier) return 0;
  return Math.max(0, selectedTotal(invoice) - invoice.amountPaid);
}

function displayStatus(invoice: Invoice) {
  if (invoice.paymentStatus === "paid") return "Paid";
  if (invoice.paymentStatus === "partially_paid") return "Partial";
  if (invoice.status === "sent") return "Unpaid";
  if (invoice.approvalStatus === "signed") return "Approved";
  return "Draft";
}
