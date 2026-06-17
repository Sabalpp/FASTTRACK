import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null | undefined;

export function getSupabaseBrowserClient() {
  if (browserClient !== undefined) return browserClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    browserClient = null;
    return browserClient;
  }

  browserClient = createClient(url, anonKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      persistSession: true
    }
  });
  return browserClient;
}
