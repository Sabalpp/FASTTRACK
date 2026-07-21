import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";
import { getAuthenticatedSupabase, RequestAuthError } from "@/lib/supabase-user-server";
import type { AllowedUser } from "@/lib/types";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export type ServerActor = {
  authUserId: string;
  user: AllowedUser;
  supabase: SupabaseClient;
};

export async function requireServerActor(request: NextRequest): Promise<ServerActor> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) throw new HttpError(503, "The protected server connection is not configured.");

  let authenticated: Awaited<ReturnType<typeof getAuthenticatedSupabase>>;
  try {
    // Keep invoice/signature routes on the same exact allowlist and owner-MFA
    // policy used by the rest of the server API.
    authenticated = await getAuthenticatedSupabase(request);
  } catch (error) {
    if (error instanceof RequestAuthError) throw new HttpError(error.status, error.message);
    throw error;
  }

  const { data: allowedUser, error: allowedUserError } = await supabase
    .from("allowed_users")
    .select("id,email,role,display_name,active,created_at")
    .eq("id", authenticated.allowedUserId)
    .eq("active", true)
    .maybeSingle();

  if (allowedUserError) throw new HttpError(503, "Account access could not be checked.");
  if (!allowedUser) throw new HttpError(403, "This account is not active in the Fast Track workspace.");
  if (
    allowedUser.id !== authenticated.allowedUserId
    || allowedUser.role !== authenticated.role
    || allowedUser.email.trim().toLowerCase() !== authenticated.email.trim().toLowerCase()
  ) {
    throw new HttpError(403, "Your Fast Track access changed. Sign in again.");
  }

  return {
    authUserId: authenticated.authUserId,
    user: {
      id: allowedUser.id,
      email: allowedUser.email,
      role: allowedUser.role as AllowedUser["role"],
      displayName: allowedUser.display_name,
      active: allowedUser.active,
      createdAt: allowedUser.created_at
    },
    supabase
  };
}

export function requireOwner(actor: ServerActor) {
  if (actor.user.role !== "owner") throw new HttpError(403, "Only an owner can change invoice or payment details.");
}

export function assertOwnerOrAssignedTech(actor: ServerActor, assignedTechId: string | null | undefined) {
  if (actor.user.role === "owner") return;
  if (actor.user.role === "tech" && assignedTechId === actor.user.id) return;
  throw new HttpError(403, "This job is outside your assigned work.");
}

export function requestAuditMetadata(request: NextRequest, actor: ServerActor) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  return {
    source: "web_signature_canvas",
    collectedByAuthUserId: actor.authUserId,
    userAgent: (request.headers.get("user-agent") ?? "unknown").slice(0, 300),
    ipHash: forwardedFor ? createHash("sha256").update(forwardedFor).digest("hex") : undefined
  };
}

export function routeErrorResponse(error: unknown) {
  if (error instanceof HttpError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
  }

  console.error("Protected invoice request failed", error);
  return NextResponse.json({ ok: false, error: "The request could not be completed." }, { status: 500 });
}
