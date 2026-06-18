"use client";

import Link from "next/link";
import { CalendarPlus, Clock3, FileText, Package, Users } from "lucide-react";
import { useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { useAppData } from "@/lib/data-store";
import { canScheduleJobs, canViewInvoice, canViewJob } from "@/lib/access";
import { formatDateTime } from "@/lib/date";
import { ButtonLink, Card, EmptyState, StatusPill } from "@/components/ui";
import { GlobalSearch } from "@/components/GlobalSearch";
import { OperationsChart } from "@/components/OperationsChart";

const roleActions = {
  owner: [
    { title: "Parts", body: "Catalog", href: "/parts", Icon: Package },
    { title: "Users", body: "Access", href: "/admin/users", Icon: Users }
  ],
  tech: [
    { title: "Customer", body: "Create", href: "/customers/new?next=job", Icon: Users },
    { title: "Assigned", body: "Open work", href: "/jobs", Icon: FileText }
  ],
  call_center: [
    { title: "Customers", body: "Find", href: "/customers", Icon: Users },
    { title: "New", body: "Create", href: "/customers/new", Icon: CalendarPlus }
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
  const invoiceQueue = visibleInvoices.slice(0, 5);
  const completedJobs = visibleJobs.filter((job) => job.status === "complete").length;
  const activeJobs = visibleJobs.filter((job) => job.status !== "complete" && job.status !== "cancelled");
  const dashboardTitle = currentUser.role === "owner" ? "Operations" : currentUser.role === "tech" ? "Today" : "Desk";
  const queueJobs = activeJobs.slice(0, 6);
  const workItems = [
    ...queueJobs.map((job) => {
      const customer = data.customers.find((candidate) => candidate.id === job.customerId);
      const tech = data.allowedUsers.find((candidate) => candidate.id === job.assignedTechId);
      return {
        id: job.id,
        href: `/jobs/${job.id}`,
        type: "Job",
        title: customer?.name ?? "Unknown customer",
        detail: job.description,
        owner: tech?.displayName ?? "Unassigned",
        date: formatDateTime(job.scheduledAt),
        status: job.status.replace("_", " "),
        tone: job.status === "complete" ? "good" as const : job.status === "cancelled" ? "bad" as const : "info" as const
      };
    }),
    ...invoiceQueue.map((invoice) => {
      const job = data.jobs.find((candidate) => candidate.id === invoice.jobId);
      const customer = data.customers.find((candidate) => candidate.id === job?.customerId);
      return {
        id: invoice.id,
        href: `/invoices/${invoice.id}`,
        type: "Invoice",
        title: invoice.invoiceNumber,
        detail: customer?.name ?? "Unknown customer",
        owner: invoice.sentToEmail ?? "Not sent",
        date: invoice.createdAt ? formatDateTime(invoice.createdAt) : "",
        status: invoice.status,
        tone: invoice.status === "paid" ? "good" as const : invoice.status === "cancelled" ? "bad" as const : "warn" as const
      };
    })
  ].slice(0, 8);

  return (
    <main className="page-shell dashboard-page shad-dashboard-page">
      <section className="dashboard-site-header">
        <div>
          <h1>{dashboardTitle}</h1>
        </div>
      </section>

      <section className="dashboard-section-cards" aria-label="Dashboard summary">
        {canScheduleJobs(currentUser.role) ? (
          <Link href="/jobs/new" className="dashboard-section-card dashboard-section-card-primary">
            <span><CalendarPlus size={20} aria-hidden="true" /></span>
            <div>
              <strong>Schedule service</strong>
            </div>
          </Link>
        ) : null}
        <Link href="/jobs" className="dashboard-section-card">
          <span><Clock3 size={20} aria-hidden="true" /></span>
          <div>
            <p>Open jobs</p>
            <strong>{activeJobs.length}</strong>
            <small>{completedJobs} completed</small>
          </div>
        </Link>
        {currentUser.role !== "call_center" ? (
          <Link href="/invoices" className="dashboard-section-card">
            <span><FileText size={20} aria-hidden="true" /></span>
            <div>
              <p>Draft invoices</p>
              <strong>{draftInvoices.length}</strong>
              <small>Needs review</small>
            </div>
          </Link>
        ) : null}
        <Link href="/customers" className="dashboard-section-card">
          <span><Users size={20} aria-hidden="true" /></span>
          <div>
            <p>Customers</p>
            <strong>{data.customers.length}</strong>
            <small>Search and schedule</small>
          </div>
        </Link>
        {currentUser.role === "owner" ? (
          <Link href="/parts" className="dashboard-section-card">
            <span><Package size={20} aria-hidden="true" /></span>
            <div>
              <p>Parts</p>
              <strong>{data.parts.length}</strong>
              <small>Catalog items</small>
            </div>
          </Link>
        ) : null}
      </section>

      <Card className="ops-chart-card dashboard-chart-panel">
        <div className="section-head">
          <div>
            <h2>Workload</h2>
            <p className="subtle-copy">Scheduled, active, and completed jobs by day.</p>
          </div>
        </div>
        <OperationsChart jobs={visibleJobs} />
      </Card>

      {currentUser.role === "call_center" ? (
        <Card className="search-command-card">
          <p className="eyebrow">Customer lookup</p>
          <GlobalSearch />
          <div className="action-row">
            <ButtonLink href="/customers/new">Create customer</ButtonLink>
            <ButtonLink href="/jobs/new" variant="secondary">Schedule service</ButtonLink>
          </div>
        </Card>
      ) : null}

      <section className="dashboard-lower-grid">
        <Card className="dashboard-table-card">
          <div className="section-head">
            <div>
              <h2>Active work</h2>
              <p className="subtle-copy">Jobs and invoice drafts that need attention.</p>
            </div>
            <div className="action-row">
              <ButtonLink href="/jobs" variant="secondary">All jobs</ButtonLink>
              {currentUser.role !== "call_center" ? <ButtonLink href="/invoices" variant="secondary">Invoices</ButtonLink> : null}
            </div>
          </div>
          {workItems.length === 0 ? (
            <EmptyState title="No work yet" description="Schedule a service call to start." action={canScheduleJobs(currentUser.role) ? <ButtonLink href="/jobs/new">Schedule service</ButtonLink> : undefined} />
          ) : (
            <div className="dashboard-work-list" aria-label="Active work">
              {workItems.map((row) => (
                <Link key={`${row.type}-${row.id}`} href={row.href} className="dashboard-work-row">
                  <span className="work-row-type">{row.type}</span>
                  <span className="work-row-main">
                    <strong>{row.title}</strong>
                    <small>{row.detail}</small>
                  </span>
                  <span className="work-row-meta">
                    <small>{row.owner}</small>
                    <small>{row.date}</small>
                  </span>
                  <span className="work-row-status"><StatusPill tone={row.tone}>{row.status}</StatusPill></span>
                </Link>
              ))}
            </div>
          )}
        </Card>

        <section className="dashboard-action-panel" aria-label="Quick actions">
          {roleActions[currentUser.role].map((action) => (
            <Link key={action.title} href={action.href} className="quick-action-card">
              <span className="quick-action-arrow">→</span>
              <action.Icon size={18} aria-hidden="true" />
              <strong>{action.title}</strong>
              <p>{action.body}</p>
            </Link>
          ))}
        </section>
      </section>
    </main>
  );
}
