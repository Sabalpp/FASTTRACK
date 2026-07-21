import { withTimeout } from "@/lib/async-utils";
import { getSupabaseBrowserClient } from "@/lib/supabase";

const API_TIMEOUT_MS = 25_000;

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export async function protectedFetch(path: string, init: RequestInit = {}) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new ApiClientError(503, "Supabase is not configured.");

  const { data, error } = await withTimeout(supabase.auth.getSession(), 12_000, "Session check");
  const accessToken = data.session?.access_token;
  if (error || !accessToken) throw new ApiClientError(401, "Your session expired. Sign in again.");

  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${accessToken}`);

  try {
    return await fetch(path, { ...init, headers, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiClientError(408, "The request took too long. Check the connection and retry.");
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

export async function protectedJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await protectedFetch(path, init);
  const body = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new ApiClientError(response.status, body.error ?? "The request failed.");
  return body;
}
