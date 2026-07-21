"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  FileText,
  MapPin,
  MessageSquare,
  PenLine,
  Phone,
  Save,
  UserRound
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { tierOptions, useAppData } from "@/lib/data-store";
import { canScheduleJobs, canSeeMoney, canSeePhotos, canViewJob } from "@/lib/access";
import { formatDateTime } from "@/lib/date";
import { money } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { LineItemForm } from "@/components/LineItemForm";
import { PhotoUploader } from "@/components/PhotoUploader";
import { AppointmentConfirmationCard } from "@/components/AppointmentConfirmationCard";
import { ArrivalWindowField } from "@/components/ArrivalWindowField";
import { TierColumns } from "@/components/TierColumns";
import { Button, EmptyState, Field, StatusPill, TwoColumn } from "@/components/ui";
import { JobStageNav, jobStages, type JobStage } from "@/components/JobStageNav";
import { SignatureDialog } from "@/components/SignatureDialog";
import { SignatureStatusCard } from "@/components/SignatureStatusCard";
import {
  findTechnicianWindowConflicts,
  formatServiceWindow
} from "@/lib/service-window";
import { arrivalWindowDraftFromRange, resolveArrivalWindow } from "@/lib/arrival-window";
import { useCurrentTime } from "@/lib/use-current-time";
import { dispatchJobConfirmations, fetchJobConfirmations } from "@/lib/appointment-confirmations-client";
import { completeProtectedJob, createProtectedInvoiceDraft } from "@/lib/invoices-client";
import { demoMode } from "@/lib/runtime";
import { loadSignatures, rejectSignature, saveSignature } from "@/lib/signatures-client";
import type { AppointmentNotificationSummary, InvoiceSignature, Job, JobStatus } from "@/lib/types";
import styles from "./JobDetail.module.css";

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
  const [arrivalWindowDraft, setArrivalWindowDraft] = useState(() => arrivalWindowDraftFromRange(job?.scheduledAt, job?.arrivalWindowEndAt));
  const [arrivalBusy, setArrivalBusy] = useState(false);
  const [arrivalError, setArrivalError] = useState<string | undefined>();
  const [confirmations, setConfirmations] = useState<AppointmentNotificationSummary[]>([]);
  const [confirmationsLoading, setConfirmationsLoading] = useState(true);
  const [confirmationBusy, setConfirmationBusy] = useState(false);
  const [confirmationError, setConfirmationError] = useState<string | undefined>();
  const canManageConfirmations = currentUser.role === "owner" || currentUser.role === "call_center";
  const canEditCustomerFacingFields = canManageConfirmations;
  const [invoiceBusy, setInvoiceBusy] = useState(false);
  const [invoiceError, setInvoiceError] = useState<string | undefined>();
  const [completionSignatures, setCompletionSignatures] = useState<InvoiceSignature[]>([]);
  const [signatureLoading, setSignatureLoading] = useState(false);
  const [signatureError, setSignatureError] = useState<string | undefined>();
  const [signatureDialogOpen, setSignatureDialogOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideConfirmed, setOverrideConfirmed] = useState(false);
  const [activeStage, setActiveStage] = useState<JobStage>("overview");
  const [dispatchEditing, setDispatchEditing] = useState(false);
  const now = useCurrentTime();
  const confirmationPollingNeeded = shouldPollConfirmationStatus(confirmations, now);
  const arrivalWindowResolution = resolveArrivalWindow(arrivalWindowDraft);
  const scheduledAtIso = arrivalWindowResolution.status === "valid" ? arrivalWindowResolution.startAt : undefined;
  const arrivalWindowEndAtIso = arrivalWindowResolution.status === "valid" ? arrivalWindowResolution.endAt : undefined;
  const validWindow = arrivalWindowResolution.status === "valid";
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
    setArrivalWindowDraft(arrivalWindowDraftFromRange(job.scheduledAt, job.arrivalWindowEndAt));
    setArrivalError(undefined);
    setSaveError(undefined);
    setOverrideReason("");
    setOverrideConfirmed(false);
    setActiveStage("overview");
    setDispatchEditing(false);
  }, [job?.id]);

  useEffect(() => {
    if (currentUser.role === "call_center" && activeStage !== "overview") {
      setActiveStage("overview");
    }
    if (currentUser.role === "tech") setDispatchEditing(false);
  }, [activeStage, currentUser.role]);

  useEffect(() => {
    if (!job?.id) return;
    if (!canManageConfirmations) {
      setConfirmations([]);
      setConfirmationsLoading(false);
      setConfirmationError(undefined);
      return;
    }
    let active = true;
    setConfirmationsLoading(true);
    setConfirmationError(undefined);

    const load = dispatchJobConfirmations(job.id, "pending");

    void load
      .then((result) => {
        if (active) {
          setConfirmations(result.notifications);
          setConfirmationError(undefined);
        }
      })
      .catch((error) => {
        if (active) setConfirmationError(error instanceof Error ? error.message : "Confirmation history could not be loaded.");
      })
      .finally(() => {
        if (active) setConfirmationsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [canManageConfirmations, job?.id]);

  useEffect(() => {
    if (!job?.id || !canManageConfirmations || !confirmationPollingNeeded) return;
    let active = true;

    const poll = () => {
      if (document.visibilityState !== "visible") return;
      void fetchJobConfirmations(job.id)
        .then((result) => {
          if (!active) return;
          setConfirmations(result.notifications);
          setConfirmationError(undefined);
        })
        .catch(() => {
          // Preserve the last known state. Polling never sends or retries a
          // message, and the next visible pass can recover on its own.
        });
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") poll();
    };
    const pollId = window.setInterval(poll, 20_000);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      active = false;
      window.clearInterval(pollId);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [canManageConfirmations, confirmationPollingNeeded, job?.id]);

  async function refreshCompletionSignatures() {
    if (!job?.id) return;
    setSignatureLoading(true);
    setSignatureError(undefined);
    try {
      setCompletionSignatures(await loadSignatures({ type: "job", id: job.id }));
    } catch (error) {
      setSignatureError(error instanceof Error ? error.message : "The customer signature could not be loaded.");
    } finally {
      setSignatureLoading(false);
    }
  }

  useEffect(() => {
    if (!job?.id || currentUser.role === "call_center") return;
    void refreshCompletionSignatures();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, currentUser.role]);

  if (!job || !canViewJob(currentUser, job)) {
    return (
      <main className="page-shell">
        <EmptyState title="Job not available" description="This job either does not exist or is outside this role's access." />
      </main>
    );
  }

  const jobRecord = job;
  const canEditSchedule = canScheduleJobs(currentUser.role);
  const canEditDispatch = canEditSchedule
    && !job.arrivedAt
    && status !== "complete"
    && status !== "cancelled";
  const customer = data.customers.find((candidate) => candidate.id === job.customerId);
  const tech = data.allowedUsers.find((candidate) => candidate.id === assignedTechId);
  const activeTechs = data.allowedUsers.filter((user) => user.active && user.role === "tech");
  const photos = data.jobPhotos.filter((photo) => photo.jobId === job.id);
  const items = data.jobLineItems.filter((item) => item.jobId === job.id).sort((a, b) => a.sortOrder - b.sortOrder);
  const invoice = data.invoices.find((candidate) => candidate.jobId === job.id);
  const canEditLineItems = !invoice
    ? currentUser.role !== "call_center"
    : currentUser.role === "owner" && invoice.approvalStatus !== "signed";
  const jobId = job.id;
  const completionSignature = completionSignatures.find((signature) => signature.status === "active" && signature.purpose === "work_completion");
  const rejectedCompletionSignature = completionSignatures.find((signature) => signature.status === "rejected" && signature.purpose === "work_completion");
  const ownerOverrideReady = currentUser.role === "owner" && overrideConfirmed && overrideReason.trim().length >= 10;

  async function saveInspect(statusOverride?: JobStatus): Promise<boolean> {
    const nextStatus = statusOverride ?? status;
    if (canEditDispatch && (!scheduledAtIso || !arrivalWindowEndAtIso || !validWindow)) return false;
    const patch: Partial<Job> = {};
    const nextDescription = jobDescription.trim() || jobRecord.description;
    const nextAddress = serviceAddress.trim() || jobRecord.serviceAddress;
    if (nextDescription !== jobRecord.description) patch.description = nextDescription;
    if (canEditCustomerFacingFields && nextAddress !== jobRecord.serviceAddress) {
      patch.serviceAddress = nextAddress;
    }
    if (currentUser.role !== "call_center" && notes !== jobRecord.notes) patch.notes = notes;
    const completingJob = currentUser.role !== "call_center" && nextStatus === "complete" && jobRecord.status !== "complete";
    if (currentUser.role !== "call_center" && nextStatus !== jobRecord.status && !completingJob) patch.status = nextStatus;
    if (canEditDispatch) {
      const nextAssignedTechId = assignedTechId || null;
      if (nextAssignedTechId !== (jobRecord.assignedTechId ?? null)) patch.assignedTechId = nextAssignedTechId;
      if (scheduledAtIso && scheduledAtIso !== jobRecord.scheduledAt) patch.scheduledAt = scheduledAtIso;
      if (arrivalWindowEndAtIso && arrivalWindowEndAtIso !== jobRecord.arrivalWindowEndAt) patch.arrivalWindowEndAt = arrivalWindowEndAtIso;
    }
    if (completingJob && !completionSignature && !ownerOverrideReady) {
      setSaveError(currentUser.role === "owner"
        ? "Collect the customer signature or confirm an owner override with a reason."
        : "Collect the customer signature before completing this job.");
      return false;
    }
    setSaveBusy(true);
    setSaveError(undefined);
    try {
      await data.updateJob(jobId, patch);
      if (completingJob) {
        if (demoMode) {
          const completedAt = new Date().toISOString();
          await data.updateJob(jobId, {
            status: "complete",
            completedAt,
            ...(completionSignature ? {} : {
              completionSignatureOverrideAt: completedAt,
              completionSignatureOverrideBy: currentUser.id,
              completionSignatureOverrideReason: overrideReason.trim()
            })
          });
        } else {
          const completedJob = await completeProtectedJob(jobId, completionSignature ? undefined : overrideReason.trim());
          data.setState((current) => ({
            ...current,
            jobs: current.jobs.map((candidate) => candidate.id === completedJob.id ? completedJob : candidate)
          }));
        }
        setStatus("complete");
      }
      const customerFacingChange = Boolean(
        patch.scheduledAt !== undefined
        || patch.arrivalWindowEndAt !== undefined
        || patch.serviceAddress !== undefined
        || patch.status === "cancelled"
        || patch.status === "scheduled"
      );
      if (customerFacingChange && (currentUser.role === "owner" || currentUser.role === "call_center")) {
        setConfirmationBusy(true);
        setConfirmationError(undefined);
        try {
          const result = await dispatchJobConfirmations(jobId, "pending");
          setConfirmations(result.notifications);
        } catch (error) {
          setConfirmationError(error instanceof Error ? error.message : "The job was saved, but the customer update needs attention.");
        } finally {
          setConfirmationBusy(false);
        }
      }
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1400);
      return true;
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "The job could not be saved.");
      return false;
    } finally {
      setSaveBusy(false);
    }
  }

  async function buildInvoice() {
    setInvoiceBusy(true);
    setInvoiceError(undefined);
    try {
      const draft = demoMode
        ? data.createOrUpdateInvoiceDraft(jobId, currentUser.id)
        : await createProtectedInvoiceDraft(jobId);
      if (!demoMode) {
        data.setState((current) => ({
          ...current,
          invoices: current.invoices.some((candidate) => candidate.id === draft.id)
            ? current.invoices.map((candidate) => candidate.id === draft.id ? draft : candidate)
            : [draft, ...current.invoices]
        }));
      }
      router.push(`/invoices/${draft.id}`);
    } catch (error) {
      setInvoiceError(error instanceof Error ? error.message : "The invoice draft could not be built.");
    } finally {
      setInvoiceBusy(false);
    }
  }

  async function saveCompletionSignature(input: { signerName: string; signerRole: "customer" | "technician" | "company"; image: Blob; width: number; height: number }) {
    const saved = await saveSignature({
      target: { type: "job", id: jobId },
      purpose: "work_completion",
      signerName: input.signerName,
      signerRole: "customer",
      image: input.image,
      width: input.width,
      height: input.height,
      invoiceId: invoice?.id,
      jobId,
      collectedBy: currentUser.id
    });
    setCompletionSignatures((current) => [saved, ...current.map((signature) => (
      signature.status === "active" && signature.purpose === "work_completion"
        ? { ...signature, status: "rejected" as const, rejectedAt: saved.signedAt, rejectionReason: "Replaced by a newly collected signature." }
        : signature
    ))]);
    setSignatureDialogOpen(false);
    setSignatureError(undefined);
  }

  async function rejectCompletionSignature(reason: string) {
    if (!completionSignature) return;
    const rejected = await rejectSignature({ type: "job", id: jobId }, completionSignature.id, reason);
    setCompletionSignatures((current) => current.map((signature) => signature.id === rejected.id ? { ...signature, ...rejected } : signature));
  }

  async function markArrived(): Promise<boolean> {
    setArrivalBusy(true);
    setArrivalError(undefined);
    try {
      await data.markJobArrived(jobId);
      setStatus("in_progress");
      return true;
    } catch (error) {
      setArrivalError(error instanceof Error ? error.message : "The arrival could not be recorded.");
      return false;
    } finally {
      setArrivalBusy(false);
    }
  }

  async function markEnRoute(): Promise<boolean> {
    setArrivalBusy(true);
    setArrivalError(undefined);
    try {
      await data.markJobEnRoute(jobId);
      return true;
    } catch (error) {
      setArrivalError(error instanceof Error ? error.message : "The en-route status could not be recorded.");
      return false;
    } finally {
      setArrivalBusy(false);
    }
  }

  async function processConfirmations(mode: "retry" | "resend") {
    setConfirmationBusy(true);
    setConfirmationError(undefined);
    try {
      const result = await dispatchJobConfirmations(jobId, mode);
      setConfirmations(result.notifications);
    } catch (error) {
      setConfirmationError(error instanceof Error ? error.message : "The confirmation could not be processed.");
    } finally {
      setConfirmationBusy(false);
    }
  }

  const tierCounts = Object.fromEntries(tierOptions.map((tier) => [tier, items.filter((item) => item.tier === tier).length]));
  const canMarkEnRoute = !job.enRouteAt
    && !job.arrivedAt
    && status !== "complete"
    && status !== "cancelled"
    && currentUser.role !== "call_center";
  const canRecordArrival = Boolean(job.enRouteAt)
    && !job.arrivedAt
    && status !== "complete"
    && status !== "cancelled"
    && currentUser.role !== "call_center";
  const stage = jobStages.find((candidate) => candidate.id === activeStage) ?? jobStages[0];
  const stageCounts: Partial<Record<JobStage, number>> = {
    photos: photos.length,
    work: items.length,
    approval: completionSignature ? 1 : 0,
    invoice: invoice ? 1 : 0
  };
  const stageCompletion: Partial<Record<JobStage, boolean>> = {
    overview: Boolean(job.arrivedAt),
    photos: photos.length > 0,
    work: items.length > 0,
    approval: Boolean(completionSignature),
    invoice: Boolean(invoice)
  };
  const visibleStages: JobStage[] = currentUser.role === "call_center"
    ? ["overview"]
    : jobStages.map((candidate) => candidate.id);
  const primaryHidden = dispatchEditing || currentUser.role === "call_center";
  const primaryDisabled = activeStage === "work"
    ? items.length === 0
    : activeStage === "approval"
      ? !job.arrivedAt || status === "cancelled" || (Boolean(completionSignature) && saveBusy)
      : activeStage === "invoice"
        ? items.length === 0 || invoiceBusy
        : arrivalBusy || saveBusy;
  const primaryLabel = activeStage === "overview"
    ? status === "cancelled"
      ? "Back to schedule"
      : status === "complete"
        ? invoice ? "Open invoice" : "Continue to invoice"
        : canMarkEnRoute
          ? arrivalBusy ? "Updating…" : "On my way"
          : canRecordArrival
            ? arrivalBusy ? "Recording arrival…" : "Arrived — start job"
            : "Continue to photos"
    : activeStage === "photos"
      ? "Continue to work"
      : activeStage === "work"
        ? items.length === 0 ? "Add work to continue" : "Review approval"
        : activeStage === "approval"
          ? completionSignature
            ? job.status === "complete" ? "Continue to invoice" : saveBusy ? "Completing…" : "Complete job"
            : "Collect customer signature"
          : invoice
            ? "Open invoice"
            : invoiceBusy ? "Building invoice…" : "Build invoice";

  async function handlePrimaryAction() {
    if (activeStage === "overview") {
      if (status === "cancelled") {
        router.push("/jobs");
        return;
      }
      if (status === "complete") {
        if (invoice) router.push(`/invoices/${invoice.id}`);
        else setActiveStage("invoice");
        return;
      }
      if (canMarkEnRoute) {
        await markEnRoute();
        return;
      }
      if (canRecordArrival) {
        const arrived = await markArrived();
        if (arrived) setActiveStage("photos");
        return;
      }
      setActiveStage("photos");
      return;
    }
    if (activeStage === "photos") {
      setActiveStage("work");
      return;
    }
    if (activeStage === "work") {
      if (items.length > 0) setActiveStage("approval");
      return;
    }
    if (activeStage === "approval") {
      if (!completionSignature) {
        setSignatureDialogOpen(true);
        return;
      }
      if (jobRecord.status !== "complete") {
        setStatus("complete");
        await saveInspect("complete");
        return;
      }
      setActiveStage("invoice");
      return;
    }
    if (invoice) {
      router.push(`/invoices/${invoice.id}`);
      return;
    }
    await buildInvoice();
  }

  return (
    <main className={`page-shell ${styles.page}`}>
      <Link href="/jobs" className={styles.backLink}><ArrowLeft size={17} aria-hidden="true" />Back to jobs</Link>

      <header className={styles.hero}>
        <div className={styles.heroTop}>
          <div className={styles.heroCopy}>
            <div className={styles.heroEyebrow}>
              <span>Service job</span>
              <StatusPill tone={status === "complete" ? "good" : status === "cancelled" ? "bad" : "info"}>{status.replace("_", " ")}</StatusPill>
            </div>
            <h1>{jobDescription || job.description}</h1>
            <p>{customer?.name ?? "Unknown customer"}{customer ? ` · ${formatPhone(customer.phone)}` : ""}</p>
          </div>
          <div className={styles.headerActions}>
            {invoice ? <Link href={`/invoices/${invoice.id}`} className={styles.headerLink}><FileText size={17} aria-hidden="true" />Open invoice</Link> : null}
            {canEditDispatch ? (
              <button type="button" className={styles.editDispatchAction} aria-expanded={dispatchEditing} onClick={() => setDispatchEditing((open) => !open)}>
                {dispatchEditing ? "Close editor" : "Edit dispatch"}
              </button>
            ) : null}
          </div>
        </div>

        <div className={styles.summaryGrid} data-dispatch={currentUser.role !== "tech" || undefined}>
          <div className={styles.summaryFact}>
            <small>Arrival window</small>
            <strong>{formatServiceWindow(scheduledAtIso ?? job.scheduledAt, arrivalWindowEndAtIso ?? job.arrivalWindowEndAt)}</strong>
            <em>{job.arrivedAt ? `Arrived ${formatDateTime(job.arrivedAt)}` : job.enRouteAt ? `En route since ${formatDateTime(job.enRouteAt)}` : "Not yet en route"}</em>
          </div>
          <div className={styles.summaryFact}>
            <small>Service address</small>
            <strong>{serviceAddress || job.serviceAddress}</strong>
          </div>
          {currentUser.role !== "tech" ? (
            <div className={styles.summaryFact}>
              <small>Assigned technician</small>
              <strong>{tech?.displayName ?? "Unassigned"}</strong>
              <em>{tech ? roleLabel(tech.role) : "Needs assignment"}</em>
            </div>
          ) : null}
        </div>

        <div className={styles.customerActions} aria-label={customer ? `Contact ${customer.name}` : "Job actions"}>
          {customer ? <a href={`tel:${customer.phoneDigits || customer.phone}`}><Phone size={17} aria-hidden="true" /><span>Call</span></a> : null}
          {customer ? <a href={`sms:${customer.phoneDigits || customer.phone}`}><MessageSquare size={17} aria-hidden="true" /><span>Text</span></a> : null}
          <a href={mapsHref(serviceAddress || job.serviceAddress)} target="_blank" rel="noreferrer"><MapPin size={17} aria-hidden="true" /><span>Directions</span></a>
        </div>
      </header>

      <JobStageNav active={activeStage} onChange={setActiveStage} counts={stageCounts} completion={stageCompletion} visibleStages={visibleStages} />

      {arrivalError ? <p className={styles.errorBanner} role="alert">{arrivalError}</p> : null}
      {invoiceError ? <p className={styles.errorBanner} role="alert">{invoiceError}</p> : null}

      {activeStage === "overview" && canManageConfirmations ? (
        <details className={styles.confirmationDisclosure}>
          <summary>
            <span><strong>Customer confirmations</strong><small>View delivery status and resend options</small></span>
            <ChevronRight size={18} aria-hidden="true" />
          </summary>
          <div className={styles.confirmationBody}>
            <AppointmentConfirmationCard
              notifications={confirmations}
              loading={confirmationsLoading}
              busy={confirmationBusy || saveBusy}
              error={confirmationError}
              canManage
              activeJob={job.status === "scheduled" || job.status === "cancelled"}
              onRetry={() => void processConfirmations("retry")}
              onResend={() => void processConfirmations("resend")}
            />
          </div>
        </details>
      ) : null}

      <div
        className={`${styles.stagePanel} ${activeStage === "overview" && !dispatchEditing ? styles.overviewPanel : ""}`}
        role="tabpanel"
        id={`job-stage-panel-${activeStage}`}
        aria-labelledby={`job-stage-${activeStage}`}
      >
        {activeStage !== "overview" || dispatchEditing ? (
          <div className={styles.stageHeader}>
            <div><p>{dispatchEditing ? "Dispatch" : stage.label}</p><h2>{dispatchEditing ? "Edit job details" : stageTitle(activeStage)}</h2><span>{dispatchEditing ? "Update the customer-facing service details, arrival window, and assignment." : stageDescription(activeStage)}</span></div>
            {activeStage === "photos" && photos.length === 0 ? null : activeStage === "overview" ? null : <span className={styles.stageCount}>{activeStage === "photos" ? `${photos.length} saved` : activeStage === "work" ? `${items.length} items` : activeStage === "approval" ? completionSignature ? "Signed" : "Signature needed" : invoice ? "Draft ready" : "Not built"}</span>}
          </div>
        ) : null}

        {activeStage === "overview" ? (
          dispatchEditing && canManageConfirmations ? (
            <div className={styles.stageBody}>
              <div className={styles.formGrid}>
                <Field label="Service call"><textarea value={jobDescription} onChange={(event) => setJobDescription(event.target.value)} /></Field>
                <Field label="Service address">
                  <AddressAutocomplete value={serviceAddress} onChange={setServiceAddress} onSelect={(address) => setServiceAddress(address.formatted)} />
                </Field>
              </div>
              <div className={styles.dispatchGrid}>
                <ArrivalWindowField value={arrivalWindowDraft} onChange={setArrivalWindowDraft} required />
                <Field label="Assigned technician">
                  <select value={assignedTechId} onChange={(event) => setAssignedTechId(event.target.value)}>
                    <option value="">Unassigned</option>
                    {activeTechs.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.displayName}</option>)}
                  </select>
                </Field>
              </div>
              {canEditDispatch && conflicts.length > 0 ? (
                <div className={styles.conflict} role="status"><strong>Overlapping customer arrival windows</strong><span>{conflicts.length === 1 ? "This technician has another customer window at the same time. You can still save after reviewing the assignment." : `This technician has ${conflicts.length} other customer windows at the same time. You can still save after reviewing the assignment.`}</span></div>
              ) : null}

              {currentUser.role === "owner" ? (
                <div className={styles.formGrid}>
                  <Field label="Job status">
                    <div className="segmented-control">
                      {(["scheduled", "in_progress", "complete", "cancelled"] as JobStatus[]).map((option) => (
                        <button key={option} type="button" className={status === option ? "active" : ""} onClick={() => {
                          setStatus(option);
                          if (option === "complete") setActiveStage("approval");
                        }} disabled={((option === "in_progress" || option === "complete") && !job.arrivedAt) || (option === "scheduled" && Boolean(job.arrivedAt))}>{option.replace("_", " ")}</button>
                      ))}
                    </div>
                  </Field>
                  <Field label="Technician notes"><textarea value={notes} onChange={(event) => setNotes(event.target.value)} /></Field>
                </div>
              ) : null}
              {saveError ? <p className={styles.errorBanner} role="alert">{saveError}</p> : null}
              <div className={styles.editorActions}>
                <button type="button" className={styles.cancelAction} onClick={() => setDispatchEditing(false)}>Cancel</button>
                <Button variant="secondary" onClick={() => void (async () => {
                  const didSave = await saveInspect();
                  if (didSave) setDispatchEditing(false);
                })()} disabled={saveBusy || !validWindow}><Save size={16} aria-hidden="true" />{saveBusy ? "Saving…" : saved ? "Saved" : "Save dispatch"}</Button>
              </div>
            </div>
          ) : currentUser.role === "tech" ? (
            <details className={styles.notesDisclosure}>
              <summary><span><strong>Job notes</strong><small>{notes.trim() ? "View or update technician notes" : "Add a technician note"}</small></span><ChevronRight size={18} aria-hidden="true" /></summary>
              <div className={styles.notesEditor}>
                <Field label="Technician notes"><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Diagnosis, access notes, equipment details…" /></Field>
                {saveError ? <p className={styles.errorBanner} role="alert">{saveError}</p> : null}
                <Button variant="secondary" onClick={() => void saveInspect()} disabled={saveBusy}><Save size={16} aria-hidden="true" />{saveBusy ? "Saving…" : saved ? "Saved" : "Save notes"}</Button>
              </div>
            </details>
          ) : (
            <div className={styles.readonlyNotes}><small>Job notes</small><p>{notes.trim() || "No technician notes have been added."}</p></div>
          )
        ) : null}

        {activeStage === "photos" ? (
          canSeePhotos(currentUser.role) ? (
            <div className={styles.stageBody}>
              <PhotoUploader jobId={job.id} uploadedBy={currentUser.id} />
              {photos.length > 0 ? (
                <section className={styles.photoGallery} aria-label="Saved job photos">
                  <div className={styles.photoGalleryHeader}><strong>Saved photos</strong><span>{photos.length}</span></div>
                  <div className={styles.photoGrid}>{photos.map((photo) => <article key={photo.id} className={styles.photoCard}>{photo.storagePath.startsWith("data:") || photo.storagePath.startsWith("http") ? <img src={photo.storagePath} alt={photo.caption ?? photo.kind} /> : <div className={styles.photoPlaceholder}>Private photo</div>}<div><strong>{photo.kind}</strong><span>{photo.caption ?? photo.storagePath}</span></div></article>)}</div>
                </section>
              ) : null}
            </div>
          ) : <ProtectedStage />
        ) : null}

        {activeStage === "work" ? (
          canSeeMoney(currentUser.role) ? (
            <div className={styles.stageBody}>
              <section className={styles.innerPanel}>
                <div className={styles.subhead}><div><h3>Add work</h3><p>Good, Better, and Best stay here as customer estimate choices.</p></div><span>{items.length} items</span></div>
                {canEditLineItems ? <LineItemForm jobId={job.id} /> : <p className={styles.inlineNote}>{invoice?.approvalStatus === "signed" ? "Charges are locked to the saved customer approval. An owner must reject that signature before changing work items." : "Invoice charges are owner-controlled after a draft is created."}</p>}
              </section>
              <section className={styles.innerPanel}>
                <div className={styles.subhead}><div><h3>Estimate options</h3><p>Review the three service levels with the customer.</p></div><span>Good {tierCounts.good} · Better {tierCounts.better} · Best {tierCounts.best}</span></div>
                <TierColumns items={items} taxRate={0.06} editable={canEditLineItems} onEdit={canEditLineItems ? data.updateLineItem : undefined} onDelete={canEditLineItems ? data.deleteLineItem : undefined} />
              </section>
            </div>
          ) : <ProtectedStage />
        ) : null}

        {activeStage === "approval" ? (
          currentUser.role !== "call_center" ? (
            <div className={styles.stageBody}>
              <section className={styles.approvalPanel}>
                <div className={styles.approvalIntro}><span><PenLine size={21} aria-hidden="true" /></span><div><h3>Customer work-completion signature</h3><p>Review the completed work together, then let the customer draw their signature on this iPad.</p></div></div>
                <SignatureStatusCard title="Work reviewed and approved" signature={completionSignature} rejectedSignature={rejectedCompletionSignature} loading={signatureLoading} error={signatureError} drawLabel="Collect customer signature" onDraw={() => setSignatureDialogOpen(true)} onRetry={() => void refreshCompletionSignatures()} canReject={currentUser.role === "owner" && job.status !== "complete"} onReject={completionSignature ? rejectCompletionSignature : undefined} drawDisabled={!job.arrivedAt || job.status === "complete" || job.status === "cancelled"} />
                <p className={styles.inlineNote}>{!job.arrivedAt ? "Record the technician arrival before collecting the customer completion signature." : completionSignature ? "Signature saved. The job is ready to complete." : currentUser.role === "owner" ? "A signature is required unless the owner records an explicit audited override." : "A saved customer signature is required before completion."}</p>
              </section>
              {!completionSignature && currentUser.role === "owner" && job.status !== "complete" ? (
                <section className={styles.overridePanel}><h3>Owner completion override</h3><p>Use only when the customer cannot sign. The reason and owner identity remain in the audit record.</p><Field label="Override reason"><textarea value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} placeholder="Explain why a customer signature could not be collected." /></Field><label className={styles.overrideCheck}><input type="checkbox" checked={overrideConfirmed} onChange={(event) => setOverrideConfirmed(event.target.checked)} />I am explicitly overriding the required customer signature as the owner.</label>{ownerOverrideReady ? <button className={styles.overrideAction} type="button" onClick={() => void saveInspect("complete")} disabled={saveBusy}>{saveBusy ? "Completing…" : "Complete with owner override"}</button> : null}</section>
              ) : null}
              {saveError ? <p className={styles.errorBanner} role="alert">{saveError}</p> : null}
            </div>
          ) : <ProtectedStage />
        ) : null}

        {activeStage === "invoice" ? (
          canSeeMoney(currentUser.role) ? (
            <div className={styles.stageBody}>
              {items.length === 0 ? <EmptyState title="Add work first" description="At least one work item is required before an invoice draft can be built." action={<button type="button" className={styles.quietAction} onClick={() => setActiveStage("work")}>Go to work items</button>} /> : (
                <section className={styles.invoiceReady} data-ready={Boolean(invoice) || undefined}>
                  <span className={styles.invoiceIcon}>{invoice ? <Check size={24} aria-hidden="true" /> : <FileText size={24} aria-hidden="true" />}</span>
                  <div><small>{invoice ? "Invoice draft ready" : "Ready to build"}</small><h3>{invoice ? "Review the saved invoice" : "Create an invoice from this work"}</h3><p>{invoice ? "The draft includes the current work items, tax, and saved customer details." : "Fast Track will build a professional draft using the work and customer information already saved."}</p></div>
                  {invoice ? (
                    <div className={styles.invoiceActions}>
                      <StatusPill tone={invoice.status === "sent" ? "good" : "warn"}>{invoice.status}</StatusPill>
                      <button type="button" className={styles.quietAction} onClick={() => void buildInvoice()} disabled={invoiceBusy}>
                        {invoiceBusy ? "Refreshing…" : "Refresh draft"}
                      </button>
                    </div>
                  ) : null}
                </section>
              )}
            </div>
          ) : <ProtectedStage />
        ) : null}
      </div>

      {!primaryHidden ? (
        <aside className={styles.stickyAction} aria-label="Next job action">
          <div><small>Next action</small><strong>{primaryHelper(activeStage, { canMarkEnRoute, canRecordArrival, completionSignature: Boolean(completionSignature), invoice: Boolean(invoice), jobComplete: job.status === "complete", jobCancelled: job.status === "cancelled" })}</strong></div>
          <button type="button" className={styles.primaryAction} onClick={() => void handlePrimaryAction()} disabled={primaryDisabled}>{activeStage === "overview" && currentUser.role === "call_center" ? <Save size={18} aria-hidden="true" /> : activeStage === "approval" && !completionSignature ? <PenLine size={18} aria-hidden="true" /> : null}{primaryLabel}<ChevronRight size={18} aria-hidden="true" /></button>
        </aside>
      ) : null}

      <SignatureDialog
        open={signatureDialogOpen}
        title="Customer work approval"
        description="The customer confirms that the completed work was reviewed and approved. Saving must finish before the job can be completed."
        signerRole="customer"
        defaultSignerName={customer?.name}
        onCancel={() => setSignatureDialogOpen(false)}
        onSave={saveCompletionSignature}
      />
    </main>
  );
}

function ProtectedStage() {
  return (
    <div className={styles.protectedStage}>
      <span><UserRound size={22} aria-hidden="true" /></span>
      <div><h3>This section is not part of your role</h3><p>Call center access stays focused on customer details, scheduling, and confirmations.</p></div>
    </div>
  );
}

function roleLabel(role: string): string {
  if (role === "call_center") return "Call center";
  if (role === "tech") return "Field technician";
  if (role === "owner") return "Owner";
  return role.replaceAll("_", " ");
}

function stageTitle(stage: JobStage): string {
  if (stage === "overview") return "Customer and dispatch";
  if (stage === "photos") return "Photos and job proof";
  if (stage === "work") return "Work and estimate options";
  if (stage === "approval") return "Customer approval";
  return "Invoice handoff";
}

function stageDescription(stage: JobStage): string {
  if (stage === "overview") return "Confirm who, where, and when before the technician starts.";
  if (stage === "photos") return "Keep clear visual proof without leaving the job workflow.";
  if (stage === "work") return "Build the service scope and customer choices in one place.";
  if (stage === "approval") return "Review the completed work and capture a saved signature.";
  return "Create or open the invoice using the work already saved.";
}

function primaryHelper(
  stage: JobStage,
  state: { canMarkEnRoute: boolean; canRecordArrival: boolean; completionSignature: boolean; invoice: boolean; jobComplete: boolean; jobCancelled: boolean }
): string {
  if (stage === "overview") {
    if (state.jobCancelled) return "Return to your service schedule";
    if (state.jobComplete) return state.invoice ? "Open the saved invoice" : "Continue to the invoice handoff";
    if (state.canMarkEnRoute) return "Mark the trip started before you leave";
    return state.canRecordArrival ? "Record the real arrival time and begin work" : "Move to photo documentation";
  }
  if (stage === "photos") return "Continue when the job proof is ready";
  if (stage === "work") return "Review the saved scope with the customer";
  if (stage === "approval") {
    if (!state.completionSignature) return "Pass the iPad to the customer";
    return state.jobComplete ? "The signed job is ready to invoice" : "Save the completed job to the audit record";
  }
  return state.invoice ? "Continue in the invoice workspace" : "Use the saved customer and work details";
}

function mapsHref(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

function shouldPollConfirmationStatus(
  notifications: AppointmentNotificationSummary[],
  now: number
): boolean {
  const latestSms = [...notifications]
    .filter((notification) => notification.channel === "sms")
    .sort((a, b) => Date.parse(b.queuedAt) - Date.parse(a.queuedAt))[0];
  if (!latestSms) return false;

  if (latestSms.status === "queued" || latestSms.status === "processing") return true;
  if (latestSms.status !== "accepted") return false;

  const providerStatus = String(latestSms.providerStatus ?? "").toLowerCase();
  if (["delivered", "read", "failed", "undelivered", "canceled"].includes(providerStatus)) {
    return false;
  }

  const acceptedAt = Date.parse(latestSms.acceptedAt ?? latestSms.queuedAt);
  return Number.isFinite(acceptedAt) && now - acceptedAt < 15 * 60 * 1000;
}
