"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { tierOptions, useAppData } from "@/lib/data-store";
import { canScheduleJobs, canSeeMoney, canSeePhotos, canViewJob } from "@/lib/access";
import { dateInputValue, formatDateTime } from "@/lib/date";
import { money } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { ContactActions } from "@/components/ContactActions";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { LineItemForm } from "@/components/LineItemForm";
import { PhotoUploader } from "@/components/PhotoUploader";
import { ServiceWindowBadge } from "@/components/ServiceWindowBadge";
import { TierColumns } from "@/components/TierColumns";
import { Button, ButtonLink, Card, EmptyState, Field, PageHeader, StatusPill, TwoColumn } from "@/components/ui";
import { WorkflowRail } from "@/components/WorkflowRail";
import {
  defaultServiceWindowEndAt,
  findTechnicianWindowConflicts,
  formatServiceWindow,
  isValidServiceWindow
} from "@/lib/service-window";
import { useCurrentTime } from "@/lib/use-current-time";
import type { Job, JobStatus } from "@/lib/types";

export default function JobDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { currentUser } = useAuth();
  const data = useAppData();
  const job = data.jobs.find((candidate) => candidate.id === params.id);
  const [saved, setSaved] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>();
  const [notes, setNotes] = useState(job?.notes ?? "");
  const [status, setStatus] = useState<JobStatus>(job?.status ?? "scheduled");
  const [assignedTechId, setAssignedTechId] = useState(job?.assignedTechId ?? "");
  const [jobDescription, setJobDescription] = useState(job?.description ?? "");
  const [serviceAddress, setServiceAddress] = useState(job?.serviceAddress ?? "");
  const [scheduledAt, setScheduledAt] = useState(dateInputValue(job?.scheduledAt));
  const [arrivalWindowEndAt, setArrivalWindowEndAt] = useState(dateInputValue(job?.arrivalWindowEndAt ?? defaultServiceWindowEndAt(job?.scheduledAt)));
  const [conflictConfirmed, setConflictConfirmed] = useState(false);
  const [arrivalBusy, setArrivalBusy] = useState(false);
  const [arrivalError, setArrivalError] = useState<string | undefined>();
  const now = useCurrentTime();
  const scheduledAtIso = localDateTimeIso(scheduledAt);
  const arrivalWindowEndAtIso = localDateTimeIso(arrivalWindowEndAt);
  const validWindow = isValidServiceWindow(scheduledAtIso, arrivalWindowEndAtIso);
  const dispatchChanged = Boolean(job && (
    (assignedTechId || null) !== (job.assignedTechId ?? null)
    || (scheduledAtIso && scheduledAtIso !== job.scheduledAt)
    || (arrivalWindowEndAtIso && arrivalWindowEndAtIso !== job.arrivalWindowEndAt)
  ));
  const conflicts = useMemo(
    () => job && !job.arrivedAt && dispatchChanged && status !== "complete" && status !== "cancelled" ? findTechnicianWindowConflicts(data.jobs, {
      assignedTechId: assignedTechId || undefined,
      scheduledAt: scheduledAtIso,
      arrivalWindowEndAt: arrivalWindowEndAtIso,
      excludeJobId: job.id
    }) : [],
    [arrivalWindowEndAtIso, assignedTechId, data.jobs, dispatchChanged, job, scheduledAtIso, status]
  );

  useEffect(() => {
    if (!job) return;
    setNotes(job.notes);
    setStatus(job.status);
    setAssignedTechId(job.assignedTechId ?? "");
    setJobDescription(job.description);
    setServiceAddress(job.serviceAddress);
    setScheduledAt(dateInputValue(job.scheduledAt));
    setArrivalWindowEndAt(dateInputValue(job.arrivalWindowEndAt ?? defaultServiceWindowEndAt(job.scheduledAt)));
    setConflictConfirmed(false);
    setArrivalError(undefined);
    setSaveError(undefined);
  }, [job?.id]);

  if (!job || !canViewJob(currentUser, job)) {
    return (
      <main className="page-shell">
        <EmptyState title="Job not available" description="This job either does not exist or is outside this role's access." />
      </main>
    );
  }

  const jobRecord = job;
  const canEditSchedule = canScheduleJobs(currentUser.role);
  const canEditDispatch = canEditSchedule && !job.arrivedAt;
  const customer = data.customers.find((candidate) => candidate.id === job.customerId);
  const tech = data.allowedUsers.find((candidate) => candidate.id === job.assignedTechId);
  const activeTechs = data.allowedUsers.filter((user) => user.active && user.role === "tech");
  const photos = data.jobPhotos.filter((photo) => photo.jobId === job.id);
  const items = data.jobLineItems.filter((item) => item.jobId === job.id).sort((a, b) => a.sortOrder - b.sortOrder);
  const invoice = data.invoices.find((candidate) => candidate.jobId === job.id);
  const jobId = job.id;
  const jobNav = data.jobs
    .filter((candidate) => canViewJob(currentUser, candidate))
    .sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt));
  const jobIndex = jobNav.findIndex((candidate) => candidate.id === job.id);
  const previousJob = jobIndex > 0 ? jobNav[jobIndex - 1] : undefined;
  const nextJob = jobIndex >= 0 && jobIndex < jobNav.length - 1 ? jobNav[jobIndex + 1] : undefined;

  async function saveInspect() {
    if (canEditDispatch && (!scheduledAtIso || !arrivalWindowEndAtIso || !validWindow)) return;
    if (canEditDispatch && conflicts.length > 0 && !conflictConfirmed) return;
    const patch: Partial<Job> = {};
    const nextDescription = jobDescription.trim() || jobRecord.description;
    const nextAddress = serviceAddress.trim() || jobRecord.serviceAddress;
    if (nextDescription !== jobRecord.description) patch.description = nextDescription;
    if (nextAddress !== jobRecord.serviceAddress) patch.serviceAddress = nextAddress;
    if (currentUser.role !== "call_center" && notes !== jobRecord.notes) patch.notes = notes;
    if (currentUser.role !== "call_center" && status !== jobRecord.status) patch.status = status;
    if (canEditDispatch) {
      const nextAssignedTechId = assignedTechId || null;
      if (nextAssignedTechId !== (jobRecord.assignedTechId ?? null)) patch.assignedTechId = nextAssignedTechId;
      if (scheduledAtIso && scheduledAtIso !== jobRecord.scheduledAt) patch.scheduledAt = scheduledAtIso;
      if (arrivalWindowEndAtIso && arrivalWindowEndAtIso !== jobRecord.arrivalWindowEndAt) patch.arrivalWindowEndAt = arrivalWindowEndAtIso;
    }
    setSaveBusy(true);
    setSaveError(undefined);
    try {
      await data.updateJob(jobId, patch);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1400);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "The job could not be saved.");
    } finally {
      setSaveBusy(false);
    }
  }

  function buildInvoice() {
    const draft = data.createOrUpdateInvoiceDraft(jobId, currentUser.id);
    router.push(`/invoices/${draft.id}`);
  }

  async function markArrived() {
    setArrivalBusy(true);
    setArrivalError(undefined);
    try {
      await data.markJobArrived(jobId);
      setStatus("in_progress");
    } catch (error) {
      setArrivalError(error instanceof Error ? error.message : "The arrival could not be recorded.");
    } finally {
      setArrivalBusy(false);
    }
  }

  const tierCounts = Object.fromEntries(tierOptions.map((tier) => [tier, items.filter((item) => item.tier === tier).length]));

  return (
    <main className="page-shell">
      <PageHeader
        eyebrow="Job"
        title={customer?.name ?? "Unknown customer"}
        description={jobDescription || job.description}
        action={
          <div className="job-detail-nav">
            <Link className={`button button-secondary ${previousJob ? "" : "disabled"}`} href={previousJob ? `/jobs/${previousJob.id}` : "#"} aria-disabled={!previousJob}>Previous</Link>
            <Link className={`button button-secondary ${nextJob ? "" : "disabled"}`} href={nextJob ? `/jobs/${nextJob.id}` : "#"} aria-disabled={!nextJob}>Next</Link>
            {invoice ? <ButtonLink href={`/invoices/${invoice.id}`}>Open invoice</ButtonLink> : null}
          </div>
        }
      />

      <section className="job-command-bar card-hero">
        <div>
          <p className="eyebrow">Workflow</p>
          <WorkflowRail active={invoice ? "Email" : items.length > 0 ? "Invoice" : photos.length > 0 ? "Charge" : "Case"} compact />
        </div>
        <div className="job-command-actions">
          {!job.arrivedAt && status !== "complete" && status !== "cancelled" && currentUser.role !== "call_center" ? (
            <Button onClick={markArrived} disabled={arrivalBusy || saveBusy}>{arrivalBusy ? "Recording arrival..." : "Arrived · Start job"}</Button>
          ) : null}
          <div className="metric-pill"><strong>{photos.length}</strong><span>photos</span></div>
          <div className="metric-pill"><strong>{items.length}</strong><span>line items</span></div>
          {canSeeMoney(currentUser.role) ? <Button onClick={buildInvoice} disabled={items.length === 0}>{invoice ? "Rebuild draft" : "Build invoice"}</Button> : null}
        </div>
      </section>
      {arrivalError ? <p className="field-error" role="alert">{arrivalError}</p> : null}

      <Card>
        <div className="section-head">
          <div>
            <p className="eyebrow">Inspect</p>
            <h2>Basics</h2>
          </div>
          <div className="window-status-stack">
            <ServiceWindowBadge job={job} now={now} />
            <StatusPill tone={status === "complete" ? "good" : status === "cancelled" ? "bad" : "info"}>{status.replace("_", " ")}</StatusPill>
          </div>
        </div>
        <TwoColumn>
          <div className="detail-block">
            <strong>{customer?.name}</strong>
            <span>{customer ? formatPhone(customer.phone) : "No phone"}</span>
            <span>{customer?.email ?? "No email"}</span>
            <span>{serviceAddress || job.serviceAddress}</span>
            {customer ? <ContactActions customer={customer} subject={jobDescription || job.description} /> : null}
          </div>
          <div className="detail-block">
            <strong>{formatServiceWindow(scheduledAtIso ?? job.scheduledAt, arrivalWindowEndAtIso ?? job.arrivalWindowEndAt)}</strong>
            <span>Customer arrival window</span>
            <span>Assigned: {tech?.displayName ?? "Unassigned"}</span>
            {job.arrivedAt ? <span>Arrived: {formatDateTime(job.arrivedAt)}</span> : null}
            <span>Created: {formatDateTime(job.createdAt)}</span>
            {job.completedAt ? <span>Completed: {formatDateTime(job.completedAt)}</span> : null}
          </div>
        </TwoColumn>
        <div className="job-edit-grid">
          <Field label="Service call">
            <textarea
              className="compact-textarea"
              value={jobDescription}
              onChange={(event) => setJobDescription(event.target.value)}
            />
          </Field>
          <Field label="Service address">
            <AddressAutocomplete
              value={serviceAddress}
              onChange={setServiceAddress}
              onSelect={(address) => setServiceAddress(address.formatted)}
            />
          </Field>
          <Field label="Window starts">
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(event) => {
                const nextStart = event.target.value;
                setScheduledAt(nextStart);
                setArrivalWindowEndAt(dateInputValue(defaultServiceWindowEndAt(localDateTimeIso(nextStart))));
                setConflictConfirmed(false);
              }}
              disabled={!canEditDispatch}
            />
          </Field>
          <Field label="Window ends">
            <input
              type="datetime-local"
              value={arrivalWindowEndAt}
              onChange={(event) => {
                setArrivalWindowEndAt(event.target.value);
                setConflictConfirmed(false);
              }}
              disabled={!canEditDispatch}
            />
          </Field>
        </div>
        {job.arrivedAt && canEditSchedule ? (
          <p className="muted">The arrival window and assignment are locked because the technician arrival has been recorded.</p>
        ) : null}
        {canEditDispatch && scheduledAt && arrivalWindowEndAt && !validWindow ? (
          <p className="field-error" role="alert">The arrival window must end after it starts.</p>
        ) : null}
        {canEditDispatch && conflicts.length > 0 ? (
          <div className="window-conflict" role="alert">
            <strong>Technician schedule overlap</strong>
            <span>{conflicts.length === 1 ? "Another assigned job overlaps this arrival window." : `${conflicts.length} assigned jobs overlap this arrival window.`}</span>
            <label>
              <input type="checkbox" checked={conflictConfirmed} onChange={(event) => setConflictConfirmed(event.target.checked)} />
              Save this overlap anyway
            </label>
          </div>
        ) : null}
        <TwoColumn>
          <Field label="Status">
            <div className="segmented-control">
              {(["scheduled", "in_progress", "complete", "cancelled"] as JobStatus[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  className={status === option ? "active" : ""}
                  onClick={() => setStatus(option)}
                  disabled={
                    currentUser.role === "call_center"
                    || ((option === "in_progress" || option === "complete") && !job.arrivedAt)
                    || (option === "scheduled" && Boolean(job.arrivedAt))
                  }
                >
                  {option.replace("_", " ")}
                </button>
              ))}
            </div>
          </Field>
          {canScheduleJobs(currentUser.role) ? (
            <Field label="Assigned tech">
              <select value={assignedTechId} disabled={!canEditDispatch} onChange={(event) => {
                setAssignedTechId(event.target.value);
                setConflictConfirmed(false);
              }}>
                <option value="">Unassigned</option>
                {activeTechs.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.displayName}</option>)}
              </select>
            </Field>
          ) : (
            <Field label="Tech notes">
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} disabled={currentUser.role === "call_center"} />
            </Field>
          )}
        </TwoColumn>
        {canScheduleJobs(currentUser.role) ? (
          <Field label="Tech notes">
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} disabled={currentUser.role === "call_center"} />
          </Field>
        ) : null}
        {saveError ? <p className="field-error" role="alert">{saveError}</p> : null}
        <Button
          onClick={saveInspect}
          disabled={saveBusy || (canEditDispatch && !validWindow) || (canEditDispatch && conflicts.length > 0 && !conflictConfirmed)}
        >
          {saveBusy ? "Saving..." : saved ? "Saved" : "Save job"}
        </Button>
      </Card>

      {canSeePhotos(currentUser.role) ? (
        <Card>
          <p className="eyebrow">Case</p>
          <h2>Photos and proof</h2>
          <PhotoUploader jobId={job.id} uploadedBy={currentUser.id} />
          {photos.length === 0 ? (
            <EmptyState title="No photos yet" description="Add before, after, or other job photos from the iPad camera." />
          ) : (
            <div className="photo-grid">
              {photos.map((photo) => (
                <div key={photo.id} className="photo-card">
                  {photo.storagePath.startsWith("data:") || photo.storagePath.startsWith("http") ? <img src={photo.storagePath} alt={photo.caption ?? photo.kind} /> : <div className="photo-placeholder">Private storage path</div>}
                  <strong>{photo.kind}</strong>
                  <span>{photo.caption ?? photo.storagePath}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      ) : null}

      {canSeeMoney(currentUser.role) ? (
        <>
          <Card>
            <div className="section-head">
              <div>
                <p className="eyebrow">Items</p>
                <h2>Work items</h2>
              </div>
              <p className="muted">Good {tierCounts.good} · Better {tierCounts.better} · Best {tierCounts.best}</p>
            </div>
            <LineItemForm jobId={job.id} />
          </Card>

          <Card>
            <div className="section-head">
              <div>
                <p className="eyebrow">Options</p>
                <h2>Estimate options</h2>
              </div>
              <strong>{items.length} line items</strong>
            </div>
            <TierColumns
              items={items}
              taxRate={0.06}
              editable
              onEdit={data.updateLineItem}
              onDelete={data.deleteLineItem}
            />
          </Card>

          <Card>
            <div className="section-head">
              <div>
                <p className="eyebrow">Invoice</p>
                <h2>Invoice draft</h2>
              </div>
              {invoice ? <StatusPill tone={invoice.status === "sent" ? "good" : "warn"}>{invoice.status}</StatusPill> : null}
            </div>
            {items.length === 0 ? (
              <EmptyState title="Add line items first" description="Charges are required before a draft can be built." />
            ) : (
              <div className="action-panel">
                <div>
                  <strong>Ready for review</strong>
                  <p className="muted">Owner sends after the draft is saved.</p>
                </div>
                <Button onClick={buildInvoice}>{invoice ? "Rebuild draft" : "Build invoice"}</Button>
              </div>
            )}
          </Card>
        </>
      ) : (
        <Card>
          <p className="eyebrow">Protected sections</p>
          <h2>Money and photos are hidden</h2>
          <p className="muted">Call center can schedule and update basics only.</p>
        </Card>
      )}
    </main>
  );
}

function localDateTimeIso(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}
