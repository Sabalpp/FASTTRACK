import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const authHarness = vi.hoisted(() => ({
  getSupabaseAdminClient: vi.fn(),
  getAuthenticatedSupabase: vi.fn()
}));

vi.mock("@/lib/supabase-admin", () => ({
  getSupabaseAdminClient: authHarness.getSupabaseAdminClient
}));

vi.mock("@/lib/supabase-user-server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase-user-server")>();
  return {
    ...actual,
    getAuthenticatedSupabase: authHarness.getAuthenticatedSupabase
  };
});

import { NextRequest } from "next/server";
import { HttpError, requireServerActor } from "@/lib/server-auth";
import { RequestAuthError } from "@/lib/supabase-user-server";

const AUTH_USER_ID = "11111111-1111-4111-8111-111111111111";
const ALLOWED_USER_ID = "22222222-2222-4222-8222-222222222222";

describe("Phase 4 server actor authorization", () => {
  beforeEach(() => {
    authHarness.getSupabaseAdminClient.mockReset();
    authHarness.getAuthenticatedSupabase.mockReset();
  });

  it("uses the shared exact allowlist result and never performs a wildcard email lookup", async () => {
    const database = createAdminDatabase();
    const request = authenticatedRequest();
    authHarness.getSupabaseAdminClient.mockReturnValue(database.client);
    authHarness.getAuthenticatedSupabase.mockResolvedValue(authenticatedActor());

    const actor = await requireServerActor(request);

    expect(authHarness.getAuthenticatedSupabase).toHaveBeenCalledExactlyOnceWith(request);
    expect(database.from).toHaveBeenCalledExactlyOnceWith("allowed_users");
    expect(database.query.eq).toHaveBeenNthCalledWith(1, "id", ALLOWED_USER_ID);
    expect(database.query.eq).toHaveBeenNthCalledWith(2, "active", true);
    expect(database.query.ilike).not.toHaveBeenCalled();
    expect(actor.authUserId).toBe(AUTH_USER_ID);
    expect(actor.user).toMatchObject({
      id: ALLOWED_USER_ID,
      email: "owner@example.com",
      role: "owner",
      active: true
    });
    expect(actor.supabase).toBe(database.client);
  });

  it("preserves the shared owner AAL2 denial before privileged database access", async () => {
    const database = createAdminDatabase();
    authHarness.getSupabaseAdminClient.mockReturnValue(database.client);
    authHarness.getAuthenticatedSupabase.mockRejectedValue(
      new RequestAuthError(
        "Complete owner two-step verification before sending customer confirmations.",
        403
      )
    );

    const error = await requireServerActor(authenticatedRequest()).catch((caught) => caught);

    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({
      status: 403,
      message: "Complete owner two-step verification before sending customer confirmations."
    });
    expect(database.from).not.toHaveBeenCalled();
  });

  it("fails closed if the allowlist role changes between authentication and actor loading", async () => {
    const database = createAdminDatabase({ role: "owner" });
    authHarness.getSupabaseAdminClient.mockReturnValue(database.client);
    authHarness.getAuthenticatedSupabase.mockResolvedValue(authenticatedActor({ role: "call_center" }));

    await expect(requireServerActor(authenticatedRequest())).rejects.toMatchObject({
      status: 403,
      message: "Your Fast Track access changed. Sign in again."
    });
  });
});

function authenticatedRequest() {
  return new NextRequest("https://example.test/api/invoices", {
    headers: { authorization: "Bearer valid-session-token" }
  });
}

function authenticatedActor(overrides: Partial<{
  role: "owner" | "call_center" | "tech";
  email: string;
}> = {}) {
  return {
    client: {} as SupabaseClient,
    role: overrides.role ?? "owner",
    authUserId: AUTH_USER_ID,
    allowedUserId: ALLOWED_USER_ID,
    email: overrides.email ?? "owner@example.com"
  };
}

function createAdminDatabase(overrides: Partial<{
  id: string;
  email: string;
  role: string;
  active: boolean;
}> = {}) {
  const row = {
    id: overrides.id ?? ALLOWED_USER_ID,
    email: overrides.email ?? "owner@example.com",
    role: overrides.role ?? "owner",
    display_name: "Workspace Owner",
    active: overrides.active ?? true,
    created_at: "2026-07-21T12:00:00.000Z"
  };
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    ilike: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null })
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.ilike.mockReturnValue(query);
  const from = vi.fn().mockReturnValue(query);

  return {
    client: { from } as unknown as SupabaseClient,
    from,
    query
  };
}
