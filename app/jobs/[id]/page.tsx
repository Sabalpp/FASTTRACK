"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
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
import { TierColumns } from "@/components/TierColumns";
import { Button, ButtonLink, Card, EmptyState, Field, PageHeader, StatusPill, TwoColumn } from "@/components/ui";
import { WorkflowRail } from "@/components/WorkflowRail";
import type { JobStatus } from "@/lib/types";

export default function JobDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { currentUser } = useAuth();
  const data = useAppData();
  const job = data.jobs.find((candidate) => candidate.id === params.id);
  const [saved, setSaved] = useState(false);
  const [notes, setNotes] = useState(job?.notes ?? "");
  const [status, setStatus] = useState<JobStatus>(job?.status ?? "scheduled");
  const [assignedTechId, setAssignedTechId] = useState(job?.assignedTechId ?? "");
  const [jobDescription, setJobDescription] = useState(job?.description ?? "");
  const [serviceAddress, setServiceAddress] = useState(job?.serviceAddress ?? "");
  const [scheduledAt, setScheduledAt] = useState(dateInputValue(job?.scheduledAt));

  if (!job || !canViewJob(currentUser, job)) {
    return (
      <main className="page-shell">
        <EmptyState title="Job not available" description="This job either does not exist or is outside this role's access." />
      </main>
    );
  }

  const jobRecord = job;
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

  function saveInspect() {
    data.updateJob(jobId, {
      notes,
      status,
      assignedTechId: assignedTechId || undefined,
      description: jobDescription.trim() || jobRecord.description,
      serviceAddress: serviceAddress.trim() || jobRecord.serviceAddress,
      scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : jobRecord.scheduledAt
    });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1400);
  }

  function buildInvoice() {
    const draft = data.createOrUpdateInvoiceDraft(jobId, currentUser.id);
    router.push(`/invoices/${draft.id}`);
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
          <div className="metric-pill"><strong>{photos.length}</strong><span>photos</span></div>
          <div className="metric-pill"><strong>{items.length}</strong><span>line items</span></div>
          {canSeeMoney(currentUser.role) ? <Button onClick={buildInvoice} disabled={items.length === 0}>{invoice ? "Rebuild draft" : "Build invoice"}</Button> : null}
        </div>
      </section>

      <Card>
        <div className="section-head">
          <div>
            <p className="eyebrow">Inspect</p>
            <h2>Basics</h2>
          </div>
          <StatusPill tone={status === "complete" ? "good" : status === "cancelled" ? "bad" : "info"}>{status.replace("_", " ")}</StatusPill>
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
            <strong>{formatDateTime(scheduledAt ? new Date(scheduledAt).toISOString() : job.scheduledAt)}</strong>
            <span>Assigned: {tech?.displayName ?? "Unassigned"}</span>
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
          <Field label="Scheduled time">
            <input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} />
          </Field>
        </div>
        <TwoColumn>
          <Field label="Status">
            <div className="segmented-control">
              {(["scheduled", "in_progress", "complete", "cancelled"] as JobStatus[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  className={status === option ? "active" : ""}
                  onClick={() => setStatus(option)}
                  disabled={currentUser.role === "call_center"}
                >
                  {option.replace("_", " ")}
                </button>
              ))}
            </div>
          </Field>
          {canScheduleJobs(currentUser.role) ? (
            <Field label="Assigned tech">
              <select value={assignedTechId} onChange={(event) => setAssignedTechId(event.target.value)}>
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
        <Button onClick={saveInspect}>{saved ? "Saved" : "Save job"}</Button>
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
