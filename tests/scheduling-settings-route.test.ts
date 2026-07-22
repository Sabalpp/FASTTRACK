import { beforeEach, describe, expect, it, vi } from "vitest";

const settingsHarness = vi.hoisted(() => ({
  requireServerActor: vi.fn(),
  loadSchedulingSettings: vi.fn(),
  saveSchedulingSettings: vi.fn()
}));

vi.mock("@/lib/server-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server-auth")>();
  return { ...actual, requireServerActor: settingsHarness.requireServerActor };
});

vi.mock("@/lib/scheduling-settings-server", () => ({
  loadSchedulingSettings: settingsHarness.loadSchedulingSettings,
  saveSchedulingSettings: settingsHarness.saveSchedulingSettings
}));

import { GET, PATCH } from "@/app/api/settings/scheduling/route";
import { DEFAULT_SCHEDULING_SETTINGS } from "@/lib/scheduling-settings";
import { HttpError } from "@/lib/server-auth";

const current = {
  ...DEFAULT_SCHEDULING_SETTINGS,
  updatedAt: "2026-07-22T12:00:00.000Z"
};

describe("scheduling settings API", () => {
  beforeEach(() => {
    for (const mock of Object.values(settingsHarness)) mock.mockReset();
    settingsHarness.loadSchedulingSettings.mockResolvedValue(current);
  });

  it.each(["owner", "tech", "call_center"] as const)("lets an authenticated %s read the effective settings", async (role) => {
    const authenticated = actor(role);
    settingsHarness.requireServerActor.mockResolvedValue(authenticated);

    const response = await GET(request("GET"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(await response.json()).toEqual({ settings: current });
    expect(settingsHarness.loadSchedulingSettings).toHaveBeenCalledWith(authenticated.supabase);
  });

  it("persists an owner's partial patch as a complete configuration", async () => {
    const authenticated = actor("owner");
    const saved = {
      ...current,
      defaultArrivalWindowMinutes: 240,
      updatedAt: "2026-07-22T13:00:00.000Z"
    };
    settingsHarness.requireServerActor.mockResolvedValue(authenticated);
    settingsHarness.saveSchedulingSettings.mockResolvedValue(saved);

    const response = await PATCH(request("PATCH", { defaultArrivalWindowMinutes: 240 }));

    expect(response.status).toBe(200);
    expect(settingsHarness.saveSchedulingSettings).toHaveBeenCalledWith(
      authenticated.supabase,
      { ...current, defaultArrivalWindowMinutes: 240 },
      authenticated.user.id
    );
    expect(await response.json()).toEqual({ settings: saved });
  });

  it.each(["tech", "call_center"] as const)("rejects a %s update before reading or writing settings", async (role) => {
    settingsHarness.requireServerActor.mockResolvedValue(actor(role));

    const response = await PATCH(request("PATCH", { defaultArrivalWindowMinutes: 240 }));

    expect(response.status).toBe(403);
    expect((await response.json()).error).toContain("Only an owner");
    expect(settingsHarness.loadSchedulingSettings).not.toHaveBeenCalled();
    expect(settingsHarness.saveSchedulingSettings).not.toHaveBeenCalled();
  });

  it("rejects invalid cross-field settings without saving", async () => {
    settingsHarness.requireServerActor.mockResolvedValue(actor("owner"));

    const response = await PATCH(request("PATCH", {
      schedulingIncrementMinutes: 10,
      defaultArrivalWindowMinutes: 45
    }));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("divisible");
    expect(settingsHarness.saveSchedulingSettings).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON without loading current settings", async () => {
    settingsHarness.requireServerActor.mockResolvedValue(actor("owner"));
    const malformed = new Request("http://localhost/api/settings/scheduling", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: "{"
    }) as never;

    const response = await PATCH(malformed);

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("valid JSON");
    expect(settingsHarness.loadSchedulingSettings).not.toHaveBeenCalled();
  });

  it("passes authentication failures through the protected route contract", async () => {
    settingsHarness.requireServerActor.mockRejectedValue(new HttpError(401, "Sign in again."));
    const response = await GET(request("GET"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: "Sign in again." });
  });
});

function request(method: "GET" | "PATCH", body?: unknown) {
  return new Request("http://localhost/api/settings/scheduling", {
    method,
    ...(body === undefined ? {} : {
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    })
  }) as never;
}

function actor(role: "owner" | "tech" | "call_center") {
  return {
    authUserId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    user: {
      id: "11111111-1111-4111-8111-111111111111",
      email: `${role}@fasttrack.test`,
      role,
      displayName: role,
      active: true,
      createdAt: "2026-07-22T00:00:00.000Z"
    },
    supabase: { authority: "service-role" }
  };
}
