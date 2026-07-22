import type { SchedulingSettings } from "@/lib/scheduling-settings";

export type SequentialArrivalWindow = {
  startTime: string;
  endTime: string;
};

export function buildSequentialArrivalWindows(
  settings: Pick<SchedulingSettings, "businessDayStartTime" | "businessDayEndTime" | "defaultArrivalWindowMinutes">
): SequentialArrivalWindow[] {
  const startMinutes = clockMinutes(settings.businessDayStartTime);
  const endMinutes = clockMinutes(settings.businessDayEndTime);
  const durationMinutes = settings.defaultArrivalWindowMinutes;
  if (startMinutes === undefined
    || endMinutes === undefined
    || endMinutes <= startMinutes
    || !Number.isInteger(durationMinutes)
    || durationMinutes <= 0) return [];

  const windows: SequentialArrivalWindow[] = [];
  for (let windowStart = startMinutes; windowStart + durationMinutes <= endMinutes; windowStart += durationMinutes) {
    windows.push({
      startTime: formatClockValue(windowStart),
      endTime: formatClockValue(windowStart + durationMinutes)
    });
  }
  return windows;
}

export function formatClockLabel(value: string): string {
  const minutes = clockMinutes(value);
  if (minutes === undefined) return value;
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function clockMinutes(value: string): number | undefined {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return undefined;
  return hour * 60 + minute;
}

function formatClockValue(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
