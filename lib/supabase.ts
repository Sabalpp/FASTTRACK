import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null | undefined;
const REQUEST_TIMEOUT_MS = 15_000;

export function getSupabaseBrowserClient() {
  if (browserClient !== undefined) return browserClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const browserKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !browserKey) {
    browserClient = null;
    return browserClient;
  }

  browserClient = createClient(url, browserKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      persistSession: true
    },
    global: {
      fetch: fetchWithDeadline
    }
  });
  return browserClient;
}

export function clearSupabaseBrowserSessionStorage() {
  if (typeof window === "undefined") return;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return;

  try {
    const projectRef = new URL(url).hostname.split(".")[0];
    const storagePrefix = `sb-${projectRef}-auth-token`;

    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);
      if (key === storagePrefix || key?.startsWith(`${storagePrefix}-`)) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    // Invalid configuration is surfaced by getSupabaseBrowserClient.
  }
}

async function fetchWithDeadline(input: RequestInfo | URL, init: RequestInit = {}) {
  const controller = new AbortController();
  const callerSignal = init.signal;
  const abortFromCaller = () => controller.abort();

  if (callerSignal?.aborted) abortFromCaller();
  else callerSignal?.addEventListener("abort", abortFromCaller, { once: true });

  const timeoutId = globalThis.setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    globalThis.clearTimeout(timeoutId);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }
}
