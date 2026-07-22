import { describe, expect, it } from "vitest";
import { buildSequentialArrivalWindows, formatClockLabel } from "@/lib/scheduling-preview";

describe("scheduling preview", () => {
  it("builds non-overlapping default windows without treating picker increments as windows", () => {
    expect(buildSequentialArrivalWindows({
      businessDayStartTime: "08:00",
      businessDayEndTime: "17:00",
      defaultArrivalWindowMinutes: 180
    })).toEqual([
      { startTime: "08:00", endTime: "11:00" },
      { startTime: "11:00", endTime: "14:00" },
      { startTime: "14:00", endTime: "17:00" }
    ]);
  });

  it("keeps only complete windows and formats clock labels", () => {
    expect(buildSequentialArrivalWindows({
      businessDayStartTime: "08:30",
      businessDayEndTime: "17:00",
      defaultArrivalWindowMinutes: 120
    })).toHaveLength(4);
    expect(formatClockLabel("08:30")).toBe("8:30 AM");
    expect(formatClockLabel("14:00")).toBe("2:00 PM");
  });
});
