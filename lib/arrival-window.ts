export const ARRIVAL_WINDOW_TIME_ZONE = "America/New_York";
export const STANDARD_ARRIVAL_WINDOW_MINUTES = 180;

export type ArrivalWindowDraft = {
  localDate: string;
  localStartTime: string;
  durationMinutes: number;
};

export type ArrivalWindowResolution =
  | { status: "incomplete" }
  | { status: "invalid"; error: string }
  | {
      status: "valid";
      startAt: string;
      endAt: string;
      durationMinutes: number;
    };

type LocalDateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

export function emptyArrivalWindowDraft(): ArrivalWindowDraft {
  return {
    localDate: "",
    localStartTime: "",
    durationMinutes: STANDARD_ARRIVAL_WINDOW_MINUTES
  };
}

export function resolveArrivalWindow(
  draft: ArrivalWindowDraft,
  timeZone = ARRIVAL_WINDOW_TIME_ZONE
): ArrivalWindowResolution {
  if (!draft.localDate || !draft.localStartTime) return { status: "incomplete" };
  if (!Number.isInteger(draft.durationMinutes) || draft.durationMinutes < 15 || draft.durationMinutes > 12 * 60) {
    return { status: "invalid", error: "The arrival-window length is invalid." };
  }

  const localParts = parseLocalDateTime(draft.localDate, draft.localStartTime);
  if (!localParts) return { status: "invalid", error: "Choose a valid date and start time." };

  const candidates = localDateTimeCandidates(localParts, timeZone);
  if (candidates instanceof Error) return { status: "invalid", error: candidates.message };
  if (candidates.length === 0) {
    return {
      status: "invalid",
      error: "That start time does not exist in Eastern time because of daylight saving time. Choose another time."
    };
  }
  if (candidates.length > 1) {
    return {
      status: "invalid",
      error: "That start time occurs twice in Eastern time because of daylight saving time. Choose another time."
    };
  }

  const startMs = candidates[0];
  const endMs = startMs + draft.durationMinutes * 60_000;
  return {
    status: "valid",
    startAt: new Date(startMs).toISOString(),
    endAt: new Date(endMs).toISOString(),
    durationMinutes: draft.durationMinutes
  };
}

export function arrivalWindowDraftFromRange(
  startAt: string | undefined,
  endAt: string | undefined,
  timeZone = ARRIVAL_WINDOW_TIME_ZONE
): ArrivalWindowDraft {
  if (!startAt) return emptyArrivalWindowDraft();
  const start = new Date(startAt);
  if (!Number.isFinite(start.getTime())) return emptyArrivalWindowDraft();

  let parts: LocalDateTimeParts;
  try {
    parts = zonedParts(start.getTime(), timeZone);
  } catch {
    return emptyArrivalWindowDraft();
  }

  const end = endAt ? new Date(endAt) : undefined;
  const durationMinutes = end && Number.isFinite(end.getTime()) && end.getTime() > start.getTime()
    ? Math.round((end.getTime() - start.getTime()) / 60_000)
    : STANDARD_ARRIVAL_WINDOW_MINUTES;

  return {
    localDate: `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`,
    localStartTime: `${pad(parts.hour)}:${pad(parts.minute)}`,
    durationMinutes
  };
}

export function formatArrivalWindowRange(
  startAt: string,
  endAt: string,
  timeZone = ARRIVAL_WINDOW_TIME_ZONE
): string {
  const start = new Date(startAt);
  const end = new Date(endAt);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end.getTime() <= start.getTime()) {
    return "Invalid arrival window";
  }

  const startParts = zonedParts(start.getTime(), timeZone);
  const endParts = zonedParts(end.getTime(), timeZone);
  const sameDay = startParts.year === endParts.year
    && startParts.month === endParts.month
    && startParts.day === endParts.day;
  const dateFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric"
  });
  const timeFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit"
  });

  if (sameDay) {
    return `${dateFormatter.format(start)} · ${timeFormatter.format(start)}–${timeFormatter.format(end)}`;
  }
  return `${dateFormatter.format(start)} at ${timeFormatter.format(start)} – ${dateFormatter.format(end)} at ${timeFormatter.format(end)}`;
}

export function formatArrivalWindowTimeZone(
  at: string,
  timeZone = ARRIVAL_WINDOW_TIME_ZONE
): string {
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) return "Eastern time";
  const zoneName = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "short"
  }).formatToParts(date).find((part) => part.type === "timeZoneName")?.value;
  if (timeZone === ARRIVAL_WINDOW_TIME_ZONE) return zoneName ? `Eastern time (${zoneName})` : "Eastern time";
  return zoneName ? `${timeZone} (${zoneName})` : timeZone;
}

export function formatArrivalWindowDuration(durationMinutes: number): string {
  const hours = Math.floor(durationMinutes / 60);
  const minutes = durationMinutes % 60;
  const hourPart = hours > 0 ? `${hours} ${hours === 1 ? "hour" : "hours"}` : "";
  const minutePart = minutes > 0 ? `${minutes} ${minutes === 1 ? "minute" : "minutes"}` : "";
  return [hourPart, minutePart].filter(Boolean).join(" ") || "0 minutes";
}

function parseLocalDateTime(localDate: string, localTime: string): LocalDateTimeParts | undefined {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(localTime);
  if (!dateMatch || !timeMatch) return undefined;

  const parts: LocalDateTimeParts = {
    year: Number(dateMatch[1]),
    month: Number(dateMatch[2]),
    day: Number(dateMatch[3]),
    hour: Number(timeMatch[1]),
    minute: Number(timeMatch[2])
  };
  if (parts.month < 1 || parts.month > 12 || parts.day < 1 || parts.day > 31 || parts.hour > 23 || parts.minute > 59) {
    return undefined;
  }
  const calendarCheck = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (calendarCheck.getUTCFullYear() !== parts.year
    || calendarCheck.getUTCMonth() + 1 !== parts.month
    || calendarCheck.getUTCDate() !== parts.day) {
    return undefined;
  }
  return parts;
}

function localDateTimeCandidates(parts: LocalDateTimeParts, timeZone: string): number[] | Error {
  const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  const offsets = new Set<number>();
  try {
    for (const hours of [-36, -24, -12, 0, 12, 24, 36]) {
      offsets.add(timeZoneOffsetMs(localAsUtc + hours * 60 * 60 * 1000, timeZone));
    }
  } catch {
    return new Error("The business timezone could not be loaded.");
  }

  const candidates = [...offsets]
    .map((offset) => localAsUtc - offset)
    .filter((candidate) => sameLocalDateTime(zonedParts(candidate, timeZone), parts));
  return [...new Set(candidates)].sort((left, right) => left - right);
}

function timeZoneOffsetMs(instantMs: number, timeZone: string): number {
  const parts = zonedParts(instantMs, timeZone, true);
  const representedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  const instantAtMinute = Math.floor(instantMs / 60_000) * 60_000;
  return representedAsUtc - instantAtMinute;
}

function zonedParts(instantMs: number, timeZone: string, omitSeconds = false): LocalDateTimeParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    ...(omitSeconds ? {} : { second: "2-digit" as const }),
    hourCycle: "h23"
  }).formatToParts(new Date(instantMs));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour) % 24,
    minute: Number(values.minute)
  };
}

function sameLocalDateTime(left: LocalDateTimeParts, right: LocalDateTimeParts): boolean {
  return left.year === right.year
    && left.month === right.month
    && left.day === right.day
    && left.hour === right.hour
    && left.minute === right.minute;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
