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
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { tierLabels, tierOptions, useAppData } from "@/lib/data-store";
import { canScheduleJobs, canSeeMoney, canSeePhotos, canViewJob } from "@/lib/access";
import { formatDateTime } from "@/lib/date";
import { money } from "@/lib/money";
import { subtotalForTier } from "@/lib/invoice";
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
import type { AppointmentNotificationSummary, InvoiceSignature, Job, JobStatus, SignaturePurpose, Tier } from "@/lib/types";
import styles from "./JobDetail.module.css";

export default function JobDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { currentUser } = useAuth();
  const data = useAppData();
  const job = data.jobs.find((candidate) => candidate.id === params.id);
  const firstPopulatedJobTier = useMemo<Tier>(() => {
    if (!job) return "standard";
    return tierOptions.find((tier) => data.jobLineItems.some((item) => item.jobId === job.id && item.tier === tier)) ?? "standard";
  }, [data.jobLineItems, job]);
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
  const [jobSignatures, setJobSignatures] = useState<InvoiceSignature[]>([]);
  const [signatureLoading, setSignatureLoading] = useState(currentUser.role !== "call_center");
  const [signatureError, setSignatureError] = useState<string | undefined>();
  const [signatureDialogPurpose, setSignatureDialogPurpose] = useState<Extract<SignaturePurpose, "work_authorization" | "work_completion"> | undefined>();
  const [authorizationTier, setAuthorizationTier] = useState<Tier>(firstPopulatedJobTier);
  const [visibleEstimateTier, setVisibleEstimateTier] = useState<Tier>(firstPopulatedJobTier);
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideConfirmed, setOverrideConfirmed] = useState(false);
  const [activeStage, setActiveStage] = useState<JobStage>("overview");
  const [dispatchEditing, setDispatchEditing] = useState(false);
  const handledSigningLink = useRef<string | undefined>(undefined);
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
    setAuthorizationTier(firstPopulatedJobTier);
    setVisibleEstimateTier(firstPopulatedJobTier);
    setJobSignatures([]);
    setSignatureLoading(currentUser.role !== "call_center");
    setSignatureError(undefined);
    setSignatureDialogPurpose(undefined);
    setActiveStage("overview");
    setDispatchEditing(false);
  }, [currentUser.role, job?.id]);

  useEffect(() => {
    if (!job) return;
    const activeAuthorizationTier = jobSignatures.find((signature) => (
      signature.status === "active" && signature.purpose === "work_authorization"
    ))?.selectedTier;
    if (activeAuthorizationTier) {
      setAuthorizationTier(activeAuthorizationTier);
      return;
    }
    setAuthorizationTier((current) => (
      data.jobLineItems.some((item) => item.jobId === job.id && item.tier === current)
        ? current
        : firstPopulatedJobTier
    ));
  }, [data.jobLineItems, firstPopulatedJobTier, job, jobSignatures]);

  useEffect(() => {
    if (!job || typeof window === "undefined") return;
    const search = new URLSearchParams(window.location.search);
    const requestedStage = search.get("stage");
    const requestedSignature = search.get("sign");
    const requestKey = `${job.id}:${requestedStage ?? ""}:${requestedSignature ?? ""}`;
    if (handledSigningLink.current === requestKey) return;
    handledSigningLink.current = requestKey;

    if (jobStages.some((candidate) => candidate.id === requestedStage)) {
      setActiveStage(requestedStage as JobStage);
    }
    if (
      requestedSignature === "work_authorization"
      && currentUser.role !== "call_center"
      && job.status !== "complete"
      && job.status !== "cancelled"
      && data.jobLineItems.some((item) => item.jobId === job.id && item.tier === firstPopulatedJobTier)
    ) {
      setAuthorizationTier(firstPopulatedJobTier);
      setActiveStage("approval");
      setSignatureDialogPurpose("work_authorization");
    }
  }, [currentUser.role, data.jobLineItems, firstPopulatedJobTier, job]);

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

  async function refreshJobSignatures() {
    if (!job?.id) return;
    setSignatureLoading(true);
    setSignatureError(undefined);
    try {
      setJobSignatures(await loadSignatures({ type: "job", id: job.id }));
    } catch (error) {
      setJobSignatures([]);
      setSignatureError(error instanceof Error ? error.message : "The customer signature could not be loaded.");
    } finally {
      setSignatureLoading(false);
    }
  }

  useEffect(() => {
    if (!job?.id || currentUser.role === "call_center") return;
    void refreshJobSignatures();
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
  const jobId = job.id;
  const authorizationSignature = jobSignatures.find((signature) => signature.status === "active" && signature.purpose === "work_authorization");
  const rejectedAuthorizationSignature = jobSignatures.find((signature) => signature.status === "rejected" && signature.purpose === "work_authorization");
  const completionSignature = jobSignatures.find((signature) => signature.status === "active" && signature.purpose === "work_completion");
  const rejectedCompletionSignature = jobSignatures.find((signature) => signature.status === "rejected" && signature.purpose === "work_completion");
  const selectedAuthorizationTier = authorizationSignature?.selectedTier ?? authorizationTier;
  const selectedAuthorizationItems = items.filter((item) => item.tier === selectedAuthorizationTier);
  const beforePhotos = photos.filter((photo) => photo.kind === "before");
  const afterPhotos = photos.filter((photo) => photo.kind === "after");
  const signatureCheckpointUnavailable = signatureLoading || Boolean(signatureError);
  const completionFieldsLocked = signatureCheckpointUnavailable
    || Boolean(completionSignature)
    || status === "complete"
    || Boolean(job.completedAt)
    || Boolean(job.completionSignatureOverrideAt);
  const canEditLineItems = currentUser.role !== "call_center"
    && !signatureCheckpointUnavailable
    && !authorizationSignature
    && status !== "complete"
    && status !== "cancelled";
  const ownerOverrideReady = currentUser.role === "owner" && overrideConfirmed && overrideReason.trim().length >= 10;

  function openWorkAuthorization() {
    const requestedTier = selectedAuthorizationItems.length > 0
      ? authorizationTier
      : firstPopulatedJobTier;
    const requestedItems = items.filter((item) => item.tier === requestedTier);
    if (requestedItems.length === 0) {
      setSaveError("Add at least one work item before asking the customer to sign.");
      setActiveStage("work");
      return;
    }
    setSaveError(undefined);
    setAuthorizationTier(requestedTier);
    setActiveStage("approval");
    setSignatureDialogPurpose("work_authorization");
  }

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
    if (currentUser.role !== "call_center" && !completionFieldsLocked && notes !== jobRecord.notes) patch.notes = notes;
    const completingJob = currentUser.role !== "call_center" && nextStatus === "complete" && jobRecord.status !== "complete";
    if (currentUser.role !== "call_center" && nextStatus !== jobRecord.status && !completingJob) patch.status = nextStatus;
    if (canEditDispatch) {
      const nextAssignedTechId = assignedTechId || null;
      if (nextAssignedTechId !== (jobRecord.assignedTechId ?? null)) patch.assignedTechId = nextAssignedTechId;
      if (scheduledAtIso && scheduledAtIso !== jobRecord.scheduledAt) patch.scheduledAt = scheduledAtIso;
      if (arrivalWindowEndAtIso && arrivalWindowEndAtIso !== jobRecord.arrivalWindowEndAt) patch.arrivalWindowEndAt = arrivalWindowEndAtIso;
    }
    if (completingJob && signatureCheckpointUnavailable) {
      setSaveError("Signature status must load successfully before this job can be completed.");
      return false;
    }
    if (completingJob && !authorizationSignature) {
      setSaveError("Collect the customer's work authorization before completing this job.");
      return false;
    }
    if (completingJob && afterPhotos.length === 0) {
      setSaveError("Save at least one after photo before completing this job.");
      return false;
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
    if (items.length === 0) {
      setInvoiceError("Add at least one work item before building the invoice draft.");
      return;
    }
    setInvoiceBusy(true);
    setInvoiceError(undefined);
    try {
      const draft = demoMode
        ? data.createOrUpdateInvoiceDraft(jobId, currentUser.id)
        : await createProtectedInvoiceDraft(jobId);
      const draftTier = authorizationSignature?.selectedTier ?? firstPopulatedJobTier;
      if (demoMode && draft.selectedTier !== draftTier) {
        data.updateInvoice(draft.id, { selectedTier: draftTier });
        draft.selectedTier = draftTier;
      } else if (!demoMode) {
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

  async function saveJobSignature(input: { signerName: string; signerRole: "customer" | "technician" | "company"; image: Blob; width: number; height: number }) {
    const purpose = signatureDialogPurpose;
    if (!purpose) return;
    const saved = await saveSignature({
      target: { type: "job", id: jobId },
      purpose,
      signerName: input.signerName,
      signerRole: "customer",
      image: input.image,
      width: input.width,
      height: input.height,
      invoiceId: invoice?.id,
      jobId,
      collectedBy: currentUser.id,
      selectedTier: purpose === "work_authorization" ? authorizationTier : undefined
    });
    setJobSignatures((current) => [saved, ...current.map((signature) => (
      signature.status === "active" && signature.purpose === purpose
        ? { ...signature, status: "rejected" as const, rejectedAt: saved.signedAt, rejectionReason: "Replaced by a newly collected signature." }
        : signature
    ))]);
    setSignatureDialogPurpose(undefined);
    setSignatureError(undefined);
    if (purpose === "work_authorization") setActiveStage("after");
  }

  async function rejectJobSignature(signature: InvoiceSignature, reason: string) {
    const rejected = await rejectSignature({ type: "job", id: jobId }, signature.id, reason);
    setJobSignatures((current) => current.map((candidate) => candidate.id === rejected.id ? { ...candidate, ...rejected } : candidate));
    if (signature.purpose === "work_authorization") {
      setAuthorizationTier(signature.selectedTier ?? firstPopulatedJobTier);
      setActiveStage("work");
    }
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
    photos: beforePhotos.length,
    work: items.length,
    approval: authorizationSignature ? 1 : 0,
    after: afterPhotos.length,
    completion: completionSignature ? 1 : 0,
    invoice: invoice ? 1 : 0
  };
  const stageCompletion: Partial<Record<JobStage, boolean>> = {
    overview: Boolean(job.arrivedAt),
    photos: beforePhotos.length > 0,
    work: items.length > 0,
    approval: Boolean(authorizationSignature),
    after: afterPhotos.length > 0,
    completion: Boolean(completionSignature) || job.status === "complete",
    invoice: Boolean(invoice)
  };
  const visibleStages: JobStage[] = currentUser.role === "call_center"
    ? ["overview"]
    : jobStages.map((candidate) => candidate.id);
  const primaryHidden = dispatchEditing || currentUser.role === "call_center";
  const disabledStages: JobStage[] = [];
  const primaryDisabled = activeStage === "photos"
    ? beforePhotos.length === 0
    : activeStage === "work"
      ? items.length === 0
      : activeStage === "approval"
        ? signatureCheckpointUnavailable || selectedAuthorizationItems.length === 0 || status === "complete" || status === "cancelled"
        : activeStage === "after"
          ? afterPhotos.length === 0
          : activeStage === "completion"
            ? signatureCheckpointUnavailable || !authorizationSignature || afterPhotos.length === 0 || status === "cancelled" || saveBusy
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
      ? beforePhotos.length === 0 ? "Add a before photo" : "Build estimate"
      : activeStage === "work"
        ? items.length === 0 ? "Add work to continue" : "Review with customer"
        : activeStage === "approval"
          ? authorizationSignature ? "Begin approved work" : "Authorize work"
          : activeStage === "after"
            ? afterPhotos.length === 0 ? "Add an after photo" : "Review completed work"
            : activeStage === "completion"
              ? completionSignature
                ? job.status === "complete" ? "Continue to invoice" : saveBusy ? "Completing…" : "Complete job"
                : "Confirm completed work"
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
      if (beforePhotos.length > 0) setActiveStage("work");
      return;
    }
    if (activeStage === "work") {
      if (items.length > 0) setActiveStage("approval");
      return;
    }
    if (activeStage === "approval") {
      if (!authorizationSignature) {
        openWorkAuthorization();
        return;
      }
      setActiveStage("after");
      return;
    }
    if (activeStage === "after") {
      if (afterPhotos.length > 0) setActiveStage("completion");
      return;
    }
    if (activeStage === "completion") {
      if (!completionSignature) {
        setSignatureDialogPurpose("work_completion");
        return;
      }
      if (jobRecord.status !== "complete") {
        setStatus("complete");
        const completed = await saveInspect("complete");
        if (completed) setActiveStage("invoice");
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
              <span>Field visit</span>
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

      <JobStageNav active={activeStage} onChange={setActiveStage} counts={stageCounts} completion={stageCompletion} visibleStages={visibleStages} disabledStages={disabledStages} />

      {arrivalError ? <p className={styles.errorBanner} role="alert">{arrivalError}</p> : null}
      {invoiceError ? <p className={styles.errorBanner} role="alert">{invoiceError}</p> : null}

      {currentUser.role !== "call_center"
        && !signatureLoading
        && !authorizationSignature
        && job.status !== "complete"
        && job.status !== "cancelled"
        && items.length > 0 ? (
          <section className={styles.workflowNotice} aria-label="Customer authorization not signed">
            <div>
              <strong>Customer authorization not signed</strong>
              <span>The estimate and invoice draft stay visible. Collect the signature whenever the customer is ready; final completion and sending remain protected.</span>
            </div>
            <button type="button" onClick={openWorkAuthorization}><PenLine size={17} aria-hidden="true" />Sign now</button>
          </section>
        ) : null}

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
            {activeStage === "overview" ? null : <span className={styles.stageCount}>{stageStatusLabel(activeStage, { beforeCount: beforePhotos.length, afterCount: afterPhotos.length, itemCount: items.length, authorized: Boolean(authorizationSignature), completed: Boolean(completionSignature), invoice: Boolean(invoice) })}</span>}
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
                          if (option === "complete") setActiveStage("completion");
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
          ) : currentUser.role === "tech" && !completionFieldsLocked ? (
            <details className={styles.notesDisclosure}>
              <summary><span><strong>Job notes</strong><small>{notes.trim() ? "View or update technician notes" : "Add a technician note"}</small></span><ChevronRight size={18} aria-hidden="true" /></summary>
              <div className={styles.notesEditor}>
                <Field label="Technician notes"><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Diagnosis, access notes, equipment details…" /></Field>
                {saveError ? <p className={styles.errorBanner} role="alert">{saveError}</p> : null}
                <Button variant="secondary" onClick={() => void saveInspect()} disabled={saveBusy}><Save size={16} aria-hidden="true" />{saveBusy ? "Saving…" : saved ? "Saved" : "Save notes"}</Button>
              </div>
            </details>
          ) : (
            <div className={styles.readonlyNotes}><small>Job notes{completionFieldsLocked && currentUser.role !== "call_center" ? " · locked" : ""}</small><p>{notes.trim() || "No technician notes have been added."}</p></div>
          )
        ) : null}

        {activeStage === "photos" ? (
          canSeePhotos(currentUser.role) ? (
            <div className={styles.stageBody}>
              <div className={styles.checkpointNotice}><strong>Required before work begins</strong><span>Capture the existing condition so the customer and technician share the same starting point.</span></div>
              <PhotoUploader
                jobId={job.id}
                uploadedBy={currentUser.id}
                lockedKind="before"
                checkpointLocked={completionFieldsLocked}
                lockedTitle={signatureCheckpointUnavailable ? "Checking signed checkpoint" : "Before photos locked by completed work"}
                lockedMessage={signatureError ? "Saved signature status is unavailable. Retry the signature check before changing checkpoint evidence." : signatureLoading ? "Saved signatures are loading. Evidence stays locked until that check finishes." : "This job has a completion record, so its before-work evidence is now permanent."}
              />
              {beforePhotos.length > 0 ? (
                <section className={styles.photoGallery} aria-label="Saved before-work photos">
                  <div className={styles.photoGalleryHeader}><strong>Before-work evidence</strong><span>{beforePhotos.length}</span></div>
                  <div className={styles.photoGrid}>{beforePhotos.map((photo) => <article key={photo.id} className={styles.photoCard}>{photo.storagePath.startsWith("data:") || photo.storagePath.startsWith("http") ? <img src={photo.storagePath} alt={photo.caption ?? "Before work"} /> : <div className={styles.photoPlaceholder}>Private photo</div>}<div><strong>Before</strong><span>{photo.caption ?? photo.storagePath}</span></div></article>)}</div>
                </section>
              ) : null}
            </div>
          ) : <ProtectedStage />
        ) : null}

        {activeStage === "work" ? (
          canSeeMoney(currentUser.role) ? (
            <div className={styles.stageBody}>
              <section className={styles.innerPanel}>
                <div className={styles.subhead}><div><h3>Build the proposed work</h3><p>Enter the real scope and price for this visit. Technicians can create custom work, change quantities, set prices, and choose any option.</p></div><span>{items.length} items</span></div>
                {canEditLineItems ? <LineItemForm jobId={job.id} onSaved={setVisibleEstimateTier} /> : <p className={styles.inlineNote}>{signatureCheckpointUnavailable ? "Saved signature status must load successfully before scope or pricing can be edited." : "The customer signed this scope. Reject the authorization first if the work or price needs to change."}</p>}
              </section>
              <section className={styles.innerPanel}>
                <div className={styles.subhead}><div><h3>Customer choices</h3><p>Use Standard for a neutral quote, or offer Good, Better, and Best when choices help.</p></div><span>Standard {tierCounts.standard} · Good {tierCounts.good} · Better {tierCounts.better} · Best {tierCounts.best}</span></div>
                <TierColumns items={items} taxRate={0.06} editable={canEditLineItems} activeTier={visibleEstimateTier} onActiveTierChange={setVisibleEstimateTier} onEdit={canEditLineItems ? data.updateLineItem : undefined} onDelete={canEditLineItems ? data.deleteLineItem : undefined} />
              </section>
            </div>
          ) : <ProtectedStage />
        ) : null}

        {activeStage === "approval" ? (
          currentUser.role !== "call_center" ? (
            <div className={styles.stageBody}>
              <section className={styles.approvalPanel}>
                <div className={styles.approvalIntro}><span><PenLine size={21} aria-hidden="true" /></span><div><h3>Choose and authorize the work</h3><p>Review the exact scope and total with the customer. Work cannot begin until the customer signs.</p></div></div>
                <div className={styles.authorizationOptions} role="radiogroup" aria-label="Estimate option to authorize">
                  {tierOptions.map((tier) => {
                    const optionItems = items.filter((item) => item.tier === tier);
                    const optionSubtotal = subtotalForTier(items, tier);
                    const selected = selectedAuthorizationTier === tier;
                    return <button key={tier} type="button" role="radio" aria-checked={selected} data-selected={selected || undefined} disabled={Boolean(authorizationSignature) || optionItems.length === 0} onClick={() => setAuthorizationTier(tier)}><span>{tierLabels[tier]}</span><strong>{optionItems.length === 0 ? "No work" : money(optionSubtotal * 1.06)}</strong><small>{optionItems.length} {optionItems.length === 1 ? "item" : "items"} · includes tax</small></button>;
                  })}
                </div>
                <SignatureStatusCard title="Customer authorization before work" signature={authorizationSignature} rejectedSignature={rejectedAuthorizationSignature} loading={signatureLoading} error={signatureError} drawLabel="Authorize selected work" onDraw={openWorkAuthorization} onRetry={() => void refreshJobSignatures()} canReject={Boolean(authorizationSignature) && job.status !== "complete"} onReject={authorizationSignature ? (reason) => rejectJobSignature(authorizationSignature, reason) : undefined} drawDisabled={signatureCheckpointUnavailable || selectedAuthorizationItems.length === 0 || job.status === "complete" || job.status === "cancelled"} />
                <p className={styles.inlineNote}>{authorizationSignature ? `${tierLabels[selectedAuthorizationTier]} work is authorized. The signed scope is now locked.` : selectedAuthorizationItems.length === 0 ? "Choose an option that contains at least one work item." : "Pass the iPad to the customer and tap Authorize selected work. Arrival and photo records do not prevent the signature pad from opening."}</p>
              </section>
            </div>
          ) : <ProtectedStage />
        ) : null}

        {activeStage === "after" ? (
          canSeePhotos(currentUser.role) ? (
            <div className={styles.stageBody}>
              <div className={styles.checkpointNotice}><strong>Finish the approved work, then document it</strong><span>Capture at least one clear after photo before asking the customer to confirm completion.</span></div>
              <PhotoUploader
                jobId={job.id}
                uploadedBy={currentUser.id}
                lockedKind="after"
                checkpointLocked={completionFieldsLocked}
                lockedTitle={signatureCheckpointUnavailable ? "Checking signed checkpoint" : "After photos locked by completed work"}
                lockedMessage={signatureError ? "Saved signature status is unavailable. Retry the signature check before changing checkpoint evidence." : signatureLoading ? "Saved signatures are loading. Evidence stays locked until that check finishes." : job.status === "complete" || job.completedAt || job.completionSignatureOverrideAt ? "This job is complete, so its after-work evidence is part of the permanent record." : "The customer confirmed completion against this evidence. An owner must reject that confirmation before after-work evidence can change."}
              />
              {afterPhotos.length > 0 ? (
                <section className={styles.photoGallery} aria-label="Saved after-work photos">
                  <div className={styles.photoGalleryHeader}><strong>After-work evidence</strong><span>{afterPhotos.length}</span></div>
                  <div className={styles.photoGrid}>{afterPhotos.map((photo) => <article key={photo.id} className={styles.photoCard}>{photo.storagePath.startsWith("data:") || photo.storagePath.startsWith("http") ? <img src={photo.storagePath} alt={photo.caption ?? "After work"} /> : <div className={styles.photoPlaceholder}>Private photo</div>}<div><strong>After</strong><span>{photo.caption ?? photo.storagePath}</span></div></article>)}</div>
                </section>
              ) : null}
            </div>
          ) : <ProtectedStage />
        ) : null}

        {activeStage === "completion" ? (
          currentUser.role !== "call_center" ? (
            <div className={styles.stageBody}>
              <section className={styles.approvalPanel}>
                <div className={styles.approvalIntro}><span><PenLine size={21} aria-hidden="true" /></span><div><h3>Confirm the completed work</h3><p>Review the finished work and after photo together, then let the customer sign on this iPad.</p></div></div>
                <SignatureStatusCard title="Customer completion confirmation" signature={completionSignature} rejectedSignature={rejectedCompletionSignature} loading={signatureLoading} error={signatureError} drawLabel="Confirm completed work" onDraw={() => setSignatureDialogPurpose("work_completion")} onRetry={() => void refreshJobSignatures()} canReject={currentUser.role === "owner" && job.status !== "complete"} onReject={completionSignature ? (reason) => rejectJobSignature(completionSignature, reason) : undefined} drawDisabled={signatureCheckpointUnavailable || !authorizationSignature || afterPhotos.length === 0 || job.status === "complete" || job.status === "cancelled"} />
                <p className={styles.inlineNote}>{completionSignature ? "Completion is signed. Save the completed job, then build the invoice." : "This is a separate confirmation from the authorization signed before work."}</p>
              </section>
              {!signatureCheckpointUnavailable && !completionSignature && currentUser.role === "owner" && job.status !== "complete" ? (
                <section className={styles.overridePanel}><h3>Owner completion override</h3><p>Use only when the customer cannot sign. The reason and owner identity remain in the audit record.</p><Field label="Override reason"><textarea value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} placeholder="Explain why a customer signature could not be collected." /></Field><label className={styles.overrideCheck}><input type="checkbox" checked={overrideConfirmed} onChange={(event) => setOverrideConfirmed(event.target.checked)} />I am explicitly overriding the required customer completion signature as the owner.</label>{ownerOverrideReady ? <button className={styles.overrideAction} type="button" onClick={() => void saveInspect("complete")} disabled={saveBusy}>{saveBusy ? "Completing…" : "Complete with owner override"}</button> : null}</section>
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
                  <div><small>{job.status === "complete" ? "Invoice record" : "Unsigned draft"}</small><h3>{invoice ? "Review the saved invoice" : "Create an invoice from this work"}</h3><p>{invoice ? "The draft includes the current work items, tax, and saved customer details." : "You can review the bill before signatures are complete. The PDF will be marked as a draft until the required field records are signed."}</p></div>
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
          <div><small>Next action</small><strong>{primaryHelper(activeStage, { canMarkEnRoute, canRecordArrival, authorizationSignature: Boolean(authorizationSignature), completionSignature: Boolean(completionSignature), invoice: Boolean(invoice), jobComplete: job.status === "complete", jobCancelled: job.status === "cancelled" })}</strong></div>
          <button type="button" className={styles.primaryAction} onClick={() => void handlePrimaryAction()} disabled={primaryDisabled}>{activeStage === "overview" && currentUser.role === "call_center" ? <Save size={18} aria-hidden="true" /> : (activeStage === "approval" && !authorizationSignature) || (activeStage === "completion" && !completionSignature) ? <PenLine size={18} aria-hidden="true" /> : null}{primaryLabel}<ChevronRight size={18} aria-hidden="true" /></button>
        </aside>
      ) : null}

      <SignatureDialog
        open={Boolean(signatureDialogPurpose)}
        title={signatureDialogPurpose === "work_authorization" ? "Authorize proposed work" : "Confirm completed work"}
        description={signatureDialogPurpose === "work_authorization" ? `The customer authorizes the ${tierLabels[authorizationTier]} scope and total before work begins. Saving must finish before the technician continues.` : "The customer confirms the approved work was completed and reviewed. Saving must finish before the job can be completed."}
        signerRole="customer"
        defaultSignerName={customer?.name}
        onCancel={() => setSignatureDialogPurpose(undefined)}
        onSave={saveJobSignature}
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
  if (stage === "photos") return "Before-work photo";
  if (stage === "work") return "Build the estimate";
  if (stage === "approval") return "Authorize before work";
  if (stage === "after") return "After-work photo";
  if (stage === "completion") return "Customer completion";
  return "Invoice handoff";
}

function stageDescription(stage: JobStage): string {
  if (stage === "overview") return "Confirm who, where, and when before the technician starts.";
  if (stage === "photos") return "Document the starting condition before proposing or beginning work.";
  if (stage === "work") return "Create the scope and price with full technician flexibility.";
  if (stage === "approval") return "The customer chooses and signs the exact scope before work begins.";
  if (stage === "after") return "Document the finished work before customer completion confirmation.";
  if (stage === "completion") return "Capture a separate confirmation that the approved work is complete.";
  return "Create or open the invoice using the work already saved.";
}

function primaryHelper(
  stage: JobStage,
  state: { canMarkEnRoute: boolean; canRecordArrival: boolean; authorizationSignature: boolean; completionSignature: boolean; invoice: boolean; jobComplete: boolean; jobCancelled: boolean }
): string {
  if (stage === "overview") {
    if (state.jobCancelled) return "Return to your service schedule";
    if (state.jobComplete) return state.invoice ? "Open the saved invoice" : "Continue to the invoice handoff";
    if (state.canMarkEnRoute) return "Mark the trip started before you leave";
    return state.canRecordArrival ? "Record the real arrival time and begin work" : "Move to photo documentation";
  }
  if (stage === "photos") return "Save at least one before photo";
  if (stage === "work") return "Review the proposed scope and total with the customer";
  if (stage === "approval") {
    return state.authorizationSignature ? "The signed scope is locked; begin the approved work" : "Pass the iPad to the customer before work begins";
  }
  if (stage === "after") return "Save proof of the completed work";
  if (stage === "completion") return state.completionSignature ? "Complete the job and continue to invoicing" : "Review the finished work, then pass the iPad to the customer";
  return state.invoice ? "Continue in the invoice workspace" : "Use the saved customer and work details";
}

function stageStatusLabel(stage: JobStage, state: { beforeCount: number; afterCount: number; itemCount: number; authorized: boolean; completed: boolean; invoice: boolean }): string {
  if (stage === "photos") return state.beforeCount > 0 ? `${state.beforeCount} saved` : "Required";
  if (stage === "work") return `${state.itemCount} ${state.itemCount === 1 ? "item" : "items"}`;
  if (stage === "approval") return state.authorized ? "Authorized" : "Signature required";
  if (stage === "after") return state.afterCount > 0 ? `${state.afterCount} saved` : "Required";
  if (stage === "completion") return state.completed ? "Signed" : "Signature required";
  return state.invoice ? "Draft ready" : "Not built";
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
