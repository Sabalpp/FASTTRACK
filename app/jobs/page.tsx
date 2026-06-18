"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { useAppData } from "@/lib/data-store";
import { canScheduleJobs, canViewJob } from "@/lib/access";
import { formatDateTime } from "@/lib/date";
import { ButtonLink, EmptyState, PageHeader, StatusPill } from "@/components/ui";

export default function JobsPage() {
  const { currentUser } = useAuth();
  const data = useAppData();
  const visibleJobs = useMemo(
    () => data.jobs.filter((job) => canViewJob(currentUser, job)),
    [currentUser, data.jobs]
  );

  return (
    <main className="page-shell">
      <PageHeader
        eyebrow="Cases"
        title={currentUser.role === "tech" ? "Your assigned jobs" : "Jobs"}
        action={canScheduleJobs(currentUser.role) ? <ButtonLink href="/jobs/new">Schedule service</ButtonLink> : undefined}
      />
      <div className="record-list">
        {visibleJobs.length === 0 ? (
          <EmptyState
            title={currentUser.role === "tech" ? "No assigned jobs" : "No jobs scheduled"}
            description={currentUser.role === "tech" ? "Wait for dispatch to assign work." : "Search for the customer first, then schedule service."}
            action={canScheduleJobs(currentUser.role) ? <ButtonLink href="/jobs/new">Schedule service</ButtonLink> : undefined}
          />
        ) : (
          visibleJobs.map((job) => {
            const customer = data.customers.find((candidate) => candidate.id === job.customerId);
            const tech = data.allowedUsers.find((candidate) => candidate.id === job.assignedTechId);
            return (
              <Link key={job.id} href={`/jobs/${job.id}`} className="record-row job-row">
                <div className="record-main">
                  <strong>{customer?.name ?? "Unknown customer"}</strong>
                  <span>{job.description}</span>
                </div>
                <div className="record-meta">
                  <span>{formatDateTime(job.scheduledAt)}</span>
                  <small>{tech?.displayName ?? "Unassigned"}</small>
                </div>
                <div className="record-side">
                  <StatusPill tone={job.status === "complete" ? "good" : job.status === "cancelled" ? "bad" : "info"}>{job.status.replace("_", " ")}</StatusPill>
                </div>
              </Link>
            );
          })
        )}
      </div>
    </main>
  );
}
