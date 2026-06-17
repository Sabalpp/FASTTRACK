"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { demoState } from "@/lib/demo-data";
import { buildInvoiceDraft, invoiceNumber } from "@/lib/invoice";
import { normalizePhone } from "@/lib/phone";
import { demoMode } from "@/lib/runtime";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import {
  allowedUserFromRow,
  allowedUserPatchToRow,
  allowedUserToRow,
  callLogEventFromRow,
  callLogFromRow,
  createEmptyAppState,
  customerFromRow,
  customerPatchToRow,
  customerToRow,
  invoiceFromRow,
  invoicePatchToRow,
  invoiceToRow,
  jobFromRow,
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

type NewCustomerInput = Omit<Customer, "id" | "phoneDigits" | "createdAt">;
type NewJobInput = Omit<Job, "id" | "status" | "createdAt"> & { status?: JobStatus };
type NewPartInput = Omit<Part, "id" | "createdAt" | "active"> & { active?: boolean };
type NewLineItemInput = Omit<JobLineItem, "id" | "sortOrder">;
type NewPhotoInput = Omit<JobPhoto, "id" | "uploadedAt"> & { file?: File };
type NewAllowedUserInput = Omit<AllowedUser, "id" | "createdAt">;

type AppDataContextValue = AppState & {
  loaded: boolean;
  lastError?: string;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  resetDemoData: () => void;
  searchCustomers: (query: string, visibleCustomers?: Customer[]) => Promise<Customer[]>;
  createCustomer: (input: NewCustomerInput) => Customer;
  updateCustomer: (id: string, input: Partial<Customer>) => void;
  createJob: (input: NewJobInput) => Job;
  updateJob: (id: string, input: Partial<Job>) => void;
  addPhoto: (input: NewPhotoInput) => JobPhoto;
  addLineItem: (input: NewLineItemInput) => JobLineItem;
  updateLineItem: (id: string, input: Partial<JobLineItem>) => void;
  deleteLineItem: (id: string) => void;
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
  const [state, setState] = useState<AppState>(() => (demoMode ? demoState : createEmptyAppState()));
  const [loaded, setLoaded] = useState(false);
  const [lastError, setLastError] = useState<string | undefined>();

  useEffect(() => {
    if (!demoMode) return;

    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        setState(JSON.parse(raw) as AppState);
      }
    } catch (error) {
      console.warn("Could not load demo state from localStorage", error);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!demoMode || !loaded) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [loaded, state]);

  useEffect(() => {
    if (demoMode) return;

    const client = supabase;
    if (!client) {
      setState(createEmptyAppState());
      setLastError("Supabase credentials are not configured.");
      setLoaded(true);
      return;
    }
    const dataClient: NonNullable<typeof client> = client;

    let cancelled = false;

    async function loadForCurrentSession() {
      setLoaded(false);
      const { data: sessionData, error: sessionError } = await dataClient.auth.getSession();
      if (cancelled) return;

      if (sessionError) {
        setState(createEmptyAppState());
        setLastError(sessionError.message);
        setLoaded(true);
        return;
      }

      if (!sessionData.session) {
        setState(createEmptyAppState());
        setLastError(undefined);
        setLoaded(true);
        return;
      }

      try {
        const nextState = await loadSupabaseState(dataClient);
        if (cancelled) return;
        setState(nextState);
        setLastError(undefined);
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "Could not load Supabase data.";
        setState(createEmptyAppState());
        setLastError(message);
        console.error(message, error);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    }

    void loadForCurrentSession();
    const {
      data: { subscription }
    } = dataClient.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        setState(createEmptyAppState());
        setLastError(undefined);
        setLoaded(true);
        return;
      }
      void loadForCurrentSession();
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [supabase]);

  const value = useMemo<AppDataContextValue>(() => {
    function persistSupabase(label: string, action: () => Promise<unknown>) {
      if (demoMode || !supabase) return;

      void action().catch((error) => {
        const message = error instanceof Error ? error.message : `Supabase ${label} failed.`;
        setLastError(message);
        console.error(`Supabase ${label} failed`, error);
      });
    }

    function resetDemoData() {
      if (!demoMode) return;

      setState(demoState);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(demoState));
    }

    async function searchCustomers(query: string, visibleCustomers = state.customers) {
      const localResults = searchCustomersLocally(query, visibleCustomers);
      if (demoMode || !supabase) return localResults;

      const trimmed = query.trim();
      if (!trimmed) return state.customers.slice(0, 25);

      const { data, error } = await supabase.rpc("search_customers", {
        search_query: trimmed,
        limit_count: 25
      });

      if (error) {
        setLastError(error.message);
        return localResults;
      }

      const customers = (data ?? []).map(customerFromRow);
      setState((current) => mergeCustomers(current, customers));
      return customers;
    }

    function createCustomer(input: NewCustomerInput) {
      const customer: Customer = {
        ...input,
        id: crypto.randomUUID(),
        phoneDigits: normalizePhone(input.phone),
        createdAt: new Date().toISOString()
      };
      setState((current) => ({ ...current, customers: [customer, ...current.customers] }));
      persistSupabase("customer insert", async () => {
        const { error } = await supabase!.from("customers").insert(customerToRow(customer));
        if (error) throw error;
      });
      return customer;
    }

    function updateCustomer(id: string, input: Partial<Customer>) {
      setState((current) => ({
        ...current,
        customers: current.customers.map((customer) =>
          customer.id === id
            ? { ...customer, ...input, phoneDigits: input.phone ? normalizePhone(input.phone) : customer.phoneDigits }
            : customer
        )
      }));
      persistSupabase("customer update", async () => {
        const { error } = await supabase!.from("customers").update(customerPatchToRow(input)).eq("id", id);
        if (error) throw error;
      });
    }

    function createJob(input: NewJobInput) {
      const job: Job = {
        ...input,
        id: crypto.randomUUID(),
        status: input.status ?? "scheduled",
        createdAt: new Date().toISOString()
      };
      setState((current) => ({ ...current, jobs: [job, ...current.jobs] }));
      persistSupabase("job insert", async () => {
        const { error } = await supabase!.from("jobs").insert(jobToRow(job));
        if (error) throw error;
      });
      return job;
    }

    function updateJob(id: string, input: Partial<Job>) {
      let patch = input;
      setState((current) => ({
        ...current,
        jobs: current.jobs.map((job) => {
          if (job.id !== id) return job;
          const completedAt = input.status === "complete" && job.status !== "complete" ? new Date().toISOString() : job.completedAt;
          patch = { ...input, completedAt };
          return { ...job, ...patch };
        })
      }));
      persistSupabase("job update", async () => {
        const { error } = await supabase!.from("jobs").update(jobPatchToRow(patch)).eq("id", id);
        if (error) throw error;
      });
    }

    function addPhoto(input: NewPhotoInput) {
      const photoId = crypto.randomUUID();
      const uploadedAt = new Date().toISOString();
      const storagePath = !demoMode && input.file ? `${input.jobId}/${photoId}${safeFileExtension(input.file.name)}` : input.storagePath;
      const previewPath = !demoMode && input.file ? URL.createObjectURL(input.file) : input.storagePath;
      const photo: JobPhoto = {
        id: photoId,
        jobId: input.jobId,
        storagePath: previewPath,
        kind: input.kind,
        caption: input.caption,
        uploadedBy: input.uploadedBy,
        uploadedAt
      };

      setState((current) => ({ ...current, jobPhotos: [photo, ...current.jobPhotos] }));
      persistSupabase("photo upload", async () => {
        let displayPath = storagePath;
        if (input.file) {
          const { error: uploadError } = await supabase!.storage.from("job-photos").upload(storagePath, input.file, {
            cacheControl: "3600",
            upsert: false
          });
          if (uploadError) throw uploadError;

          const { data: signedData, error: signedError } = await supabase!.storage.from("job-photos").createSignedUrl(storagePath, 60 * 60);
          if (!signedError && signedData?.signedUrl) displayPath = signedData.signedUrl;
        }

        const { error } = await supabase!.from("job_photos").insert(jobPhotoToRow({ ...photo, storagePath }));
        if (error) throw error;

        setState((current) => ({
          ...current,
          jobPhotos: current.jobPhotos.map((candidate) =>
            candidate.id === photo.id ? { ...candidate, storagePath: displayPath } : candidate
          )
        }));

        if (previewPath.startsWith("blob:")) URL.revokeObjectURL(previewPath);
      });

      return photo;
    }

    function addLineItem(input: NewLineItemInput) {
      const existingCount = state.jobLineItems.filter((item) => item.jobId === input.jobId).length;
      const lineItem: JobLineItem = {
        ...input,
        id: crypto.randomUUID(),
        quantity: Number(input.quantity),
        unitPrice: Number(input.unitPrice),
        sortOrder: existingCount + 1
      };
      setState((current) => ({ ...current, jobLineItems: [...current.jobLineItems, lineItem] }));
      persistSupabase("line item insert", async () => {
        const { error } = await supabase!.from("job_line_items").insert(lineItemToRow(lineItem));
        if (error) throw error;
      });
      return lineItem;
    }

    function updateLineItem(id: string, input: Partial<JobLineItem>) {
      setState((current) => ({
        ...current,
        jobLineItems: current.jobLineItems.map((item) =>
          item.id === id
            ? {
                ...item,
                ...input,
                quantity: input.quantity === undefined ? item.quantity : Number(input.quantity),
                unitPrice: input.unitPrice === undefined ? item.unitPrice : Number(input.unitPrice)
              }
            : item
        )
      }));
      persistSupabase("line item update", async () => {
        const { error } = await supabase!.from("job_line_items").update(lineItemPatchToRow(input)).eq("id", id);
        if (error) throw error;
      });
    }

    function deleteLineItem(id: string) {
      setState((current) => ({
        ...current,
        jobLineItems: current.jobLineItems.filter((item) => item.id !== id)
      }));
      persistSupabase("line item delete", async () => {
        const { error } = await supabase!.from("job_line_items").delete().eq("id", id);
        if (error) throw error;
      });
    }

    function createPart(input: NewPartInput) {
      const part: Part = {
        ...input,
        id: crypto.randomUUID(),
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
      const existing = state.invoices.find((invoice) => invoice.jobId === jobId);
      const items = state.jobLineItems.filter((item) => item.jobId === jobId);
      const draft = buildInvoiceDraft({
        id: crypto.randomUUID(),
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
        id: crypto.randomUUID(),
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
      setState,
      resetDemoData,
      searchCustomers,
      createCustomer,
      updateCustomer,
      createJob,
      updateJob,
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
  }, [state, loaded, lastError, supabase]);

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData() {
  const value = useContext(AppDataContext);
  if (!value) throw new Error("useAppData must be used inside AppDataProvider");
  return value;
}

export const roleLabels: Record<Role, string> = {
  owner: "Owner",
  tech: "Tech",
  call_center: "Call Center"
};

export const tierLabels: Record<Tier, string> = {
  good: "Good",
  better: "Better",
  best: "Best"
};

export const unitOptions: Unit[] = ["each", "hour", "lb", "visit", "other"];
export const tierOptions: Tier[] = ["good", "better", "best"];
export const roleOptions: Role[] = ["owner", "tech", "call_center"];
export const photoKinds: PhotoKind[] = ["before", "after", "other"];

async function loadSupabaseState(supabase: SupabaseClient): Promise<AppState> {
  const [
    allowedUsersResult,
    customersResult,
    jobsResult,
    photosResult,
    partsResult,
    lineItemsResult,
    invoicesResult,
    callLogsResult,
    callLogEventsResult
  ] = await Promise.all([
    supabase.from("allowed_users").select("*").order("display_name", { ascending: true }),
    supabase.from("customers").select("*").order("created_at", { ascending: false }),
    supabase.from("jobs").select("*").order("scheduled_at", { ascending: false }),
    supabase.from("job_photos").select("*").order("uploaded_at", { ascending: false }),
    supabase.from("parts").select("*").order("name", { ascending: true }),
    supabase.from("job_line_items").select("*").order("sort_order", { ascending: true }),
    supabase.from("invoices").select("*").order("created_at", { ascending: false }),
    supabase.from("call_logs").select("*").order("started_at", { ascending: false }).limit(100),
    supabase.from("call_log_events").select("*").order("received_at", { ascending: false }).limit(100)
  ]);

  throwIfError("allowed_users", allowedUsersResult.error);
  throwIfError("customers", customersResult.error);
  throwIfError("jobs", jobsResult.error);
  throwIfError("job_photos", photosResult.error);
  throwIfError("parts", partsResult.error);
  throwIfError("job_line_items", lineItemsResult.error);
  throwIfError("invoices", invoicesResult.error);
  throwIfError("call_logs", callLogsResult.error);
  throwIfError("call_log_events", callLogEventsResult.error);

  const jobPhotos = await Promise.all((photosResult.data ?? []).map(async (row) => {
    const photo = jobPhotoFromRow(row);
    if (!photo.storagePath || photo.storagePath.startsWith("http") || photo.storagePath.startsWith("data:")) return photo;

    const { data } = await supabase.storage.from("job-photos").createSignedUrl(photo.storagePath, 60 * 60);
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
    callLogs: (callLogsResult.data ?? []).map(callLogFromRow),
    callLogEvents: (callLogEventsResult.data ?? []).map(callLogEventFromRow)
  };
}

function searchCustomersLocally(query: string, visibleCustomers: Customer[]) {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return visibleCustomers.slice(0, 25);
  const digits = normalizePhone(trimmed);
  const terms = trimmed.split(/\s+/).filter(Boolean);

  return visibleCustomers
    .map((customer) => {
      const haystack = [
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
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      const termScore = terms.reduce((score, term) => (haystack.includes(term) ? score + 1 : score), 0);
      const digitScore = digits && customer.phoneDigits.includes(digits) ? 3 : 0;
      const prefixScore = customer.name.toLowerCase().startsWith(trimmed) ? 2 : 0;
      return { customer, score: termScore + digitScore + prefixScore };
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || a.customer.name.localeCompare(b.customer.name))
    .map((result) => result.customer)
    .slice(0, 25);
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
