"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useAppData } from "@/lib/data-store";
import { canScheduleJobs, canViewCustomer } from "@/lib/access";
import { canEditCustomers } from "@/lib/access";
import { formatPhone } from "@/lib/phone";
import { compareJobsForDispatch } from "@/lib/service-window";
import { ButtonLink, EmptyState, PageHeader } from "@/components/ui";
import type { Customer } from "@/lib/types";

export default function CustomersPage() {
  const { currentUser } = useAuth();
  const data = useAppData();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Customer[]>([]);
  const visibleCustomers = useMemo(
    () => data.customers.filter((customer) => canViewCustomer(currentUser, customer, data.jobs)),
    [currentUser, data.customers, data.jobs]
  );
  const visibleCustomerIds = useMemo(() => new Set(visibleCustomers.map((customer) => customer.id)), [visibleCustomers]);
  const visibleCustomerJobs = useMemo(
    () => data.jobs.filter((job) => visibleCustomerIds.has(job.customerId)),
    [data.jobs, visibleCustomerIds]
  );

  useEffect(() => {
    let active = true;
    if (!query.trim()) {
      setResults(visibleCustomers);
      return;
    }

    void data.searchCustomers(query, visibleCustomers).then((customers) => {
      if (active) setResults(customers);
    });

    return () => {
      active = false;
    };
  }, [data, query, visibleCustomers]);

  return (
    <main className="page-shell">
      <PageHeader
        eyebrow="Records"
        title="Customers"
        action={
          <div className="action-row">
            {canEditCustomers(currentUser.role) ? <ButtonLink href="/customers/new">Create customer</ButtonLink> : null}
            {canScheduleJobs(currentUser.role) ? <ButtonLink href="/jobs/new" variant="secondary">Schedule service</ButtonLink> : null}
          </div>
        }
      />
      <section className="customer-workspace">
        <div className="customer-list-panel">
          <div className="operations-toolbar">
            <input className="big-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, phone, street, zip" />
          </div>
          <div className="record-list customer-record-list">
            {results.length === 0 ? (
              <EmptyState
                title={query.trim() ? "No matching customer" : "No customers yet"}
                description={query.trim() ? "Create the customer if this is a new call." : "Create a customer first, then schedule service from that record."}
                action={canEditCustomers(currentUser.role) ? <ButtonLink href="/customers/new">Create customer</ButtonLink> : undefined}
              />
            ) : (
              results.map((customer) => {
                const customerJobs = data.jobs.filter((job) => job.customerId === customer.id);
                const nextJob = customerJobs
                  .filter((job) => job.status !== "complete" && job.status !== "cancelled")
                  .sort(compareJobsForDispatch)[0];
                return (
                  <Link key={customer.id} href={`/customers/${customer.id}`} className="record-row customer-row">
                    <div className="record-main">
                      <strong>{customer.name}</strong>
                      <span>{customer.addressLine1}{customer.addressLine2 ? ` ${customer.addressLine2}` : ""}</span>
                    </div>
                    <div className="record-meta">
                      <span>{formatPhone(customer.phone)}</span>
                      <small>{customer.email ?? "No email"}</small>
                    </div>
                    <div className="record-side">
                      <span>{customerJobs.length} {customerJobs.length === 1 ? "job" : "jobs"}</span>
                      <small>{nextJob ? nextJob.status.replace("_", " ") : `${customer.city}, ${customer.state} ${customer.zip}`}</small>
                    </div>
                  </Link>
                );
              })
            )}
          </div>
        </div>
        <aside className="customer-side-panel">
          <div className="ops-stat-card">
            <strong>{visibleCustomers.length}</strong>
            <span>customers</span>
          </div>
          <div className="ops-stat-card">
            <strong>{visibleCustomerJobs.length}</strong>
            <span>linked jobs</span>
          </div>
          <div className="intake-guide">
            <p className="eyebrow">Intake</p>
            <h2>Customer first</h2>
            <p className="muted">Use this screen to find or create the customer. Job scheduling should start from a known customer record so history, phone, address, and invoices stay connected.</p>
            <div className="action-row">
              {canEditCustomers(currentUser.role) ? <ButtonLink href="/customers/new">New customer</ButtonLink> : null}
              {canScheduleJobs(currentUser.role) ? <ButtonLink href="/jobs/new" variant="secondary">Schedule service</ButtonLink> : null}
            </div>
          </div>
        </aside>
      </section>
    </main>
  );
}
