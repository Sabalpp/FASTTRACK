"use client";

import { demoMode } from "@/lib/runtime";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import type { AppointmentNotificationSummary } from "@/lib/types";

export type ConfirmationDispatchMode = "pending" | "retry" | "resend";

export type ConfirmationApiResult = {
  notifications: AppointmentNotificationSummary[];
  processedCount: number;
  providerConfigured: {
    email: boolean;
    sms: boolean;
  };
};

export async function fetchJobConfirmations(jobId: string): Promise<ConfirmationApiResult> {
  if (demoMode) return demoResult();
  return request(jobId, { method: "GET" });
}

export async function dispatchJobConfirmations(
  jobId: string,
  mode: ConfirmationDispatchMode = "pending"
): Promise<ConfirmationApiResult> {
  if (demoMode) return demoResult();
  return request(jobId, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode,
      requestId: mode === "resend" ? crypto.randomUUID() : undefined
    })
  });
}

async function request(jobId: string, init: RequestInit): Promise<ConfirmationApiResult> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase authentication is not configured.");

  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message);
  const accessToken = data.session?.access_token;
  if (!accessToken) throw new Error("Your session expired. Sign in again before sending a customer confirmation.");

  const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/confirmations`, {
    ...init,
    cache: "no-store",
    headers: {
      ...init.headers,
      Authorization: `Bearer ${accessToken}`
    }
  });
  const payload = await response.json().catch(() => ({})) as Partial<ConfirmationApiResult> & { error?: string };
  if (!response.ok) throw new Error(payload.error || "Customer confirmation delivery failed.");

  return {
    notifications: payload.notifications ?? [],
    processedCount: payload.processedCount ?? 0,
    providerConfigured: payload.providerConfigured ?? { email: false, sms: false }
  };
}

function demoResult(): ConfirmationApiResult {
  return {
    notifications: [],
    processedCount: 0,
    providerConfigured: { email: false, sms: false }
  };
}
