"use client";

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { OperationTimeoutError, wait, withTimeout } from "@/lib/async-utils";
import { useOptionalAuth } from "@/lib/auth";
import { demoState } from "@/lib/demo-data";
import { buildInvoiceDraft, invoiceNumber, totalsForItems } from "@/lib/invoice";
import { normalizePhone } from "@/lib/phone";
import { createId } from "@/lib/id";
import { normalizeJobPhotoCaption } from "@/lib/job-photos";
import { demoMode } from "@/lib/runtime";
import { defaultServiceWindowEndAt } from "@/lib/service-window";
import { compactDemoStateForStorage, persistDemoState } from "@/lib/demo-storage";
import { clearDemoSignatures, loadSignatures } from "@/lib/signatures-client";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import {
  allowedUserFromRow,
  allowedUserPatchToRow,
  allowedUserToRow,
  createEmptyAppState,
  customerFromRow,
  customerPatchToRow,
  customerToRow,
  invoiceFromRow,
  invoicePatchToRow,
  invoiceToRow,
  jobFromRow,
  type JobRow,
  jobPatchToRow,
  jobPhotoFromRow,
  jobPhotoToRow,
  jobToRow,
  lineItemFromRow,
  lineItemPatchToRow,
  lineItemToRow,
  partFromRow,
  partToRow
} from "@/lib/supabase-mappers";
import type {
  AllowedUser,
  AppState,
  Customer,
  Invoice,
  Job,
  JobLineItem,
  JobPhoto,
  JobStatus,
  Part,
  PhotoKind,
  Role,
  Tier,
  Unit
} from "@/lib/types";

const STORAGE_KEY = "hvac-plumbing-mvp-state-v1";
const WORKSPACE_LOAD_TIMEOUT_MS = 30_000;
const SESSION_REFRESH_TIMEOUT_MS = 12_000;

type NewCustomerInput = Omit<Customer, "id" | "phoneDigits" | "createdAt" | "emailNotificationsEnabled" | "smsConsentStatus" | "smsConsentAt" | "smsConsentSource"> &
  Partial<Pick<Customer, "emailNotificationsEnabled" | "smsConsentStatus" | "smsConsentAt" | "smsConsentSource">>;
type NewJobInput = Omit<
  Job,
  | "id"
  | "status"
  | "createdAt"
  | "arrivedAt"
  | "completedAt"
  | "beforePhotosSkippedAt"
  | "beforePhotosSkippedBy"
  | "afterPhotosSkippedAt"
  | "afterPhotosSkippedBy"
> & { status?: JobStatus };
type NewPartInput = Omit<Part, "id" | "createdAt" | "active"> & { active?: boolean };
type NewLineItemInput = Omit<JobLineItem, "id" | "sortOrder">;
type NewPhotoInput = Omit<JobPhoto, "id" | "uploadedAt"> & { file?: File };
type NewAllowedUserInput = Omit<AllowedUser, "id" | "createdAt">;

type AppDataContextValue = AppState & {
  loaded: boolean;
  lastError?: string;
  loadError?: string;
  retryLoad: () => void;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  resetDemoData: () => void;
  searchCustomers: (query: string, visibleCustomers?: Customer[]) => Promise<Customer[]>;
  createCustomer: (input: NewCustomerInput) => Promise<Customer>;
  updateCustomer: (id: string, input: Partial<Customer>) => Promise<void>;
  deleteCustomer: (id: string) => Promise<void>;
  createJob: (input: NewJobInput) => Promise<Job>;
  deleteJob: (id: string) => Promise<void>;
  updateJob: (id: string, input: Partial<Job>) => Promise<void>;
  markJobEnRoute: (id: string) => Promise<void>;
  markJobArrived: (id: string) => Promise<void>;
  skipPhotoCheckpoint: (id: string, kind: Extract<PhotoKind, "before" | "after">) => Promise<Job>;
  addPhoto: (input: NewPhotoInput) => Promise<JobPhoto>;
  addLineItem: (input: NewLineItemInput) => Promise<JobLineItem>;
  updateLineItem: (id: string, input: Partial<JobLineItem>) => Promise<void>;
  deleteLineItem: (id: string) => Promise<void>;
  createPart: (input: NewPartInput) => Part;
  createOrUpdateInvoiceDraft: (jobId: string, createdBy: string) => Invoice;
  updateInvoice: (id: string, input: Partial<Invoice>) => void;
  sendInvoice: (id: string, email: string) => void;
  createAllowedUser: (input: NewAllowedUserInput) => AllowedUser;
  updateAllowedUser: (id: string, input: Partial<AllowedUser>) => void;
};

const AppDataContext = createContext<AppDataContextValue | null>(null);

export function AppDataProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => (demoMode ? null : getSupabaseBrowserClient()), []);
  const auth = useOptionalAuth();
  const [state, setState] = useState<AppState>(() => (demoMode ? demoState : createEmptyAppState()));
  const [loaded, setLoaded] = useState(false);
  const [lastError, setLastError] = useState<string | undefined>();
  const [loadError, setLoadError] = useState<string | undefined>();
  const [loadAttempt, setLoadAttempt] = useState(0);
  const authReady = demoMode ? true : auth?.authReady ?? false;
  const isAuthenticated = demoMode ? true : auth?.isAuthenticated ?? false;
  const authenticatedUserKey = demoMode
    ? "demo"
    : isAuthenticated
      ? `${auth?.sessionUserId ?? auth?.currentUser.id}:${auth?.sessionRevision ?? 0}`
      : undefined;
  const activeWorkspaceKeyRef = useRef<string | undefined>(authenticatedUserKey);
  const lineItemMutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  activeWorkspaceKeyRef.current = authenticatedUserKey;

  useEffect(() => {
    if (!demoMode) return;

    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        setState(compactDemoStateForStorage(normalizeDemoState(JSON.parse(raw) as AppState)));
      }
    } catch (error) {
      console.warn("Could not load demo state from localStorage", error);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!demoMode || !loaded) return;
    persistDemoState(window.localStorage, STORAGE_KEY, state);
  }, [loaded, state]);

  useEffect(() => {
    if (demoMode) return;

    const client = supabase;
    if (!authReady) {
      setLoaded(false);
      setLoadError(undefined);
      return;
    }

    if (!isAuthenticated) {
      setState(createEmptyAppState());
      setLastError(undefined);
      setLoadError(undefined);
      setLoaded(true);
      return;
    }

    if (!client) {
      setState(createEmptyAppState());
      setLoadError("Supabase credentials are not configured.");
      setLoaded(true);
      return;
    }
    const dataClient: NonNullable<typeof client> = client;

    let cancelled = false;
    const abortController = new AbortController();

    async function loadWorkspace() {
      try {
        const nextState = await withTimeout(
          loadSupabaseStateWithRetry(dataClient, abortController.signal),
          WORKSPACE_LOAD_TIMEOUT_MS,
          "Workspace loading",
          () => abortController.abort()
        );
        if (cancelled) return;
        setState(nextState);
        setLoadError(undefined);
        setLastError(undefined);
      } catch (error) {
        if (cancelled) return;
        const message = workspaceErrorMessage(error);
        setState(createEmptyAppState());
        setLoadError(message);
        console.error(message, error);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    }

    setLoaded(false);
    setLoadError(undefined);
    void loadWorkspace();

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [authReady, authenticatedUserKey, isAuthenticated, loadAttempt, supabase]);

  const value = useMemo<AppDataContextValue>(() => {
    function queueLineItemMutation<T>(action: () => Promise<T>): Promise<T> {
      const result = lineItemMutationQueueRef.current.then(action, action);
      lineItemMutationQueueRef.current = result.then(() => undefined, () => undefined);
      return result;
    }

    function persistSupabase(label: string, action: () => Promise<unknown>) {
      if (demoMode || !supabase) return;
      const requestWorkspaceKey = activeWorkspaceKeyRef.current;

      void action().catch((error) => {
        if (activeWorkspaceKeyRef.current !== requestWorkspaceKey) return;
        const message = error instanceof Error ? error.message : `Supabase ${label} failed.`;
        setLastError(message);
        console.error(`Supabase ${label} failed`, error);
      });
    }

    function resetDemoData() {
      if (!demoMode) return;

      clearDemoSignatures();
      setState(demoState);
      persistDemoState(window.localStorage, STORAGE_KEY, demoState);
    }

    async function searchCustomers(query: string, visibleCustomers = state.customers) {
      const localResults = searchCustomersLocally(query, visibleCustomers);
      if (demoMode || !supabase) return localResults;
      const requestWorkspaceKey = activeWorkspaceKeyRef.current;

      const trimmed = query.trim();
      if (!trimmed) return state.customers.slice(0, 25);

      const { data, error } = await supabase.rpc("search_customers", {
        search_query: trimmed,
        limit_count: 25
      });

      if (activeWorkspaceKeyRef.current !== requestWorkspaceKey) return localResults;

      if (error) {
        setLastError(error.message);
        return localResults;
      }

      const customers = (data ?? []).map(customerFromRow);
      setState((current) => mergeCustomers(current, customers));
      return customers;
    }

    async function createCustomer(input: NewCustomerInput) {
      const customer: Customer = {
        ...input,
        id: createId(),
        phoneDigits: normalizePhone(input.phone),
        emailNotificationsEnabled: input.emailNotificationsEnabled ?? true,
        smsConsentStatus: input.smsConsentStatus ?? "unknown",
        createdAt: new Date().toISOString()
      };

      if (demoMode) {
        setState((current) => ({ ...current, customers: [customer, ...current.customers] }));
        return customer;
      }

      if (!supabase) throw new Error("Supabase credentials are not configured.");
      const requestWorkspaceKey = activeWorkspaceKeyRef.current;
      const { data, error } = await supabase.from("customers").insert(customerToRow(customer)).select("*").single();
      if (error) {
        if (activeWorkspaceKeyRef.current === requestWorkspaceKey) setLastError(error.message);
        throw error;
      }
      if (activeWorkspaceKeyRef.current !== requestWorkspaceKey) throw new Error("The signed-in account changed before the customer was created.");
      const persistedCustomer = customerFromRow(data);
      setState((current) => ({ ...current, customers: [persistedCustomer, ...current.customers] }));
      setLastError(undefined);
      return persistedCustomer;
    }

    async function updateCustomer(id: string, input: Partial<Customer>) {
      if (Object.keys(input).length === 0) return;

      if (demoMode) {
        setState((current) => ({
          ...current,
          customers: current.customers.map((customer) =>
            customer.id === id
              ? { ...customer, ...input, phoneDigits: input.phone ? normalizePhone(input.phone) : customer.phoneDigits }
              : customer
          )
        }));
        return;
      }

      if (!supabase) throw new Error("Supabase credentials are not configured.");
      const requestWorkspaceKey = activeWorkspaceKeyRef.current;
      const { data, error } = await supabase
        .from("customers")
        .update(customerPatchToRow(input))
        .eq("id", id)
        .select("*")
        .maybeSingle();
      if (error) {
        if (activeWorkspaceKeyRef.current === requestWorkspaceKey) setLastError(error.message);
        throw error;
      }
      if (!data) throw new Error("The customer could not be updated. Refresh and confirm your access.");
      if (activeWorkspaceKeyRef.current !== requestWorkspaceKey) return;
      const persistedCustomer = customerFromRow(data);
      setState((current) => ({
        ...current,
        customers: current.customers.map((customer) => customer.id === id ? persistedCustomer : customer)
      }));
      setLastError(undefined);
    }

    async function deleteCustomer(id: string) {
      if (demoMode) {
        setState((current) => ({
          ...current,
          customers: current.customers.filter((customer) => customer.id !== id),
          jobs: current.jobs.filter((job) => job.customerId !== id),
          invoices: current.invoices.filter((invoice) => {
            const job = current.jobs.find((candidate) => candidate.id === invoice.jobId);
            return job?.customerId !== id;
          })
        }));
        return;
      }

      if (!supabase) throw new Error("Supabase credentials are not configured.");
      const { error } = await supabase.from("customers").delete().eq("id", id);
      if (error) {
        setLastError(error.message);
        throw error;
      }
      setState((current) => {
        const customerJobIds = new Set(current.jobs.filter((job) => job.customerId === id).map((job) => job.id));
        return {
          ...current,
          customers: current.customers.filter((customer) => customer.id !== id),
          jobs: current.jobs.filter((job) => job.customerId !== id),
          invoices: current.invoices.filter((invoice) => !customerJobIds.has(invoice.jobId))
        };
      });
      setLastError(undefined);
    }

    async function createJob(input: NewJobInput) {
      const job: Job = {
        ...input,
        id: createId(),
        status: input.status ?? "scheduled",
        createdAt: new Date().toISOString()
      };

      if (demoMode) {
        setState((current) => ({ ...current, jobs: [job, ...current.jobs] }));
        return job;
      }

      if (!supabase) throw new Error("Supabase credentials are not configured.");
      const requestWorkspaceKey = activeWorkspaceKeyRef.current;
      const { data, error } = await supabase
        .from("jobs")
        .insert(jobToRow(job))
        .select("*")
        .single();
      if (error) {
        if (activeWorkspaceKeyRef.current === requestWorkspaceKey) setLastError(error.message);
        throw error;
      }
      if (activeWorkspaceKeyRef.current !== requestWorkspaceKey) throw new Error("The signed-in account changed before the job was created.");
      const persistedJob = jobFromRow(data);
      setState((current) => ({ ...current, jobs: [persistedJob, ...current.jobs] }));
      setLastError(undefined);
      return persistedJob;
    }

    async function deleteJob(id: string) {
      if (demoMode) {
        setState((current) => ({
          ...current,
          jobs: current.jobs.filter((job) => job.id !== id),
          jobPhotos: current.jobPhotos.filter((photo) => photo.jobId !== id),
          jobLineItems: current.jobLineItems.filter((item) => item.jobId !== id),
          invoices: current.invoices.filter((invoice) => invoice.jobId !== id)
        }));
        return;
      }

      if (!supabase) throw new Error("Supabase credentials are not configured.");
      const { error } = await supabase.from("jobs").delete().eq("id", id);
      if (error) {
        setLastError(error.message);
        throw error;
      }
      setState((current) => ({
        ...current,
        jobs: current.jobs.filter((job) => job.id !== id),
        jobPhotos: current.jobPhotos.filter((photo) => photo.jobId !== id),
        jobLineItems: current.jobLineItems.filter((item) => item.jobId !== id),
        invoices: current.invoices.filter((invoice) => invoice.jobId !== id)
      }));
      setLastError(undefined);
    }

    async function updateJob(id: string, input: Partial<Job>) {
      if (Object.keys(input).length === 0) return;
      const existingJob = state.jobs.find((job) => job.id === id);
      if (!existingJob) throw new Error("The job could not be found.");
      let patch = input;
      if (input.status !== undefined) {
        const completedAt = input.status === "complete"
          ? existingJob.completedAt ?? new Date().toISOString()
          : existingJob.status === "complete"
            ? null
            : existingJob.completedAt;
        patch = { ...input, completedAt };
      }

      if (demoMode) {
        const changesCompletionDetails = input.notes !== undefined
          || input.description !== undefined
          || input.serviceAddress !== undefined;
        if (changesCompletionDetails) {
          const signatures = await loadSignatures({ type: "job", id });
          const completionLocked = existingJob.status === "complete"
            || Boolean(existingJob.completedAt)
            || Boolean(existingJob.completionSignatureOverrideAt)
            || signatures.some((signature) => signature.status === "active" && signature.purpose === "work_completion");
          if (completionLocked) {
            throw new Error("Completion-bound job details are locked after customer confirmation or job completion.");
          }
        }
        setState((current) => ({
          ...current,
          jobs: current.jobs.map((job) => job.id === id ? { ...job, ...patch } : job)
        }));
        return;
      }

      if (!supabase) throw new Error("Supabase credentials are not configured.");
      const requestWorkspaceKey = activeWorkspaceKeyRef.current;
      const { data, error } = await supabase
        .from("jobs")
        .update(jobPatchToRow(patch))
        .eq("id", id)
        .select("*")
        .maybeSingle();
      if (error) {
        if (activeWorkspaceKeyRef.current === requestWorkspaceKey) setLastError(error.message);
        throw error;
      }
      if (!data) throw new Error("The job could not be updated. Refresh and confirm your access.");
      if (activeWorkspaceKeyRef.current !== requestWorkspaceKey) return;
      const persistedJob = jobFromRow(data);
      setState((current) => ({
        ...current,
        jobs: current.jobs.map((job) => job.id === id ? persistedJob : job)
      }));
      setLastError(undefined);
    }

    async function markJobEnRoute(id: string) {
      const existingJob = state.jobs.find((job) => job.id === id);
      if (!existingJob || existingJob.enRouteAt || existingJob.arrivedAt || existingJob.status === "complete" || existingJob.status === "cancelled") return;

      if (demoMode) {
        const enRouteAt = new Date().toISOString();
        setState((current) => ({
          ...current,
          jobs: current.jobs.map((job) => job.id === id ? { ...job, enRouteAt } : job)
        }));
        return;
      }

      if (!supabase) throw new Error("Supabase credentials are not configured.");
      const requestWorkspaceKey = activeWorkspaceKeyRef.current;
      const { data, error } = await supabase
        .rpc("mark_job_en_route", { p_job_id: id })
        .maybeSingle();
      if (error) {
        if (activeWorkspaceKeyRef.current === requestWorkspaceKey) setLastError(error.message);
        throw error;
      }
      if (!data) throw new Error("This job could not be marked en route. Confirm that it is still assigned to you.");
      if (activeWorkspaceKeyRef.current !== requestWorkspaceKey) return;
      const result = data as { recorded_en_route_at: string };
      setState((current) => ({
        ...current,
        jobs: current.jobs.map((job) => job.id === id ? { ...job, enRouteAt: result.recorded_en_route_at } : job)
      }));
    }

    async function markJobArrived(id: string) {
      const existingJob = state.jobs.find((job) => job.id === id);
      if (!existingJob || existingJob.arrivedAt || existingJob.status === "complete" || existingJob.status === "cancelled") return;

      if (demoMode) {
        const arrivedAt = new Date().toISOString();
        setState((current) => ({
          ...current,
          jobs: current.jobs.map((job) => job.id === id ? { ...job, arrivedAt, status: "in_progress" } : job)
        }));
        return;
      }

      if (!supabase) throw new Error("Supabase credentials are not configured.");
      const requestWorkspaceKey = activeWorkspaceKeyRef.current;
      const { data, error } = await supabase
        .rpc("mark_job_arrived", { p_job_id: id })
        .maybeSingle();
      if (error) {
        if (activeWorkspaceKeyRef.current === requestWorkspaceKey) setLastError(error.message);
        throw error;
      }
      if (!data) throw new Error("This job could not be started. Confirm that it is still assigned to you.");
      if (activeWorkspaceKeyRef.current !== requestWorkspaceKey) return;
      const result = data as { recorded_arrived_at: string; job_status: JobStatus };
      setState((current) => ({
        ...current,
        jobs: current.jobs.map((job) => job.id === id
          ? { ...job, arrivedAt: result.recorded_arrived_at, status: result.job_status }
          : job)
      }));
    }

    async function skipPhotoCheckpoint(id: string, kind: Extract<PhotoKind, "before" | "after">) {
      const existingJob = state.jobs.find((job) => job.id === id);
      if (!existingJob) throw new Error("The job could not be found.");

      if (demoMode) {
        const actor = auth?.currentUser;
        if (!actor || actor.role === "call_center") {
          throw new Error("Only an owner or assigned technician can skip a job photo.");
        }
        if (actor.role === "tech" && existingJob.assignedTechId !== actor.id) {
          throw new Error("Only the assigned technician can skip this job photo.");
        }
        if (!existingJob.arrivedAt || existingJob.status !== "in_progress") {
          throw new Error("Record arrival before skipping a job photo.");
        }

        const skippedAt = kind === "before" ? existingJob.beforePhotosSkippedAt : existingJob.afterPhotosSkippedAt;
        const skippedBy = kind === "before" ? existingJob.beforePhotosSkippedBy : existingJob.afterPhotosSkippedBy;
        if (skippedAt && skippedBy) return existingJob;
        if (state.jobPhotos.some((photo) => photo.jobId === id && photo.kind === kind)) {
          throw new Error(`A saved ${kind} photo already satisfies this checkpoint.`);
        }

        const signatures = await loadSignatures({ type: "job", id });
        if (signatures.some((signature) => signature.status === "active" && signature.purpose === "work_completion")) {
          throw new Error("The photo checkpoint is locked by the customer completion signature.");
        }
        if (kind === "after" && !signatures.some((signature) => (
          signature.status === "active" && signature.purpose === "work_authorization"
        ))) {
          throw new Error("Collect customer work authorization before skipping the after photo.");
        }

        const recordedAt = new Date().toISOString();
        const persistedJob: Job = kind === "before"
          ? { ...existingJob, beforePhotosSkippedAt: recordedAt, beforePhotosSkippedBy: actor.id }
          : { ...existingJob, afterPhotosSkippedAt: recordedAt, afterPhotosSkippedBy: actor.id };
        setState((current) => ({
          ...current,
          jobs: current.jobs.map((job) => job.id === id ? persistedJob : job)
        }));
        return persistedJob;
      }

      if (!supabase) throw new Error("Supabase credentials are not configured.");
      const requestWorkspaceKey = activeWorkspaceKeyRef.current;
      const { data, error } = await supabase
        .rpc("skip_job_photo_checkpoint", { p_job_id: id, p_kind: kind })
        .single();
      if (error) {
        if (activeWorkspaceKeyRef.current === requestWorkspaceKey) setLastError(error.message);
        throw error;
      }
      if (!data) throw new Error("The photo checkpoint could not be skipped. Refresh and confirm your access.");
      if (activeWorkspaceKeyRef.current !== requestWorkspaceKey) {
        throw new Error("The signed-in account changed before the photo checkpoint was saved.");
      }
      const persistedJob = jobFromRow(data as unknown as JobRow);
      setState((current) => ({
        ...current,
        jobs: current.jobs.map((job) => job.id === id ? persistedJob : job)
      }));
      setLastError(undefined);
      return persistedJob;
    }

    async function addPhoto(input: NewPhotoInput) {
      const requestWorkspaceKey = activeWorkspaceKeyRef.current;
      const photoId = createId();
      const uploadedAt = new Date().toISOString();
      const storagePath = !demoMode && input.file ? `${input.jobId}/${photoId}${safeFileExtension(input.file.name)}` : input.storagePath;
      const photo: JobPhoto = {
        id: photoId,
        jobId: input.jobId,
        storagePath: input.storagePath,
        kind: input.kind,
        caption: normalizeJobPhotoCaption(input.caption),
        uploadedBy: input.uploadedBy,
        uploadedAt
      };

      if (demoMode) {
        const signatures = await loadSignatures({ type: "job", id: input.jobId });
        const targetJob = state.jobs.find((job) => job.id === input.jobId);
        const completedWorkflow = Boolean(
          targetJob?.status === "complete"
          || targetJob?.completedAt
          || targetJob?.completionSignatureOverrideAt
        );
        const skippedCheckpoint = input.kind === "before"
          ? Boolean(targetJob?.beforePhotosSkippedAt && targetJob.beforePhotosSkippedBy)
          : input.kind === "after"
            ? Boolean(targetJob?.afterPhotosSkippedAt && targetJob.afterPhotosSkippedBy)
            : false;
        if (skippedCheckpoint) {
          throw new Error(`A ${input.kind} photo cannot be added after that checkpoint was explicitly skipped.`);
        }
        if (input.kind === "after" && completedWorkflow) {
          throw new Error("After-work evidence is locked because this job has already been completed.");
        }
        const lockedBy = input.kind === "before"
          ? signatures.some((signature) => signature.status === "active" && signature.purpose === "work_authorization")
          : input.kind === "after"
            ? signatures.some((signature) => signature.status === "active" && signature.purpose === "work_completion")
            : false;
        if (lockedBy) {
          throw new Error(input.kind === "before"
            ? "Reject the saved customer work authorization before adding before-work evidence."
            : "Reject the saved completion signature before adding after-work evidence.");
        }
        setState((current) => ({ ...current, jobPhotos: [photo, ...current.jobPhotos] }));
        return photo;
      }

      if (!supabase) throw new Error("Supabase credentials are not configured.");

      try {
        let displayPath = storagePath;
        if (input.file) {
          const { error: uploadError } = await supabase.storage.from("job-photos").upload(storagePath, input.file, {
            cacheControl: "3600",
            upsert: false
          });
          if (uploadError) throw uploadError;

          const { data: signedData, error: signedError } = await supabase.storage.from("job-photos").createSignedUrl(storagePath, 60 * 60);
          if (!signedError && signedData?.signedUrl) displayPath = signedData.signedUrl;
        }

        const { error } = await supabase.from("job_photos").insert(jobPhotoToRow({ ...photo, storagePath }));
        if (error) throw error;
        if (activeWorkspaceKeyRef.current !== requestWorkspaceKey) {
          throw new Error("The signed-in account changed before the photo was saved.");
        }

        const persistedPhoto = { ...photo, storagePath: displayPath };
        setState((current) => ({ ...current, jobPhotos: [persistedPhoto, ...current.jobPhotos] }));
        setLastError(undefined);
        return persistedPhoto;
      } catch (error) {
        if (activeWorkspaceKeyRef.current === requestWorkspaceKey) {
          const message = error instanceof Error ? error.message : "The photo could not be saved.";
          setLastError(message);
        }
        throw error;
      }
    }

    async function addLineItem(input: NewLineItemInput) {
      const existingCount = state.jobLineItems.filter((item) => item.jobId === input.jobId).length;
      const lineItem: JobLineItem = {
        ...input,
        id: createId(),
        quantity: Number(input.quantity),
        unitPrice: Number(input.unitPrice),
        sortOrder: existingCount + 1
      };
      if (demoMode) {
        setState((current) => applyLineItemAdd(current, lineItem));
        return lineItem;
      }

      if (!supabase) throw new Error("Supabase credentials are not configured.");
      return queueLineItemMutation(async () => {
        const requestWorkspaceKey = activeWorkspaceKeyRef.current;
        try {
          const { data, error } = await supabase
            .from("job_line_items")
            .insert(lineItemToRow(lineItem))
            .select("*")
            .single();
          if (error) throw error;
          if (activeWorkspaceKeyRef.current !== requestWorkspaceKey) {
            throw new Error("The signed-in account changed before the line item was saved.");
          }
          const persistedLineItem = lineItemFromRow(data);
          setState((current) => applyLineItemAdd(current, persistedLineItem));
          setLastError(undefined);
          return persistedLineItem;
        } catch (error) {
          if (activeWorkspaceKeyRef.current === requestWorkspaceKey) {
            setLastError(error instanceof Error ? error.message : "The line item could not be saved.");
          }
          throw error;
        }
      });
    }

    async function updateLineItem(id: string, input: Partial<JobLineItem>) {
      if (Object.keys(input).length === 0) return;
      if (demoMode) {
        setState((current) => applyLineItemUpdate(current, id, input));
        return;
      }

      if (!supabase) throw new Error("Supabase credentials are not configured.");
      return queueLineItemMutation(async () => {
        const requestWorkspaceKey = activeWorkspaceKeyRef.current;
        try {
          const { data, error } = await supabase
            .from("job_line_items")
            .update(lineItemPatchToRow(input))
            .eq("id", id)
            .select("*")
            .maybeSingle();
          if (error) throw error;
          if (!data) throw new Error("The line item could not be updated. Refresh and confirm your access.");
          if (activeWorkspaceKeyRef.current !== requestWorkspaceKey) {
            throw new Error("The signed-in account changed before the line item was updated.");
          }
          const persistedLineItem = lineItemFromRow(data);
          setState((current) => applyLineItemUpdate(current, id, persistedLineItem));
          setLastError(undefined);
        } catch (error) {
          if (activeWorkspaceKeyRef.current === requestWorkspaceKey) {
            setLastError(error instanceof Error ? error.message : "The line item could not be updated.");
          }
          throw error;
        }
      });
    }

    async function deleteLineItem(id: string) {
      if (demoMode) {
        setState((current) => applyLineItemDelete(current, id));
        return;
      }

      if (!supabase) throw new Error("Supabase credentials are not configured.");
      return queueLineItemMutation(async () => {
        const requestWorkspaceKey = activeWorkspaceKeyRef.current;
        try {
          const { error } = await supabase.from("job_line_items").delete().eq("id", id);
          if (error) throw error;
          if (activeWorkspaceKeyRef.current !== requestWorkspaceKey) {
            throw new Error("The signed-in account changed before the line item was removed.");
          }
          setState((current) => applyLineItemDelete(current, id));
          setLastError(undefined);
        } catch (error) {
          if (activeWorkspaceKeyRef.current === requestWorkspaceKey) {
            setLastError(error instanceof Error ? error.message : "The line item could not be removed.");
          }
          throw error;
        }
      });
    }

    function createPart(input: NewPartInput) {
      const part: Part = {
        ...input,
        id: createId(),
        defaultPrice: Number(input.defaultPrice),
        active: input.active ?? true,
        createdAt: new Date().toISOString()
      };
      setState((current) => ({ ...current, parts: [part, ...current.parts] }));
      persistSupabase("part insert", async () => {
        const { error } = await supabase!.from("parts").insert(partToRow(part));
        if (error) throw error;
      });
      return part;
    }

    function createOrUpdateInvoiceDraft(jobId: string, createdBy: string) {
      if (!demoMode) throw new Error("Production invoice drafts must be created through the protected invoice workflow.");
      const existing = state.invoices.find((invoice) => invoice.jobId === jobId);
      const items = state.jobLineItems.filter((item) => item.jobId === jobId);
      const draft = buildInvoiceDraft({
        id: createId(),
        jobId,
        createdBy,
        existing,
        items,
        invoiceNumber: invoiceNumber(state.invoices.length + 1)
      });
      setState((current) => ({
        ...current,
        invoices: existing
          ? current.invoices.map((invoice) => (invoice.id === existing.id ? draft : invoice))
          : [draft, ...current.invoices]
      }));
      persistSupabase("invoice draft upsert", async () => {
        const { error } = await supabase!.from("invoices").upsert(invoiceToRow(draft), { onConflict: "job_id" });
        if (error) throw error;
      });
      return draft;
    }

    function updateInvoice(id: string, input: Partial<Invoice>) {
      if (!demoMode) {
        setLastError("Production invoices must be updated through the protected invoice workflow.");
        return;
      }
      setState((current) => ({
        ...current,
        invoices: current.invoices.map((invoice) => (invoice.id === id ? { ...invoice, ...input } : invoice))
      }));
      persistSupabase("invoice update", async () => {
        const { error } = await supabase!.from("invoices").update(invoicePatchToRow(input)).eq("id", id);
        if (error) throw error;
      });
    }

    function sendInvoice(id: string, email: string) {
      if (!demoMode) {
        setLastError("Production invoice delivery must be recorded through the protected invoice workflow.");
        return;
      }
      const sentAt = new Date().toISOString();
      const sentPatch: Partial<Invoice> = {
        status: "sent",
        sentToEmail: email,
        sentAt
      };

      setState((current) => ({
        ...current,
        invoices: current.invoices.map((invoice) =>
          invoice.id === id
            ? { ...invoice, ...sentPatch }
            : invoice
        )
      }));
      persistSupabase("invoice send update", async () => {
        const { error } = await supabase!.from("invoices").update(invoicePatchToRow(sentPatch)).eq("id", id);
        if (error) throw error;
      });
    }

    function createAllowedUser(input: NewAllowedUserInput) {
      const allowedUser: AllowedUser = {
        ...input,
        id: createId(),
        createdAt: new Date().toISOString()
      };
      setState((current) => ({ ...current, allowedUsers: [allowedUser, ...current.allowedUsers] }));
      persistSupabase("allowed user insert", async () => {
        const { error } = await supabase!.from("allowed_users").insert(allowedUserToRow(allowedUser));
        if (error) throw error;
      });
      return allowedUser;
    }

    function updateAllowedUser(id: string, input: Partial<AllowedUser>) {
      setState((current) => ({
        ...current,
        allowedUsers: current.allowedUsers.map((user) => (user.id === id ? { ...user, ...input } : user))
      }));
      persistSupabase("allowed user update", async () => {
        const { error } = await supabase!.from("allowed_users").update(allowedUserPatchToRow(input)).eq("id", id);
        if (error) throw error;
      });
    }

    return {
      ...state,
      loaded,
      lastError,
      loadError,
      retryLoad: () => setLoadAttempt((attempt) => attempt + 1),
      setState,
      resetDemoData,
      searchCustomers,
      createCustomer,
      updateCustomer,
      deleteCustomer,
      createJob,
      deleteJob,
      updateJob,
      markJobEnRoute,
      markJobArrived,
      skipPhotoCheckpoint,
      addPhoto,
      addLineItem,
      updateLineItem,
      deleteLineItem,
      createPart,
      createOrUpdateInvoiceDraft,
      updateInvoice,
      sendInvoice,
      createAllowedUser,
      updateAllowedUser
    };
  }, [state, loaded, lastError, loadError, supabase, auth?.currentUser.id, auth?.currentUser.role]);

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData() {
  const value = useContext(AppDataContext);
  if (!value) throw new Error("useAppData must be used inside AppDataProvider");
  return value;
}

function invoiceTotalsPatchForJob(invoices: Invoice[], lineItems: JobLineItem[], jobId: string) {
  const invoice = invoices.find((candidate) => candidate.jobId === jobId && candidate.status === "draft");
  if (!invoice) return undefined;

  return {
    id: invoice.id,
    patch: totalsForItems(
      lineItems.filter((item) => item.jobId === jobId),
      invoice.taxRate
    )
  };
}

export const roleLabels: Record<Role, string> = {
  owner: "Owner",
  tech: "Tech",
  call_center: "Call Center"
};

export const tierLabels: Record<Tier, string> = {
  standard: "Standard",
  good: "Good",
  better: "Better",
  best: "Best"
};

export const unitOptions: Unit[] = ["each", "hour", "lb", "visit", "other"];
export const tierOptions: Tier[] = ["standard", "good", "better", "best"];
export const roleOptions: Role[] = ["owner", "tech", "call_center"];
export const photoKinds: PhotoKind[] = ["before", "after", "other"];

async function loadSupabaseStateWithRetry(supabase: SupabaseClient, signal: AbortSignal): Promise<AppState> {
  const delays = [1000, 2000, 4000, 8000];
  let lastError: unknown;

  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    throwIfAborted(signal);
    try {
      return await loadSupabaseState(supabase, signal);
    } catch (error) {
      lastError = error;
      throwIfAborted(signal);
      if (!isJwtIssuedAtFutureError(error) || attempt === delays.length) throw error;

      await wait(delays[attempt]);
      throwIfAborted(signal);
      const { error: refreshError } = await withTimeout(
        supabase.auth.refreshSession(),
        SESSION_REFRESH_TIMEOUT_MS,
        "Session refresh"
      );
      throwIfAborted(signal);
      if (refreshError) throw refreshError;
    }
  }

  throw lastError;
}

async function loadSupabaseState(supabase: SupabaseClient, signal: AbortSignal): Promise<AppState> {
  const [
    allowedUsersResult,
    customersResult,
    jobsResult,
    photosResult,
    partsResult,
    lineItemsResult,
    invoicesResult
  ] = await Promise.all([
    supabase.from("allowed_users").select("*").order("display_name", { ascending: true }).abortSignal(signal).retry(false),
    supabase.from("customers").select("*").order("created_at", { ascending: false }).abortSignal(signal).retry(false),
    supabase.from("jobs").select("*").order("scheduled_at", { ascending: false }).abortSignal(signal).retry(false),
    supabase.from("job_photos").select("*").order("uploaded_at", { ascending: false }).abortSignal(signal).retry(false),
    supabase.from("parts").select("*").order("name", { ascending: true }).abortSignal(signal).retry(false),
    supabase.from("job_line_items").select("*").order("sort_order", { ascending: true }).abortSignal(signal).retry(false),
    supabase.from("invoices").select("*").order("created_at", { ascending: false }).abortSignal(signal).retry(false)
  ]);

  throwIfError("allowed_users", allowedUsersResult.error);
  throwIfError("customers", customersResult.error);
  throwIfError("jobs", jobsResult.error);
  throwIfError("job_photos", photosResult.error);
  throwIfError("parts", partsResult.error);
  throwIfError("job_line_items", lineItemsResult.error);
  throwIfError("invoices", invoicesResult.error);

  const jobPhotos = await Promise.all((photosResult.data ?? []).map(async (row) => {
    throwIfAborted(signal);
    const photo = jobPhotoFromRow(row);
    if (!photo.storagePath || photo.storagePath.startsWith("http") || photo.storagePath.startsWith("data:")) return photo;

    const { data } = await supabase.storage.from("job-photos").createSignedUrl(photo.storagePath, 60 * 60);
    throwIfAborted(signal);
    return data?.signedUrl ? { ...photo, storagePath: data.signedUrl } : photo;
  }));

  return {
    allowedUsers: (allowedUsersResult.data ?? []).map(allowedUserFromRow),
    customers: (customersResult.data ?? []).map(customerFromRow),
    jobs: (jobsResult.data ?? []).map(jobFromRow),
    jobPhotos,
    parts: (partsResult.data ?? []).map(partFromRow),
    jobLineItems: (lineItemsResult.data ?? []).map(lineItemFromRow),
    invoices: (invoicesResult.data ?? []).map(invoiceFromRow),
    callLogs: [],
    callLogEvents: []
  };
}

function applyLineItemUpdate(state: AppState, id: string, input: Partial<JobLineItem>): AppState {
  const existingItem = state.jobLineItems.find((item) => item.id === id);
  if (!existingItem) return state;
  const nextLineItems = state.jobLineItems.map((item) => item.id === id ? {
    ...item,
    ...input,
    quantity: input.quantity === undefined ? item.quantity : Number(input.quantity),
    unitPrice: input.unitPrice === undefined ? item.unitPrice : Number(input.unitPrice)
  } : item);
  const invoicePatch = invoiceTotalsPatchForJob(state.invoices, nextLineItems, existingItem.jobId);
  return {
    ...state,
    jobLineItems: nextLineItems,
    invoices: invoicePatch
      ? state.invoices.map((invoice) => invoice.id === invoicePatch.id ? { ...invoice, ...invoicePatch.patch } : invoice)
      : state.invoices
  };
}

function applyLineItemAdd(state: AppState, lineItem: JobLineItem): AppState {
  const nextLineItems = [...state.jobLineItems.filter((item) => item.id !== lineItem.id), lineItem];
  const invoicePatch = invoiceTotalsPatchForJob(state.invoices, nextLineItems, lineItem.jobId);
  return {
    ...state,
    jobLineItems: nextLineItems,
    invoices: invoicePatch
      ? state.invoices.map((invoice) => invoice.id === invoicePatch.id ? { ...invoice, ...invoicePatch.patch } : invoice)
      : state.invoices
  };
}

function applyLineItemDelete(state: AppState, id: string): AppState {
  const existingItem = state.jobLineItems.find((item) => item.id === id);
  if (!existingItem) return state;
  const nextLineItems = state.jobLineItems.filter((item) => item.id !== id);
  const invoicePatch = invoiceTotalsPatchForJob(state.invoices, nextLineItems, existingItem.jobId);
  return {
    ...state,
    jobLineItems: nextLineItems,
    invoices: invoicePatch
      ? state.invoices.map((invoice) => invoice.id === invoicePatch.id ? { ...invoice, ...invoicePatch.patch } : invoice)
      : state.invoices
  };
}

function searchCustomersLocally(query: string, visibleCustomers: Customer[]) {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return visibleCustomers.slice(0, 25);
  const digits = normalizePhone(trimmed);
  const normalizedQuery = normalizeSearchText(trimmed);
  const terms = normalizedQuery.split(/\s+/).filter(Boolean);

  return visibleCustomers
    .map((customer) => {
      const rawValues = [
        customer.name,
        customer.phone,
        customer.phoneDigits,
        customer.email,
        customer.addressLine1,
        customer.addressLine2,
        customer.city,
        customer.state,
        customer.zip,
        customer.notes
      ]
        .filter(Boolean) as string[];
      const haystack = normalizeSearchText(rawValues.join(" "));
      const tokens = haystack.split(/\s+/).filter(Boolean);

      const exactScore = haystack.includes(normalizedQuery) ? 8 : 0;
      const termScore = terms.reduce((score, term) => score + bestTermScore(term, tokens, haystack), 0);
      const digitScore = digits && customer.phoneDigits.includes(digits) ? 10 : 0;
      const prefixScore = normalizeSearchText(customer.name).startsWith(normalizedQuery) ? 6 : 0;
      const addressScore = normalizeSearchText(`${customer.addressLine1} ${customer.city} ${customer.zip}`).includes(normalizedQuery) ? 4 : 0;
      return { customer, score: exactScore + termScore + digitScore + prefixScore + addressScore };
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || a.customer.name.localeCompare(b.customer.name))
    .map((result) => result.customer)
    .slice(0, 25);
}

function normalizeSearchText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function bestTermScore(term: string, tokens: string[], haystack: string) {
  if (term.length === 0) return 0;
  if (haystack.includes(term)) return term.length > 2 ? 5 : 3;

  return tokens.reduce((best, token) => {
    if (token.startsWith(term) || term.startsWith(token)) return Math.max(best, 4);
    if (term.length >= 3 && isSubsequence(term, token)) return Math.max(best, 2);
    if (term.length >= 4 && editDistanceWithinOne(term, token)) return Math.max(best, 3);
    return best;
  }, 0);
}

function isSubsequence(needle: string, value: string) {
  let cursor = 0;
  for (const character of value) {
    if (character === needle[cursor]) cursor += 1;
    if (cursor === needle.length) return true;
  }
  return false;
}

function editDistanceWithinOne(left: string, right: string) {
  if (Math.abs(left.length - right.length) > 1) return false;

  let edits = 0;
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }

    edits += 1;
    if (edits > 1) return false;

    if (left.length > right.length) leftIndex += 1;
    else if (right.length > left.length) rightIndex += 1;
    else {
      leftIndex += 1;
      rightIndex += 1;
    }
  }

  return true;
}

function mergeCustomers(state: AppState, customers: Customer[]) {
  if (customers.length === 0) return state;

  let changed = false;
  const byId = new Map(state.customers.map((customer) => [customer.id, customer]));
  for (const customer of customers) {
    const existing = byId.get(customer.id);
    if (!existing || JSON.stringify(existing) !== JSON.stringify(customer)) {
      byId.set(customer.id, customer);
      changed = true;
    }
  }

  if (!changed) return state;
  return { ...state, customers: Array.from(byId.values()) };
}

function normalizeDemoState(state: AppState): AppState {
  return {
    ...state,
    customers: (state.customers ?? []).map((customer) => ({
      ...customer,
      emailNotificationsEnabled: customer.emailNotificationsEnabled ?? true,
      smsConsentStatus: customer.smsConsentStatus ?? "unknown",
      smsConsentAt: customer.smsConsentAt ?? undefined,
      smsConsentSource: customer.smsConsentSource ?? undefined
    })),
    jobs: (state.jobs ?? []).map((job) => ({
      ...job,
      arrivalWindowEndAt: job.arrivalWindowEndAt ?? defaultServiceWindowEndAt(job.scheduledAt) ?? job.scheduledAt
    })),
    invoices: (state.invoices ?? []).map((invoice) => ({
      ...invoice,
      optionLabel: invoice.optionLabel ?? "approved_work",
      notes: invoice.notes ?? "",
      paymentStatus: invoice.paymentStatus ?? "unpaid",
      amountPaid: invoice.amountPaid ?? 0,
      approvalStatus: invoice.approvalStatus ?? "not_signed",
      pdfVersion: invoice.pdfVersion ?? 0,
      updatedAt: invoice.updatedAt ?? invoice.createdAt
    }))
  };
}

function safeStorageName(fileName: string) {
  return fileName.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "photo.jpg";
}

function safeFileExtension(fileName: string) {
  const safeName = safeStorageName(fileName);
  const extension = safeName.match(/\.[a-z0-9]+$/)?.[0];
  return extension ?? ".jpg";
}

function throwIfError(label: string, error: { message: string } | null) {
  if (error) throw new Error(`${label}: ${error.message}`);
}

function isJwtIssuedAtFutureError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("jwt issued at future");
}

function workspaceErrorMessage(error: unknown) {
  if (error instanceof OperationTimeoutError) {
    return "Workspace loading took too long. Your session is still active; retry when the connection is ready.";
  }
  if (error instanceof Error) {
    const normalizedMessage = error.message.toLowerCase();
    if (
      normalizedMessage.includes("aborterror")
      || normalizedMessage.includes("aborted")
      || normalizedMessage.includes("timed out")
      || normalizedMessage.includes("failed to fetch")
    ) {
      return "Workspace loading took too long. Your session is still active; retry when the connection is ready.";
    }
    return error.message;
  }
  return "The workspace could not be loaded. Try again.";
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException("The workspace request was cancelled.", "AbortError");
}
