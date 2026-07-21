"use client";

import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  CalendarPlus,
  CircleAlert,
  FileText,
  MapPin,
  Search,
  UserPlus,
  UserRound
} from "lucide-react";
import { useMemo } from "react";
import { GlobalSearch } from "@/components/GlobalSearch";
import { canCreateCustomers, canScheduleJobs, canViewInvoice, canViewJob } from "@/lib/access";
import { useAuth } from "@/lib/auth";
import { useAppData } from "@/lib/data-store";
import { formatDateTime, formatTime } from "@/lib/date";
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

  if (currentUser.role === "tech") {
    const currentJob = activeJobs.find((job) => job.status === "in_progress") ?? activeJobs[0];
    const upcomingJobs = activeJobs.filter((job) => job.id !== currentJob?.id);
    const currentCustomer = currentJob
      ? data.customers.find((candidate) => candidate.id === currentJob.customerId)
      : undefined;

    return (
      <main className={`page-shell ${styles.page} ${styles.techPage}`}>
        <header className={`${styles.hero} ${styles.techHero}`}>
          <div className={styles.heroCopy}>
            <p className={styles.kicker}>Technician workspace</p>
            <h1>Today’s work</h1>
            <p className={styles.techWelcome}>Stay focused on the job in front of you and what comes next.</p>
          </div>
          <Link href="/customers/new" className={styles.techCustomerAction}>
            <UserPlus size={18} aria-hidden="true" />
            New customer
          </Link>
        </header>

        <section className={styles.techCurrentSection} aria-labelledby="current-job-heading">
          <div className={styles.techSectionHeading}>
            <div>
              <p className={styles.sectionLabel}>Your route</p>
              <h2 id="current-job-heading">Current job</h2>
            </div>
            <Link href="/jobs" className={styles.textLink}>Full schedule <ArrowRight size={16} aria-hidden="true" /></Link>
          </div>

          {currentJob ? (
            <article className={styles.techCurrentCard}>
              <div className={styles.techCurrentMain}>
                <span className={`${styles.status} ${styles[`status_${currentJob.status}`]}`}>{jobStatusLabels[currentJob.status]}</span>
                <h3>{currentCustomer?.name ?? "Unknown customer"}</h3>
                <p>{currentJob.description}</p>
              </div>
              <div className={styles.techCurrentFacts}>
                <span>
                  <CalendarDays size={18} aria-hidden="true" />
                  <span><small>Arrival window</small><strong>{formatServiceWindow(currentJob.scheduledAt, currentJob.arrivalWindowEndAt)}</strong></span>
                </span>
                <span>
                  <MapPin size={18} aria-hidden="true" />
                  <span><small>Service address</small><strong>{currentJob.serviceAddress}</strong></span>
                </span>
              </div>
              <div className={styles.techCurrentActions}>
                <Link href={`/jobs/${currentJob.id}`} className={styles.techOpenJob}>
                  {currentJob.status === "in_progress" ? "Open current job" : "Open next job"}
                  <ArrowRight size={18} aria-hidden="true" />
                </Link>
                <a href={mapsHref(currentJob.serviceAddress)} target="_blank" rel="noreferrer" className={styles.techDirections}>
                  <MapPin size={17} aria-hidden="true" />
                  Directions
                </a>
              </div>
            </article>
          ) : (
            <div className={styles.techEmptyState}>
              <span aria-hidden="true"><CalendarDays size={22} /></span>
              <div><strong>No assigned work</strong><p>New assignments will appear here when dispatch schedules them.</p></div>
            </div>
          )}
        </section>

        <section className={styles.techUpcomingSection} aria-labelledby="up-next-heading">
          <div className={styles.techSectionHeading}>
            <div>
              <p className={styles.sectionLabel}>Later</p>
              <h2 id="up-next-heading">Up next</h2>
            </div>
          </div>
          {upcomingJobs.length > 0 ? (
            <div className={styles.techUpcomingList}>
              {upcomingJobs.slice(0, 5).map((job) => {
                const customer = data.customers.find((candidate) => candidate.id === job.customerId);
                return (
                  <Link key={job.id} href={`/jobs/${job.id}`} className={styles.techUpcomingRow}>
                    <span className={styles.techUpcomingTime}>
                      <CalendarDays size={17} aria-hidden="true" />
                      <strong>{formatServiceWindow(job.scheduledAt, job.arrivalWindowEndAt)}</strong>
                    </span>
                    <span className={styles.techUpcomingMain}>
                      <strong>{customer?.name ?? "Unknown customer"}</strong>
                      <small>{job.description} · {job.serviceAddress}</small>
                    </span>
                    <ArrowRight size={18} aria-hidden="true" />
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className={styles.techUpcomingEmpty}>Nothing else is assigned after the current job.</div>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className={`page-shell ${styles.page}`}>
      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <h1>{dashboardTitle(currentUser.role)}</h1>
        </div>

        <div className={styles.actionGroup} aria-label="Quick actions">
          {canCreateCustomers(currentUser.role) ? (
            <Link href="/customers/new" className={styles.primaryAction}>
              <UserPlus size={19} aria-hidden="true" />
              Create customer
            </Link>
          ) : null}
          {canScheduleJobs(currentUser.role) ? (
            <Link href="/jobs/new" className={styles.secondaryAction}>
              <CalendarPlus size={19} aria-hidden="true" />
              Schedule service
            </Link>
          ) : null}
        </div>
      </header>

      <section className={styles.workloadPanel} aria-labelledby="workload-heading">
        <div className={styles.sectionHeading}>
          <h2 id="workload-heading">Workload</h2>
          <Link href="/jobs" className={styles.textLink}>View schedule <ArrowRight size={16} aria-hidden="true" /></Link>
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

      </section>

      {isCallCenter ? (
        <section className={styles.lookupPanel} aria-labelledby="customer-lookup-heading">
          <div className={styles.lookupIcon} aria-hidden="true"><Search size={19} /></div>
          <div>
            <h2 id="customer-lookup-heading">Find a customer</h2>
            <p>Search contact details before scheduling or updating a service call.</p>
          </div>
          <GlobalSearch />
        </section>
      ) : null}

      <section className={styles.queuePanel} aria-labelledby="job-queue-heading">
        <div className={styles.sectionHeading}>
          <h2 id="job-queue-heading">Open jobs</h2>
          <Link href="/jobs" className={styles.textLink}>View all <ArrowRight size={16} aria-hidden="true" /></Link>
        </div>

        {activeJobs.length === 0 ? (
          <div className={styles.emptyState}>
            <span aria-hidden="true"><CalendarPlus size={22} /></span>
            <div>
              <strong>No open jobs</strong>
              <p>Your active service queue is clear.</p>
            </div>
          </div>
        ) : (
          <div className={styles.jobTable} role="table" aria-label="Open job queue">
            <div className={styles.tableHeader} role="row">
              <span role="columnheader">Customer</span>
              <span role="columnheader">Visit</span>
              <span role="columnheader">Technician</span>
              <span role="columnheader">State</span>
            </div>
            {activeJobs.slice(0, 5).map((job) => {
              const customer = data.customers.find((candidate) => candidate.id === job.customerId);
              const tech = data.allowedUsers.find((candidate) => candidate.id === job.assignedTechId);
              const arrival = arrivalDetails(job, now);

              return (
                <Link key={job.id} href={`/jobs/${job.id}`} className={styles.jobRow} role="row">
                  <span className={styles.customerCell} role="cell" data-label="Customer">
                    <strong>{customer?.name ?? "Unknown customer"}</strong>
                    <small>{job.description}</small>
                  </span>
                  <span className={styles.windowCell} role="cell" data-label="Visit">
                    <strong>{formatServiceWindow(job.scheduledAt, job.arrivalWindowEndAt)}</strong>
                    <small>{job.serviceAddress}</small>
                  </span>
                  <span className={styles.workerCell} role="cell" data-label="Technician">
                    <span className={styles.workerIcon} aria-hidden="true"><UserRound size={16} /></span>
                    <strong>{tech?.displayName ?? "Unassigned"}</strong>
                  </span>
                  <span className={styles.arrivalCell} role="cell" data-label="State">
                    <strong>{arrival.label}</strong>
                    {arrival.exception ? <small className={styles.exception}><CircleAlert size={13} aria-hidden="true" /> {arrival.exception}</small> : <small>{arrival.detail}</small>}
                    <span className={`${styles.status} ${styles[`status_${job.status}`]}`}>{jobStatusLabels[job.status]}</span>
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {!isCallCenter && invoiceTasks.length > 0 ? (
        <section className={styles.queuePanel} aria-labelledby="invoice-tasks-heading">
          <div className={styles.sectionHeading}>
            <h2 id="invoice-tasks-heading">Invoice tasks</h2>
            <Link href="/invoices" className={styles.textLink}>View invoices <ArrowRight size={16} aria-hidden="true" /></Link>
          </div>

          <div className={styles.invoiceList} aria-label="Invoice tasks">
              {invoiceTasks.slice(0, 3).map((invoice) => {
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
                    {!customerEmail ? <span className={styles.invoiceBlocker}>Email needed</span> : null}
                    <span className={`${styles.status} ${styles[`invoice_${invoice.status}`]}`}>{invoiceStatusLabels[invoice.status]}</span>
                    <span className={styles.invoiceDate}>{formatDateTime(invoice.updatedAt || invoice.createdAt)}</span>
                    <ArrowRight className={styles.rowArrow} size={17} aria-hidden="true" />
                  </Link>
                );
              })}
          </div>
        </section>
      ) : null}
    </main>
  );
}

function dashboardTitle(role: "owner" | "tech" | "call_center") {
  if (role === "tech") return "Today’s work";
  if (role === "call_center") return "Service desk";
  return "Operations";
}

function mapsHref(address: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

function arrivalDetails(job: Job, now: number) {
  const timing = getServiceWindowTiming(job, now);
  if (job.arrivedAt) {
    const arrived = formatTime(job.arrivedAt);
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
