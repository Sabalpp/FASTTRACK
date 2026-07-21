import type { Job, JobStatus } from "@/lib/types";

export const DEFAULT_SERVICE_WINDOW_HOURS = 3;
export const DEFAULT_SERVICE_WINDOW_MS = DEFAULT_SERVICE_WINDOW_HOURS * 60 * 60 * 1000;
export const SERVICE_WINDOW_WARNING_MS = 30 * 60 * 1000;

export type ServiceWindowTone = "neutral" | "good" | "warn" | "bad" | "info";

export type ServiceWindowTiming = {
  label: string;
  tone: ServiceWindowTone;
};

type WindowJob = Pick<Job, "scheduledAt" | "arrivalWindowEndAt" | "arrivedAt" | "status">;

export function defaultServiceWindowEndAt(scheduledAt: string | undefined): string | undefined {
  const start = parseDate(scheduledAt);
  if (!start) return undefined;
  return new Date(start.getTime() + DEFAULT_SERVICE_WINDOW_MS).toISOString();
}

export function getServiceWindowRange(
  scheduledAt: string | undefined,
  arrivalWindowEndAt?: string
): { start: Date; end: Date } | undefined {
  const start = parseDate(scheduledAt);
  if (!start) return undefined;

  const explicitEnd = parseDate(arrivalWindowEndAt);
  const end = explicitEnd && explicitEnd.getTime() > start.getTime()
    ? explicitEnd
    : new Date(start.getTime() + DEFAULT_SERVICE_WINDOW_MS);

  return { start, end };
}

export function isValidServiceWindow(scheduledAt: string | undefined, arrivalWindowEndAt: string | undefined): boolean {
  const start = parseDate(scheduledAt);
  const end = parseDate(arrivalWindowEndAt);
  return Boolean(start && end && end.getTime() > start.getTime());
}

export function formatServiceWindow(scheduledAt: string | undefined, arrivalWindowEndAt?: string): string {
  const range = getServiceWindowRange(scheduledAt, arrivalWindowEndAt);
  if (!range) return "Not scheduled";

  const startLabel = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(range.start);
  const sameDay = range.start.getFullYear() === range.end.getFullYear()
    && range.start.getMonth() === range.end.getMonth()
    && range.start.getDate() === range.end.getDate();
  const endLabel = new Intl.DateTimeFormat("en-US", sameDay
    ? { hour: "numeric", minute: "2-digit" }
    : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
  ).format(range.end);

  return `${startLabel} – ${endLabel}`;
}

export function getServiceWindowTiming(job: WindowJob, now: Date | number = Date.now()): ServiceWindowTiming {
  const range = getServiceWindowRange(job.scheduledAt, job.arrivalWindowEndAt);
  if (!range) return { label: "Not scheduled", tone: "neutral" };

  const arrivedAt = parseDate(job.arrivedAt);
  if (arrivedAt) {
    if (arrivedAt.getTime() < range.start.getTime()) return { label: "Arrived early", tone: "info" };
    if (arrivedAt.getTime() <= range.end.getTime()) return { label: "Arrived on time", tone: "good" };
    return { label: "Arrived late", tone: "bad" };
  }

  if (job.status === "cancelled") return { label: "Cancelled", tone: "neutral" };
  const nowMs = now instanceof Date ? now.getTime() : now;
  if (job.status === "complete") return { label: "No arrival record", tone: "neutral" };
  if (job.status === "in_progress") {
    return nowMs >= range.end.getTime()
      ? { label: "Late · unrecorded", tone: "bad" }
      : { label: "Arrival unrecorded", tone: "warn" };
  }

  if (nowMs < range.start.getTime()) return { label: "Upcoming", tone: "info" };
  if (nowMs >= range.end.getTime()) return { label: "Late", tone: "bad" };
  if (range.end.getTime() - nowMs <= SERVICE_WINDOW_WARNING_MS) return { label: "Due soon", tone: "warn" };
  return { label: "Window open", tone: "good" };
}

export function compareJobsForDispatch(a: WindowJob, b: WindowJob, now = Date.now()): number {
  const aClosed = isClosed(a.status);
  const bClosed = isClosed(b.status);
  if (aClosed !== bClosed) return aClosed ? 1 : -1;

  let activePriority = 0;
  if (!aClosed && !bClosed) {
    const aPriority = dispatchPriority(a, now);
    const bPriority = dispatchPriority(b, now);
    const priorityDifference = aPriority - bPriority;
    if (priorityDifference !== 0) return priorityDifference;
    activePriority = aPriority;
  }

  const aRange = getServiceWindowRange(a.scheduledAt, a.arrivalWindowEndAt);
  const bRange = getServiceWindowRange(b.scheduledAt, b.arrivalWindowEndAt);
  if (!aClosed && activePriority <= 2) {
    const aEnd = aRange?.end.getTime() ?? Number.NaN;
    const bEnd = bRange?.end.getTime() ?? Number.NaN;
    if (Number.isFinite(aEnd) && Number.isFinite(bEnd) && aEnd !== bEnd) return aEnd - bEnd;
  }
  const aTime = aRange?.start.getTime() ?? Number.NaN;
  const bTime = bRange?.start.getTime() ?? Number.NaN;
  if (!Number.isFinite(aTime)) return 1;
  if (!Number.isFinite(bTime)) return -1;
  return aClosed ? bTime - aTime : aTime - bTime;
}

export function findTechnicianWindowConflicts(
  jobs: Job[],
  input: {
    assignedTechId: string | undefined;
    scheduledAt: string | undefined;
    arrivalWindowEndAt: string | undefined;
    excludeJobId?: string;
  }
): Job[] {
  if (!input.assignedTechId) return [];
  const proposed = getServiceWindowRange(input.scheduledAt, input.arrivalWindowEndAt);
  if (!proposed) return [];

  return jobs.filter((job) => {
    if (job.id === input.excludeJobId || job.assignedTechId !== input.assignedTechId || isClosed(job.status)) return false;
    const existing = getServiceWindowRange(job.scheduledAt, job.arrivalWindowEndAt);
    if (!existing) return false;
    return proposed.start.getTime() < existing.end.getTime() && existing.start.getTime() < proposed.end.getTime();
  });
}

function isClosed(status: JobStatus): boolean {
  return status === "complete" || status === "cancelled";
}

function dispatchPriority(job: WindowJob, now: number): number {
  const timing = getServiceWindowTiming(job, now).label;
  if (timing === "Late" || timing === "Late · unrecorded") return 0;
  if (timing === "Due soon" || timing === "Arrival unrecorded") return 1;
  if (timing === "Window open") return 2;
  if (timing === "Arrived late" || timing === "Arrived on time" || timing === "Arrived early") return 3;
  return 4;
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : undefined;
}
