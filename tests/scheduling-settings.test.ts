import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCHEDULING_SETTINGS,
  SchedulingSettingsValidationError,
  applySchedulingSettingsPatch,
  schedulingSettingsFromRow,
  validateSchedulingSettings
} from "@/lib/scheduling-settings";

describe("scheduling settings contract", () => {
  it("preserves the existing three-hour arrival window and 8-to-5 workday defaults", () => {
    expect(DEFAULT_SCHEDULING_SETTINGS).toEqual({
      timeZone: "America/New_York",
      defaultArrivalWindowMinutes: 180,
      businessDayStartTime: "08:00",
      businessDayEndTime: "17:00",
      schedulingIncrementMinutes: 15
    });
  });

  it("merges partial owner updates into a complete validated configuration", () => {
    expect(applySchedulingSettingsPatch(
      { ...DEFAULT_SCHEDULING_SETTINGS, updatedAt: "2026-07-22T12:00:00.000Z" },
      { defaultArrivalWindowMinutes: 240 }
    )).toEqual({
      ...DEFAULT_SCHEDULING_SETTINGS,
      defaultArrivalWindowMinutes: 240,
      updatedAt: "2026-07-22T12:00:00.000Z"
    });
  });

  it.each([
    [{ defaultArrivalWindowMinutes: 14 }, "15 to 720"],
    [{ defaultArrivalWindowMinutes: 721 }, "15 to 720"],
    [{ defaultArrivalWindowMinutes: 46 }, "divisible"],
    [{ schedulingIncrementMinutes: 20 }, "5, 10, 15, 30, or 60"],
    [{ businessDayStartTime: "8:00" }, "HH:mm"],
    [{ businessDayEndTime: "08:00" }, "later"],
    [{ timeZone: "Not/A_Real_Zone" }, "Unknown scheduling setting"],
    [{ timeZone: null }, "Unknown scheduling setting"],
    [{ updatedAt: "read-only" }, "Unknown scheduling setting"]
  ])("rejects an unsafe partial patch: %j", (patch, message) => {
    expect(() => applySchedulingSettingsPatch(DEFAULT_SCHEDULING_SETTINGS, patch))
      .toThrow(message);
  });

  it("validates increment and duration together after a partial update", () => {
    expect(() => applySchedulingSettingsPatch(DEFAULT_SCHEDULING_SETTINGS, {
      schedulingIncrementMinutes: 10,
      defaultArrivalWindowMinutes: 45
    })).toThrow("divisible");
  });

  it("allows valid HH:mm working hours independent of the appointment increment", () => {
    expect(applySchedulingSettingsPatch(DEFAULT_SCHEDULING_SETTINGS, {
      businessDayStartTime: "08:10",
      businessDayEndTime: "17:40"
    })).toMatchObject({ businessDayStartTime: "08:10", businessDayEndTime: "17:40" });
  });

  it("normalizes database time values while retaining the server update timestamp", () => {
    expect(schedulingSettingsFromRow({
      id: 1,
      time_zone: "America/Chicago",
      default_arrival_window_minutes: 120,
      business_day_start_time: "07:30:00",
      business_day_end_time: "16:30:00",
      scheduling_increment_minutes: 30,
      updated_at: "2026-07-22T12:30:00.000Z",
      updated_by: null
    })).toEqual({
      timeZone: "America/Chicago",
      defaultArrivalWindowMinutes: 120,
      businessDayStartTime: "07:30",
      businessDayEndTime: "16:30",
      schedulingIncrementMinutes: 30,
      updatedAt: "2026-07-22T12:30:00.000Z"
    });
  });

  it("returns a fresh default object when a deployment has not seeded its row yet", () => {
    const settings = schedulingSettingsFromRow(null);
    expect(settings).toEqual(DEFAULT_SCHEDULING_SETTINGS);
    expect(settings).not.toBe(DEFAULT_SCHEDULING_SETTINGS);
  });

  it("uses a dedicated validation error for callers to map safely", () => {
    expect(() => validateSchedulingSettings([])).toThrow(SchedulingSettingsValidationError);
  });
});
