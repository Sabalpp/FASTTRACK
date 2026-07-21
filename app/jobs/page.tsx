"use client";

import {
  ArrowRight,
  CalendarDays,
  CalendarPlus,
  CircleAlert,
  Clock3,
  MapPin,
  Search,
  UserRound
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { canScheduleJobs, canViewJob } from "@/lib/access";
import { useAuth } from "@/lib/auth";
import { roleLabels, useAppData } from "@/lib/data-store";
import { compareJobsForDispatch, formatServiceWindow, getServiceWindowTiming } from "@/lib/service-window";
import type { Job } from "@/lib/types";
import { useCurrentTime } from "@/lib/use-current-time";
import styles from "./jobs.module.css";

type JobFilter = "open" | "completed" | "all";

export default function JobsPage() {
  const { currentUser } = useAuth();
  const data = useAppData();
  const now = useCurrentTime();
  const [filter, setFilter] = useState<JobFilter>("open");
  const [query, setQuery] = useState("");

  const visibleJobs = useMemo(
    () => data.jobs
      .filter((job) => canViewJob(currentUser, job))
      .sort((a, b) => compareJobsForDispatch(a, b, now)),
    [currentUser, data.jobs, now]
  );

  const filteredJobs = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return visibleJobs.filter((job) => {
      const matchesStatus = filter === "all"
        || (filter === "open" && job.status !== "complete" && job.status !== "cancelled")
        || (filter === "completed" && (job.status === "complete" || job.status === "cancelled"));
      const customer = data.customers.find((candidate) => candidate.id === job.customerId);
      const tech = data.allowedUsers.find((candidate) => candidate.id === job.assignedTechId);
      const searchable = `${customer?.name ?? ""} ${job.description} ${job.serviceAddress} ${tech?.displayName ?? ""}`.toLowerCase();
      return matchesStatus && (!normalizedQuery || searchable.includes(normalizedQuery));
    });
  }, [data.allowedUsers, data.customers, filter, query, visibleJobs]);

  const openCount = visibleJobs.filter((job) => job.status !== "complete" && job.status !== "cancelled").length;
  const inProgressCount = visibleJobs.filter((job) => job.status === "in_progress").length;
  const exceptionCount = visibleJobs.filter((job) => (
    job.status !== "complete"
    && job.status !== "cancelled"
    && getServiceWindowTiming(job, now).tone === "bad"
  )).length;

  return (
    <main className={`page-shell ${styles.page}`}>
      <header className={styles.hero}>
        <div>
          <p className={styles.kicker}>{currentUser.role === "tech" ? "Your route" : "Dispatch"}</p>
          <h1>{currentUser.role === "tech" ? "Assigned work" : "Service schedule"}</h1>
          <p>{currentUser.role === "tech"
            ? "Your customer windows and active service jobs."
            : "Customer windows, assigned technicians, and arrival records in one place."}</p>
        </div>
        {canScheduleJobs(currentUser.role) ? (
          <Link href="/jobs/new" className={styles.primaryAction}>
            <CalendarPlus size={18} aria-hidden="true" />Schedule service
          </Link>
        ) : null}
      </header>

      <section className={styles.summary} aria-label="Schedule summary">
        <div><span className={styles.summaryIcon}><CalendarDays size={18} /></span><span><strong>{openCount}</strong><small>Open jobs</small></span></div>
        <div><span className={styles.summaryIcon}><Clock3 size={18} /></span><span><strong>{inProgressCount}</strong><small>In progress</small></span></div>
        <div data-attention={exceptionCount > 0 || undefined}><span className={styles.summaryIcon}><CircleAlert size={18} /></span><span><strong>{exceptionCount}</strong><small>Arrival exceptions</small></span></div>
      </section>

      <section className={styles.workspace} aria-labelledby="schedule-list-title">
        <div className={styles.workspaceHeader}>
          <div><h2 id="schedule-list-title">Jobs</h2><p>{filteredJobs.length} shown</p></div>
          <div className={styles.filters}>
            <label className={styles.searchField}>
              <Search size={17} aria-hidden="true" />
              <span className={styles.srOnly}>Search jobs</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Customer, address, worker" />
            </label>
            <div className={styles.tabs} aria-label="Filter jobs">
              {(["open", "completed", "all"] as const).map((value) => (
                <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>
                  {value === "open" ? "Open" : value === "completed" ? "Closed" : "All"}
                </button>
              ))}
            </div>
          </div>
        </div>

        {filteredJobs.length === 0 ? (
          <div className={styles.empty}>
            <CalendarDays size={23} aria-hidden="true" />
            <strong>{query ? "No matching jobs" : filter === "open" ? "No open jobs" : "No jobs in this view"}</strong>
            <p>{query ? "Try another customer, address, or worker." : "New work will appear here as it is scheduled."}</p>
          </div>
        ) : (
          <div className={styles.jobList}>
            {filteredJobs.map((job) => {
              const customer = data.customers.find((candidate) => candidate.id === job.customerId);
              const tech = data.allowedUsers.find((candidate) => candidate.id === job.assignedTechId);
              const arrival = arrivalFact(job, now);
              return (
                <Link key={job.id} href={`/jobs/${job.id}`} className={styles.jobCard}>
                  <span className={styles.customer}>
                    <strong>{customer?.name ?? "Unknown customer"}</strong>
                    <small>{job.description}</small>
                  </span>
                  <span className={styles.fact}>
                    <CalendarDays size={17} aria-hidden="true" />
                    <span><small>Customer window</small><strong>{formatServiceWindow(job.scheduledAt, job.arrivalWindowEndAt)}</strong></span>
                  </span>
                  <span className={styles.fact}>
                    <UserRound size={17} aria-hidden="true" />
                    <span><small>Assigned worker</small><strong>{tech?.displayName ?? "Unassigned"}</strong><em>{tech ? roleLabels[tech.role] : "Needs assignment"}</em></span>
                  </span>
                  <span className={styles.fact}>
                    <MapPin size={17} aria-hidden="true" />
                    <span><small>Service address</small><strong>{job.serviceAddress}</strong></span>
                  </span>
                  <span className={styles.arrival} data-exception={arrival.exception || undefined}>
                    <small>Arrival</small>
                    <strong>{arrival.label}</strong>
                    {arrival.detail ? <em>{arrival.detail}</em> : null}
                  </span>
                  <span className={styles.status} data-status={job.status}>{job.status.replace("_", " ")}</span>
                  <ArrowRight className={styles.arrow} size={18} aria-hidden="true" />
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}

function arrivalFact(job: Job, now: number) {
  const timing = getServiceWindowTiming(job, now);
  if (job.arrivedAt) {
    const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(job.arrivedAt));
    return {
      label: `Arrived ${time}`,
      detail: timing.tone === "bad" ? "Outside window" : timing.tone === "info" ? "Before window" : "Within window",
      exception: timing.tone === "bad"
    };
  }
  return {
    label: job.status === "in_progress" ? "Not recorded" : "Awaiting arrival",
    detail: timing.tone === "bad" ? "Window exceeded" : timing.tone === "warn" ? "Window ending soon" : undefined,
    exception: timing.tone === "bad"
  };
}
