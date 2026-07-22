import { protectedJson, ApiClientError } from "@/lib/protected-api-client";
import { demoMode } from "@/lib/runtime";
import {
  DEFAULT_SCHEDULING_SETTINGS,
  applySchedulingSettingsPatch,
  validateSchedulingSettings,
  type SchedulingSettings,
  type SchedulingSettingsPatch
} from "@/lib/scheduling-settings";
import type { Role } from "@/lib/types";

export const DEMO_SCHEDULING_SETTINGS_KEY = "hvac-plumbing-mvp-scheduling-settings-v1";

export type SchedulingSettingsStorage = Pick<Storage, "getItem" | "setItem">;

export async function loadSchedulingSettings(): Promise<SchedulingSettings> {
  if (demoMode) return readDemoSchedulingSettings(browserStorage());

  const result = await protectedJson<{ settings: SchedulingSettings }>("/api/settings/scheduling", {
    cache: "no-store"
  });
  return validateSchedulingSettings(result.settings);
}

export async function updateSchedulingSettings(
  patch: SchedulingSettingsPatch,
  actorRole?: Role
): Promise<SchedulingSettings> {
  if (demoMode) {
    const storage = browserStorage();
    if (!storage) throw new ApiClientError(503, "Demo scheduling settings cannot be saved on this device.");
    return saveDemoSchedulingSettings(storage, actorRole, patch);
  }

  const result = await protectedJson<{ settings: SchedulingSettings }>("/api/settings/scheduling", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch)
  });
  return validateSchedulingSettings(result.settings);
}

export function readDemoSchedulingSettings(
  storage: Pick<Storage, "getItem"> | undefined
): SchedulingSettings {
  if (!storage) return { ...DEFAULT_SCHEDULING_SETTINGS };

  try {
    const raw = storage.getItem(DEMO_SCHEDULING_SETTINGS_KEY);
    return raw ? validateSchedulingSettings(JSON.parse(raw)) : { ...DEFAULT_SCHEDULING_SETTINGS };
  } catch {
    return { ...DEFAULT_SCHEDULING_SETTINGS };
  }
}

export function saveDemoSchedulingSettings(
  storage: SchedulingSettingsStorage,
  actorRole: Role | undefined,
  patch: unknown,
  updatedAt = new Date().toISOString()
): SchedulingSettings {
  if (actorRole !== "owner") {
    throw new ApiClientError(403, "Only an owner can change scheduling settings.");
  }

  const next = validateSchedulingSettings({
    ...applySchedulingSettingsPatch(readDemoSchedulingSettings(storage), patch),
    updatedAt
  });

  try {
    storage.setItem(DEMO_SCHEDULING_SETTINGS_KEY, JSON.stringify(next));
  } catch {
    throw new ApiClientError(503, "Demo scheduling settings could not be saved on this device.");
  }
  return next;
}

function browserStorage(): SchedulingSettingsStorage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
