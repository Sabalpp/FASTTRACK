import { describe, expect, it } from "vitest";
import {
  arrivalWindowDurationFromTimes,
  arrivalWindowDraftFromRange,
  arrivalWindowEndTime,
  formatArrivalWindowRange,
  formatArrivalWindowTimeZone,
  resolveArrivalWindow
} from "@/lib/arrival-window";

describe("arrival-window timezone contract", () => {
  it("derives editable end controls from the compatible duration draft", () => {
    expect(arrivalWindowEndTime({
      localDate: "2026-07-21",
      localStartTime: "23:00",
      durationMinutes: 180
    })).toBe("02:00");
    expect(arrivalWindowDurationFromTimes("23:00", "02:00")).toBe(180);
    expect(arrivalWindowDurationFromTimes("09:00", "09:00")).toBe(24 * 60);
    expect(arrivalWindowDurationFromTimes("", "12:00")).toBeUndefined();
  });

  it("interprets summer input in America/New_York and derives a fixed 180-minute UTC range", () => {
    const result = resolveArrivalWindow({
      localDate: "2026-07-21",
      localStartTime: "16:30",
      durationMinutes: 180
    });

    expect(result).toEqual({
      status: "valid",
      startAt: "2026-07-21T20:30:00.000Z",
      endAt: "2026-07-21T23:30:00.000Z",
      durationMinutes: 180
    });
  });

  it("uses the Eastern standard-time offset in winter", () => {
    expect(resolveArrivalWindow({
      localDate: "2026-01-21",
      localStartTime: "09:00",
      durationMinutes: 180
    })).toMatchObject({
      status: "valid",
      startAt: "2026-01-21T14:00:00.000Z",
      endAt: "2026-01-21T17:00:00.000Z"
    });
  });

  it("rejects nonexistent and ambiguous daylight-saving start times", () => {
    expect(resolveArrivalWindow({
      localDate: "2026-03-08",
      localStartTime: "02:30",
      durationMinutes: 180
    })).toEqual({
      status: "invalid",
      error: "That start time does not exist in Eastern time because of daylight saving time. Choose another time."
    });

    expect(resolveArrivalWindow({
      localDate: "2026-11-01",
      localStartTime: "01:30",
      durationMinutes: 180
    })).toEqual({
      status: "invalid",
      error: "That start time occurs twice in Eastern time because of daylight saving time. Choose another time."
    });
  });

  it("formats and restores ranges in Eastern time without using the device timezone", () => {
    expect(formatArrivalWindowRange(
      "2026-07-21T20:30:00.000Z",
      "2026-07-21T23:30:00.000Z"
    )).toBe("Tue, Jul 21 · 4:30 PM–7:30 PM");
    expect(formatArrivalWindowTimeZone("2026-07-21T20:30:00.000Z")).toBe("Eastern time (EDT)");
    expect(arrivalWindowDraftFromRange(
      "2026-07-21T20:30:00.000Z",
      "2026-07-21T22:30:00.000Z"
    )).toEqual({
      localDate: "2026-07-21",
      localStartTime: "16:30",
      durationMinutes: 120
    });
  });
});
