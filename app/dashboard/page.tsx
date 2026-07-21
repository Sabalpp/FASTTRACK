"use client";

import Link from "next/link";
import {
  ArrowRight,
  CalendarPlus,
  CircleAlert,
  FileText,
  Search,
  UserRound
} from "lucide-react";
import { useMemo } from "react";
import { GlobalSearch } from "@/components/GlobalSearch";
import { OperationsChart } from "@/components/OperationsChart";
import { canScheduleJobs, canViewInvoice, canViewJob } from "@/lib/access";
import { useAuth } from "@/lib/auth";
import { roleLabels, useAppData } from "@/lib/data-store";
import { formatDateTime } from "@/lib/date";
import {
  compareJobsForDispatch,
  formatServiceWindow,
  getServiceWindowTiming
} from "@/lib/service-window";
import type { InvoiceStatus, Job, JobStatus } from "@/lib/types";
import { useCurrentTime } from "@/lib/use-current-time";
import styles from "./dashboard.module.css";

const jobStatusLabels: Record<JobStatus, string> = {
  scheduled: "Scheduled",
  in_progress: "In progress",
  complete: "Complete",
  cancelled: "Cancelled"
};

const invoiceStatusLabels: Record<InvoiceStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  paid: "Paid",
  cancelled: "Cancelled"
};

export default function DashboardPage() {
  const { currentUser } = useAuth();
  const data = useAppData();
  const now = useCurrentTime();

  const visibleJobs = useMemo(
    () => data.jobs.filter((job) => canViewJob(currentUser, job)),
    [currentUser, data.jobs]
  );
  const activeJobs = useMemo(
    () => visibleJobs
      .filter((job) => job.status !== "complete" && job.status !== "cancelled")
      .sort((a, b) => compareJobsForDispatch(a, b, now)),
    [now, visibleJobs]
  );
  const visibleInvoices = useMemo(
    () => data.invoices
      .filter((invoice) => canViewInvoice(currentUser, invoice, data.jobs))
      .sort((a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt)),
    [currentUser, data.invoices, data.jobs]
  );
  const invoiceTasks = visibleInvoices.filter((invoice) => invoice.status !== "paid" && invoice.status !== "cancelled");
  const arrivalExceptions = activeJobs.filter((job) => getServiceWindowTiming(job, now).tone === "bad").length;
  const inProgressJobs = activeJobs.filter((job) => job.status === "in_progress").length;
  const draftInvoices = visibleInvoices.filter((invoice) => invoice.status === "draft").length;
  const isCallCenter = currentUser.role === "call_center";

  return (
    <main className={`page-shell ${styles.page}`}>
      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.kicker}>{dashboardKicker(currentUser.role)}</p>
          <h1>{dashboardTitle(currentUser.role)}</h1>
          <div className={styles.identityLine}>
            <span className={styles.avatar} aria-hidden="true">{initials(currentUser.displayName)}</span>
            <span>
              <strong>{currentUser.displayName}</strong>
              <small>{roleLabels[currentUser.role]}</small>
            </span>
          </div>
        </div>

        {canScheduleJobs(currentUser.role) ? (
          <Link href="/jobs/new" className={styles.primaryAction}>
            <CalendarPlus size={19} aria-hidden="true" />
            Schedule service
          </Link>
        ) : null}
      </header>

      <section className={styles.workloadPanel} aria-labelledby="workload-heading">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.sectionLabel}>Live operations</p>
            <h2 id="workload-heading">Workload</h2>
            <p>Scheduled, active, and completed service calls by day.</p>
          </div>
          <Link href="/jobs" className={styles.textLink}>View all jobs <ArrowRight size={16} aria-hidden="true" /></Link>
        </div>

        <div className={styles.workloadMetrics} aria-label="Current workload summary">
          <div>
            <strong>{activeJobs.length}</strong>
            <span>Open jobs</span>
          </div>
          <div>
            <strong>{inProgressJobs}</strong>
            <span>In progress</span>
          </div>
          <div className={arrivalExceptions > 0 ? styles.metricAttention : undefined}>
            <strong>{arrivalExceptions}</strong>
            <span>Arrival exceptions</span>
          </div>
          {!isCallCenter ? (
            <div>
              <strong>{draftInvoices}</strong>
              <span>Invoice drafts</span>
            </div>
          ) : null}
        </div>

        <div className={styles.chartWrap}>
          <OperationsChart jobs={visibleJobs} />
        </div>
      </section>

      {isCallCenter ? (
        <section className={styles.lookupPanel} aria-labelledby="customer-lookup-heading">
          <div className={styles.lookupIcon} aria-hidden="true"><Search size={19} /></div>
          <div>
            <h2 id="customer-lookup-heading">Find a customer</h2>
            <p>Search contact details before scheduling or updating a service call.</p>
          </div>
          <GlobalSearch />
          <Link href="/customers/new" className={styles.secondaryAction}>Create customer</Link>
        </section>
      ) : null}

      <section className={styles.queuePanel} aria-labelledby="job-queue-heading">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.sectionLabel}>{currentUser.role === "tech" ? "Your route" : "Dispatch"}</p>
            <h2 id="job-queue-heading">{currentUser.role === "tech" ? "Your job queue" : "Job queue"}</h2>
            <p>Service windows, assigned workers, and recorded arrival details.</p>
          </div>
          <Link href="/jobs" className={styles.textLink}>All jobs <ArrowRight size={16} aria-hidden="true" /></Link>
        </div>

        {activeJobs.length === 0 ? (
          <div className={styles.emptyState}>
            <span aria-hidden="true"><CalendarPlus size={22} /></span>
            <div>
              <strong>No open jobs</strong>
              <p>{currentUser.role === "tech" ? "New assignments will appear here." : "Your active service queue is clear."}</p>
            </div>
          </div>
        ) : (
          <div className={styles.jobTable} role="table" aria-label="Open job queue">
            <div className={styles.tableHeader} role="row">
              <span role="columnheader">Customer</span>
              <span role="columnheader">Worker</span>
              <span role="columnheader">Service window</span>
              <span role="columnheader">Arrival</span>
              <span role="columnheader">Status</span>
            </div>
            {activeJobs.slice(0, 7).map((job) => {
              const customer = data.customers.find((candidate) => candidate.id === job.customerId);
              const tech = data.allowedUsers.find((candidate) => candidate.id === job.assignedTechId);
              const arrival = arrivalDetails(job, now);

              return (
                <Link key={job.id} href={`/jobs/${job.id}`} className={styles.jobRow} role="row">
                  <span className={styles.customerCell} role="cell" data-label="Customer">
                    <strong>{customer?.name ?? "Unknown customer"}</strong>
                    <small>{job.description}</small>
                  </span>
                  <span className={styles.workerCell} role="cell" data-label="Worker">
                    <span className={styles.workerIcon} aria-hidden="true"><UserRound size={16} /></span>
                    <span>
                      <strong>{tech?.displayName ?? "Unassigned"}</strong>
                      <small>{tech ? roleLabels[tech.role] : "Technician"}</small>
                    </span>
                  </span>
                  <span className={styles.windowCell} role="cell" data-label="Service window">
                    <strong>{formatServiceWindow(job.scheduledAt, job.arrivalWindowEndAt)}</strong>
                    <small>{job.serviceAddress}</small>
                  </span>
                  <span className={styles.arrivalCell} role="cell" data-label="Arrival">
                    <strong>{arrival.label}</strong>
                    {arrival.exception ? <small className={styles.exception}><CircleAlert size={13} aria-hidden="true" /> {arrival.exception}</small> : <small>{arrival.detail}</small>}
                  </span>
                  <span className={styles.statusCell} role="cell" data-label="Status">
                    <span className={`${styles.status} ${styles[`status_${job.status}`]}`}>{jobStatusLabels[job.status]}</span>
                    <ArrowRight size={17} aria-hidden="true" />
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {!isCallCenter ? (
        <section className={styles.queuePanel} aria-labelledby="invoice-tasks-heading">
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.sectionLabel}>Billing</p>
              <h2 id="invoice-tasks-heading">Invoice tasks</h2>
              <p>Drafts and sent invoices that still need attention.</p>
            </div>
            <Link href="/invoices" className={styles.textLink}>All invoices <ArrowRight size={16} aria-hidden="true" /></Link>
          </div>

          {invoiceTasks.length === 0 ? (
            <div className={styles.emptyState}>
              <span aria-hidden="true"><FileText size={22} /></span>
              <div><strong>No invoice tasks</strong><p>Nothing needs billing attention right now.</p></div>
            </div>
          ) : (
            <div className={styles.invoiceList} aria-label="Invoice tasks">
              {invoiceTasks.slice(0, 5).map((invoice) => {
                const job = data.jobs.find((candidate) => candidate.id === invoice.jobId);
                const customer = data.customers.find((candidate) => candidate.id === job?.customerId);
                const customerEmail = invoice.sentToEmail ?? customer?.email;
                return (
                  <Link key={invoice.id} href={`/invoices/${invoice.id}`} className={styles.invoiceRow}>
                    <span className={styles.invoiceIcon} aria-hidden="true"><FileText size={18} /></span>
                    <span className={styles.invoiceMain}>
                      <strong>{invoice.invoiceNumber}</strong>
                      <small>{customer?.name ?? "Unknown customer"}</small>
                    </span>
                    <span className={styles.invoiceDelivery}>
                      <strong>{customerEmail ? "Customer email" : "Email needed"}</strong>
                      <small>{customerEmail ?? "Add an email before sending"}</small>
                    </span>
                    <span className={`${styles.status} ${styles[`invoice_${invoice.status}`]}`}>{invoiceStatusLabels[invoice.status]}</span>
                    <span className={styles.invoiceDate}>{formatDateTime(invoice.updatedAt || invoice.createdAt)}</span>
                    <ArrowRight className={styles.rowArrow} size={17} aria-hidden="true" />
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      ) : null}
    </main>
  );
}

function dashboardKicker(role: "owner" | "tech" | "call_center") {
  if (role === "tech") return "Technician workspace";
  if (role === "call_center") return "Call center workspace";
  return "Owner workspace";
}

function dashboardTitle(role: "owner" | "tech" | "call_center") {
  if (role === "tech") return "Today’s work";
  if (role === "call_center") return "Service desk";
  return "Operations overview";
}

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "FT";
}

function arrivalDetails(job: Job, now: number) {
  const timing = getServiceWindowTiming(job, now);
  if (job.arrivedAt) {
    const arrived = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(job.arrivedAt));
    return {
      label: `Arrived ${arrived}`,
      detail: timing.tone === "info" ? "Before window" : timing.tone === "good" ? "Within window" : undefined,
      exception: timing.tone === "bad" ? "Outside window" : undefined
    };
  }

  if (job.status === "in_progress") {
    return {
      label: "Arrival not recorded",
      detail: timing.tone === "bad" ? undefined : "Work is in progress",
      exception: timing.tone === "bad" ? "Window exceeded" : undefined
    };
  }

  return {
    label: "Awaiting arrival",
    detail: timing.tone === "warn" ? "Window ending soon" : "Not recorded",
    exception: timing.tone === "bad" ? "Window exceeded" : undefined
  };
}
