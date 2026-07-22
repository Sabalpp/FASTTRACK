import { describe, expect, it, vi } from "vitest";
import { ApiClientError } from "@/lib/protected-api-client";
import {
  DEMO_SCHEDULING_SETTINGS_KEY,
  readDemoSchedulingSettings,
  saveDemoSchedulingSettings
} from "@/lib/scheduling-settings-client";
import { DEFAULT_SCHEDULING_SETTINGS } from "@/lib/scheduling-settings";

describe("demo scheduling settings persistence", () => {
  it("persists an owner's complete validated settings under a versioned key", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value)
    };

    const saved = saveDemoSchedulingSettings(
      storage,
      "owner",
      { defaultArrivalWindowMinutes: 240, businessDayEndTime: "18:00" },
      "2026-07-22T18:00:00.000Z"
    );

    expect(saved).toEqual({
      ...DEFAULT_SCHEDULING_SETTINGS,
      defaultArrivalWindowMinutes: 240,
      businessDayEndTime: "18:00",
      updatedAt: "2026-07-22T18:00:00.000Z"
    });
    expect(JSON.parse(values.get(DEMO_SCHEDULING_SETTINGS_KEY)!)).toEqual(saved);
    expect(readDemoSchedulingSettings(storage)).toEqual(saved);
  });

  it.each(["tech", "call_center", undefined] as const)("blocks the %s role from demo updates", (role) => {
    const storage = { getItem: vi.fn(() => null), setItem: vi.fn() };
    expect(() => saveDemoSchedulingSettings(storage, role, { defaultArrivalWindowMinutes: 240 }))
      .toThrow(ApiClientError);
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("falls back safely when local state is absent or corrupt", () => {
    expect(readDemoSchedulingSettings(undefined)).toEqual(DEFAULT_SCHEDULING_SETTINGS);
    expect(readDemoSchedulingSettings({ getItem: () => "not-json" })).toEqual(DEFAULT_SCHEDULING_SETTINGS);
    expect(readDemoSchedulingSettings({ getItem: () => JSON.stringify({ timeZone: "UTC" }) }))
      .toEqual(DEFAULT_SCHEDULING_SETTINGS);
  });

  it("reports a storage failure instead of claiming the demo update succeeded", () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("Storage full", "QuotaExceededError");
      }
    };
    expect(() => saveDemoSchedulingSettings(storage, "owner", { defaultArrivalWindowMinutes: 240 }))
      .toThrow("could not be saved");
  });
});
