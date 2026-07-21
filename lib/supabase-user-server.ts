import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Role } from "@/lib/types";

if (typeof window !== "undefined" && process.env.NODE_ENV !== "test") {
  throw new Error("Authenticated Supabase request helpers can only be used by server modules.");
}

export class RequestAuthError extends Error {
  constructor(message: string, readonly status: 401 | 403 | 503) {
    super(message);
  }
}

export type AuthenticatedSupabase = {
  client: SupabaseClient;
  role: Role;
  authUserId: string;
  allowedUserId: string;
  email: string;
};

export async function getAuthenticatedSupabase(request: Request): Promise<AuthenticatedSupabase> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const browserKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !browserKey) throw new RequestAuthError("Supabase is not configured for notification delivery.", 503);

  const authorization = request.headers.get("authorization") ?? "";
  const accessToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!accessToken) throw new RequestAuthError("A signed-in Fast Track session is required.", 401);

  const client = createClient(url, browserKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    }
  });

  const { data: userData, error: userError } = await client.auth.getUser(accessToken);
  const email = userData.user?.email?.trim() ?? "";
  if (userError || !userData.user || !email) throw new RequestAuthError("Your session is no longer valid. Sign in again.", 401);

  const [roleResult, allowedUserResult] = await Promise.all([
    client.rpc("current_allowed_role"),
    client.rpc("current_allowed_user_id")
  ]);
  if (roleResult.error || allowedUserResult.error) {
    throw new RequestAuthError("Fast Track access could not be verified.", 403);
  }
  const roleData = roleResult.data;
  const role = roleData as Role | null;
  const allowedUserId = typeof allowedUserResult.data === "string"
    ? allowedUserResult.data
    : "";
  if (!role || !allowedUserId || !["owner", "call_center", "tech"].includes(role)) {
    throw new RequestAuthError("This account is not active on the Fast Track allowlist.", 403);
  }

  if (role === "owner" && process.env.NEXT_PUBLIC_REQUIRE_OWNER_MFA === "true") {
    const { data: assurance, error: assuranceError } = await client.auth.mfa
      .getAuthenticatorAssuranceLevel(accessToken);
    if (assuranceError || assurance.currentLevel !== "aal2") {
      throw new RequestAuthError("Complete owner two-step verification before sending customer confirmations.", 403);
    }
  }

  return {
    client,
    role,
    authUserId: userData.user.id,
    allowedUserId,
    email
  };
}
