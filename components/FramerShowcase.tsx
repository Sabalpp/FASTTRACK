"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { canViewJob } from "@/lib/access";
import { roleLabels, tierLabels, tierOptions, useAppData } from "@/lib/data-store";
import { formatDateTime } from "@/lib/date";
import { money } from "@/lib/money";
import type { Role } from "@/lib/types";
import { ButtonLink, StatusPill } from "@/components/ui";
import { WorkflowRail, workflowSteps, type WorkflowVerb } from "@/components/WorkflowRail";

const roles: Role[] = ["owner", "tech", "call_center"];

const roleCopy: Record<Role, { headline: string; subhead: string; promise: string }> = {
  owner: {
    headline: "Owner command center",
    subhead: "Review work, approve invoices, and keep control of access.",
    promise: "Every dollar and every draft is visible only to the owner."
  },
  tech: {
    headline: "Tech field cockpit",
    subhead: "One job page, one big flow, no hunting for tabs.",
    promise: "Assigned jobs only. Photos, line items, and invoice drafts stay focused."
  },
  call_center: {
    headline: "Call center scheduling desk",
    subhead: "Find customers and book jobs without touching pricing.",
    promise: "No photos. No parts. No invoices. No dollar amounts."
  }
};

const verbActions: Record<WorkflowVerb, { title: string; body: string; cta: string }> = {
  Inspect: {
    title: "Open the job and diagnose",
    body: "Customer, phone, address, scheduled time, status, and notes sit at the top of one scrolling page.",
    cta: "Save inspection"
  },
  Charge: {
    title: "Add the work in plain language",
    body: "Type any custom line item and price, then keep one Standard scope or offer Good, Better, and Best choices.",
    cta: "Add line item"
  },
  Case: {
    title: "Document the case",
    body: "Before, after, and other photos attach to the job so the owner can review the full story.",
    cta: "Upload photo"
  },
  Secure: {
    title: "Present Standard or options",
    body: "Use one clear Standard scope, or present Good, Better, and Best when choices help the customer.",
    cta: "Show options"
  },
  Invoice: {
    title: "Build the invoice draft",
    body: "Totals are calculated by tier, with tax included, then saved as a draft for owner review.",
    cta: "Build invoice"
  },
  Email: {
    title: "Owner sends it",
    body: "The send button is owner-only. In MVP it updates status; after credentials it sends the PDF.",
    cta: "Send invoice"
  }
};

export function FramerShowcase() {
  const data = useAppData();
  const [role, setRole] = useState<Role>("owner");
  const [activeVerb, setActiveVerb] = useState<WorkflowVerb>("Inspect");

  const user = data.allowedUsers.find((candidate) => candidate.role === role && candidate.active) ?? data.allowedUsers[0];
  const visibleJobs = useMemo(() => data.jobs.filter((job) => canViewJob(user, job)), [data.jobs, user]);
  const featuredJob = visibleJobs[0] ?? data.jobs[0];
  const featuredCustomer = data.customers.find((customer) => customer.id === featuredJob?.customerId) ?? data.customers[0];
  const featuredInvoice = data.invoices.find((invoice) => invoice.jobId === featuredJob?.id) ?? data.invoices[0];
  const items = data.jobLineItems.filter((item) => item.jobId === (featuredInvoice?.jobId ?? featuredJob?.id));
  const copy = roleCopy[role];
  const action = verbActions[activeVerb];
  const draftCount = data.invoices.filter((invoice) => invoice.status === "draft").length;

  return (
    <main className="showcase-page">
      <section className="showcase-hero card-hero">
        <div className="showcase-copy">
          <p className="eyebrow">Framer-level MVP showroom</p>
          <h1>Make the field app feel premium without making it complicated.</h1>
          <p>
            This is the prettier clickable layer for the contractor demo. It still points back to the working routes for customers,
            jobs, photos, invoices, and role access.
          </p>
          <div className="showcase-cta-row">
            <ButtonLink href="/dashboard">Open working app</ButtonLink>
            <ButtonLink href="/jobs" variant="secondary">See jobs</ButtonLink>
          </div>
        </div>
        <div className="device-shell" aria-label="iPad-style MVP preview">
          <div className="device-topbar">
            <span />
            <strong>Fast Track FieldOS</strong>
            <small>{roleLabels[role]}</small>
          </div>
          <div className="device-screen">
            <div className="mini-command">
              <span className="mini-dot" />
              <div>
                <strong>{copy.headline}</strong>
                <small>{copy.subhead}</small>
              </div>
            </div>
            <div className="mini-job-card">
              <div>
                <p className="eyebrow">Live job</p>
                <h2>{featuredCustomer?.name ?? "Customer"}</h2>
                <p>{featuredJob?.description ?? "Scheduled service visit"}</p>
                <small>{featuredJob ? formatDateTime(featuredJob.scheduledAt) : "Today"}</small>
              </div>
              <StatusPill tone="info">{featuredJob?.status.replace("_", " ") ?? "scheduled"}</StatusPill>
            </div>
            <div className="mini-tier-strip">
              {tierOptions.map((tier) => {
                const invoiceTotals = {
                  standard: featuredInvoice?.totalStandard,
                  good: featuredInvoice?.totalGood,
                  better: featuredInvoice?.totalBetter,
                  best: featuredInvoice?.totalBest
                };
                return (
                  <div key={tier}>
                    <small>{tierLabels[tier]}</small>
                    <strong>{invoiceTotals[tier] === undefined ? "—" : money(invoiceTotals[tier] ?? 0)}</strong>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section className="showcase-control-grid">
        <aside className="showcase-panel">
          <p className="eyebrow">Pick the demo angle</p>
          <div className="role-card-list">
            {roles.map((candidate) => (
              <button key={candidate} className={role === candidate ? "role-card role-card-active" : "role-card"} onClick={() => setRole(candidate)}>
                <strong>{roleLabels[candidate]}</strong>
                <span>{roleCopy[candidate].promise}</span>
              </button>
            ))}
          </div>
          <div className="lock-note">
            <strong>Access rule in plain English</strong>
            <p>{copy.promise}</p>
          </div>
        </aside>

        <section className="showcase-panel showcase-main-panel">
          <div className="section-head">
            <div>
              <p className="eyebrow">Six-verb flow</p>
              <h2>{copy.headline}</h2>
              <p className="muted">Tap a verb to change the story the screen is telling.</p>
            </div>
            <StatusPill tone={role === "call_center" ? "warn" : "good"}>{roleLabels[role]}</StatusPill>
          </div>

          <div className="verb-button-grid">
            {workflowSteps.map((step) => (
              <button key={step.verb} className={activeVerb === step.verb ? "verb-button verb-button-active" : "verb-button"} onClick={() => setActiveVerb(step.verb)}>
                <strong>{step.label}</strong>
                <span>{step.detail}</span>
              </button>
            ))}
          </div>

          <div className="showcase-work-area">
            <div className="verb-story-card">
              <p className="eyebrow">{activeVerb}</p>
              <h2>{action.title}</h2>
              <p>{action.body}</p>
              <button className="button">{action.cta}</button>
            </div>
            <div className="showcase-data-card">
              <div className="section-head">
                <div>
                  <strong>{featuredCustomer?.name ?? "Customer"}</strong>
                  <span>{featuredCustomer?.city}, {featuredCustomer?.state} {featuredCustomer?.zip}</span>
                </div>
                <StatusPill tone="info">{items.length} items</StatusPill>
              </div>
              <div className="quote-ladder">
                {tierOptions.map((tier) => {
                  const tierItems = items.filter((item) => item.tier === tier);
                  const total = tierItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
                  return (
                    <div key={tier}>
                      <small>{tierLabels[tier]}</small>
                      <strong>{money(total)}</strong>
                      <span>{tierItems.length} line items</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>
      </section>

      <section className="showcase-panel">
        <div className="section-head">
          <div>
            <p className="eyebrow">Working routes</p>
            <h2>This is not just a pretty mockup.</h2>
            <p className="muted">Use the app routes below to perform the actual MVP actions against demo state.</p>
          </div>
          <div className="metric-pill"><strong>{draftCount}</strong><span>draft invoices</span></div>
        </div>
        <div className="route-grid">
          <Link href="/customers">Search customers</Link>
          <Link href="/customers/new">Create customer</Link>
          <Link href="/jobs/new">Schedule job</Link>
          <Link href={`/jobs/${featuredJob?.id}`}>Open job detail</Link>
          <Link href="/parts">Owner parts</Link>
          <Link href="/invoices">Review invoices</Link>
        </div>
      </section>
    </main>
  );
}
