"use client";

import Link from "next/link";
import { CalendarPlus } from "lucide-react";
import { useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { useAppData } from "@/lib/data-store";
import { canScheduleJobs, canViewInvoice, canViewJob } from "@/lib/access";
import { formatDateTime } from "@/lib/date";
import { money } from "@/lib/money";
import { ButtonLink, Card, EmptyState, PageHeader, StatusPill } from "@/components/ui";
import { GlobalSearch } from "@/components/GlobalSearch";
import { OperationsChart } from "@/components/OperationsChart";

const roleActions = {
  owner: [
    { title: "Parts", body: "Catalog pricing.", href: "/parts" },
    { title: "Users", body: "Allowed access.", href: "/admin/users" }
  ],
  tech: [
    { title: "Customer", body: "Create record.", href: "/customers/new?next=job" },
    { title: "Assigned", body: "Open work.", href: "/jobs" }
  ],
  call_center: [
    { title: "Customers", body: "Find records.", href: "/customers" },
    { title: "New", body: "Create customer.", href: "/customers/new" }
  ]
};

export default function DashboardPage() {
  const { currentUser } = useAuth();
  const data = useAppData();
  const visibleJobs = useMemo(() => data.jobs.filter((job) => canViewJob(currentUser, job)), [currentUser, data.jobs]);
  const visibleInvoices = useMemo(
    () => data.invoices.filter((invoice) => canViewInvoice(currentUser, invoice, data.jobs)),
    [currentUser, data.invoices, data.jobs]
  );
  const draftInvoices = visibleInvoices.filter((invoice) => invoice.status === "draft");
  const invoiceQueue = visibleInvoices.slice(0, 4);
  const completedJobs = visibleJobs.filter((job) => job.status === "complete").length;
  const dashboardTitle = currentUser.role === "owner" ? "Operations" : currentUser.role === "tech" ? "Today" : "Desk";
  const queueJobs = visibleJobs.slice(0, 5);

  return (
    <main className="page-shell dashboard-page">
      <PageHeader
        title={dashboardTitle}
      />

      {canScheduleJobs(currentUser.role) ? (
        <Link href="/jobs/new" className="primary-job-action">
          <span className="primary-job-icon" aria-hidden="true">
            <CalendarPlus size={22} />
          </span>
          <span>
            <strong>New job</strong>
            <small>Create the customer, service address, schedule, and assigned tech in one flow.</small>
          </span>
        </Link>
      ) : null}

      <section className="ops-strip" aria-label="Operations summary">
        <div className="ops-stat">
          <strong>{visibleJobs.length}</strong>
          <span>{currentUser.role === "tech" ? "assigned" : "jobs"}</span>
        </div>
        <div className="ops-stat">
          <strong>{draftInvoices.length}</strong>
          <span>drafts</span>
        </div>
        <div className="ops-stat">
          <strong>{completedJobs}</strong>
          <span>complete</span>
        </div>
      </section>

      <section className="dashboard-overview-grid">
        <Card className="ops-chart-card">
          <div className="section-head">
            <div>
              <h2>Workload</h2>
              <p className="subtle-copy">Scheduled work and completed jobs.</p>
            </div>
            <StatusPill tone="neutral">schedule</StatusPill>
          </div>
          <OperationsChart
            jobs={visibleJobs}
            invoices={visibleInvoices}
            canSeeMoney={currentUser.role !== "call_center"}
          />
        </Card>

        <section className="quick-action-grid quick-action-grid-compact" aria-label="Quick actions">
          {roleActions[currentUser.role].map((action) => (
            <Link key={action.title} href={action.href} className="quick-action-card">
              <span className="quick-action-arrow">→</span>
              <strong>{action.title}</strong>
              <p>{action.body}</p>
            </Link>
          ))}
        </section>
      </section>

      {currentUser.role === "call_center" ? (
        <Card className="search-command-card">
          <p className="eyebrow">Customer lookup</p>
          <GlobalSearch />
          <div className="action-row">
            <ButtonLink href="/customers/new">Create customer</ButtonLink>
            <ButtonLink href="/jobs/new" variant="secondary">Schedule job</ButtonLink>
          </div>
        </Card>
      ) : null}

      <section className="dashboard-grid dashboard-grid-single">
        <Card>
          <div className="section-head">
            <div>
              <h2>Queue</h2>
            </div>
            <div className="action-row">
              <Link href="/jobs" className="text-link">All jobs</Link>
              {currentUser.role !== "call_center" ? <Link href="/invoices" className="text-link">Invoices</Link> : null}
            </div>
          </div>
          {queueJobs.length === 0 && invoiceQueue.length === 0 ? (
            <EmptyState title="No work yet" description="Create a job to start." action={canScheduleJobs(currentUser.role) ? <ButtonLink href="/jobs/new">New job</ButtonLink> : undefined} />
          ) : (
            <div className="queue-list">
              {queueJobs.map((job) => {
                const customer = data.customers.find((candidate) => candidate.id === job.customerId);
                return (
                  <Link key={job.id} href={`/jobs/${job.id}`} className="record-row job-row">
                    <div className="record-main">
                      <strong>{customer?.name ?? "Unknown customer"}</strong>
                      <span>{job.description}</span>
                    </div>
                    <div className="record-meta">
                      <span>{formatDateTime(job.scheduledAt)}</span>
                    </div>
                    <div className="record-side">
                      <StatusPill tone={job.status === "complete" ? "good" : job.status === "cancelled" ? "bad" : "info"}>{job.status.replace("_", " ")}</StatusPill>
                    </div>
                  </Link>
                );
              })}
              {currentUser.role !== "call_center" && invoiceQueue.map((invoice) => {
                  const job = data.jobs.find((candidate) => candidate.id === invoice.jobId);
                  const customer = data.customers.find((candidate) => candidate.id === job?.customerId);
                  return (
                    <Link key={invoice.id} href={`/invoices/${invoice.id}`} className="record-row invoice-row">
                      <div className="record-main">
                        <strong>{invoice.invoiceNumber}</strong>
                        <span>{customer?.name ?? "Unknown customer"}</span>
                      </div>
                      <div className="record-meta">
                        <span>{money(invoice.totalBest)}</span>
                      </div>
                      <div className="record-side">
                        <StatusPill tone="warn">draft</StatusPill>
                      </div>
                    </Link>
                  );
                })}
            </div>
          )}
        </Card>
      </section>
    </main>
  );
}
