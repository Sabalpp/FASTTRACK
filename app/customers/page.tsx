"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useAppData } from "@/lib/data-store";
import { canCreateCustomers, canViewCustomer } from "@/lib/access";
import { formatPhone } from "@/lib/phone";
import { compareJobsForDispatch, formatServiceWindow } from "@/lib/service-window";
import { ButtonLink, EmptyState, PageHeader } from "@/components/ui";
import type { Customer } from "@/lib/types";
import styles from "./customers.module.css";

export default function CustomersPage() {
  const { currentUser } = useAuth();
  const data = useAppData();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Customer[]>([]);
  const visibleCustomers = useMemo(
    () => data.customers.filter((customer) => canViewCustomer(currentUser, customer, data.jobs)),
    [currentUser, data.customers, data.jobs]
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
        title="Customers"
        action={
          canCreateCustomers(currentUser.role) ? <ButtonLink href="/customers/new">Create customer</ButtonLink> : undefined
        }
      />
      <section className={styles.workspace}>
        <div className={styles.listPanel}>
          <div className="operations-toolbar">
            <label className={styles.searchLabel} htmlFor="customer-search">Find a customer</label>
            <input
              id="customer-search"
              className="big-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name, phone, address, or ZIP"
            />
          </div>
          <div className={`record-list ${styles.recordList}`}>
            {results.length === 0 ? (
              <EmptyState
                title={query.trim() ? "No matching customer" : "No customers yet"}
                description={query.trim() ? "Create the customer if this is a new call." : "Create a customer first, then schedule service from that record."}
                action={canCreateCustomers(currentUser.role) ? <ButtonLink href="/customers/new">Create customer</ButtonLink> : undefined}
              />
            ) : (
              results.map((customer) => {
                const customerJobs = data.jobs.filter((job) => job.customerId === customer.id);
                const nextJob = customerJobs
                  .filter((job) => job.status !== "complete" && job.status !== "cancelled")
                  .sort(compareJobsForDispatch)[0];
                const address = [
                  customer.addressLine1,
                  customer.addressLine2,
                  `${customer.city}, ${customer.state} ${customer.zip}`
                ].filter(Boolean).join(" · ");
                const jobFact = nextJob
                  ? `Next visit ${formatServiceWindow(nextJob.scheduledAt, nextJob.arrivalWindowEndAt)}`
                  : customerJobs.length > 0
                    ? `${customerJobs.length} previous ${customerJobs.length === 1 ? "job" : "jobs"}`
                    : "No jobs yet";
                return (
                  <Link key={customer.id} href={`/customers/${customer.id}`} className={`record-row ${styles.customerRow}`}>
                    <div className={`record-main ${styles.identity}`}>
                      <strong>{customer.name}</strong>
                      <span>{address}</span>
                    </div>
                    <div className={`record-meta ${styles.contact}`}>
                      <span>{formatPhone(customer.phone)}</span>
                      <small>{customer.email ?? "No email"}</small>
                    </div>
                    <div className={`record-side ${styles.jobFact}`}>
                      <span>{jobFact}</span>
                    </div>
                  </Link>
                );
              })
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
