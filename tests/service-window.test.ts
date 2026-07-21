import { describe, expect, it } from "vitest";
import {
  DEFAULT_SERVICE_WINDOW_MS,
  compareJobsForDispatch,
  defaultServiceWindowEndAt,
  findTechnicianWindowConflicts,
  getServiceWindowTiming,
  isValidServiceWindow
} from "@/lib/service-window";
import type { Job } from "@/lib/types";

const windowStart = "2026-07-20T13:00:00.000Z";
const windowEnd = "2026-07-20T16:00:00.000Z";

describe("service arrival windows", () => {
  it("defaults to a three-hour arrival window", () => {
    const end = defaultServiceWindowEndAt(windowStart);
    expect(Date.parse(end ?? "") - Date.parse(windowStart)).toBe(DEFAULT_SERVICE_WINDOW_MS);
    expect(isValidServiceWindow(windowStart, end)).toBe(true);
  });

  it("moves an unarrived job through upcoming, open, due-soon, and late states", () => {
    const scheduled = job();

    expect(getServiceWindowTiming(scheduled, Date.parse(windowStart) - 1)).toEqual({ label: "Upcoming", tone: "info" });
    expect(getServiceWindowTiming(scheduled, Date.parse(windowStart))).toEqual({ label: "Window open", tone: "good" });
    expect(getServiceWindowTiming(scheduled, Date.parse(windowEnd) - 30 * 60 * 1000)).toEqual({ label: "Due soon", tone: "warn" });
    expect(getServiceWindowTiming(scheduled, Date.parse(windowEnd) - 1)).toEqual({ label: "Due soon", tone: "warn" });
    expect(getServiceWindowTiming(scheduled, Date.parse(windowEnd))).toEqual({ label: "Late", tone: "bad" });
  });

  it("freezes the recorded arrival result across later clock changes", () => {
    const muchLater = Date.parse(windowEnd) + 24 * 60 * 60 * 1000;

    expect(getServiceWindowTiming(job({ arrivedAt: "2026-07-20T12:59:00.000Z", status: "complete" }), muchLater).label).toBe("Arrived early");
    expect(getServiceWindowTiming(job({ arrivedAt: windowStart, status: "complete" }), muchLater).label).toBe("Arrived on time");
    expect(getServiceWindowTiming(job({ arrivedAt: windowEnd, status: "complete" }), muchLater).label).toBe("Arrived on time");
    expect(getServiceWindowTiming(job({ arrivedAt: "2026-07-20T16:01:00.000Z", status: "complete" }), muchLater).label).toBe("Arrived late");
  });

  it("does not treat an in-progress legacy job without an arrival as on time", () => {
    expect(getServiceWindowTiming(job({ status: "in_progress" }), Date.parse(windowEnd) - 1)).toEqual({
      label: "Arrival unrecorded",
      tone: "warn"
    });
    expect(getServiceWindowTiming(job({ status: "in_progress" }), Date.parse(windowEnd))).toEqual({
      label: "Late · unrecorded",
      tone: "bad"
    });
  });

  it("detects active technician overlaps but permits touching windows and closed work", () => {
    const jobs = [
      job({ id: "existing", assignedTechId: "tech-1" }),
      job({ id: "cancelled", assignedTechId: "tech-1", status: "cancelled", scheduledAt: "2026-07-20T15:00:00.000Z", arrivalWindowEndAt: "2026-07-20T18:00:00.000Z" }),
      job({ id: "complete", assignedTechId: "tech-1", status: "complete", scheduledAt: "2026-07-20T15:00:00.000Z", arrivalWindowEndAt: "2026-07-20T18:00:00.000Z" })
    ];

    expect(findTechnicianWindowConflicts(jobs, {
      assignedTechId: "tech-1",
      scheduledAt: "2026-07-20T15:30:00.000Z",
      arrivalWindowEndAt: "2026-07-20T18:30:00.000Z"
    }).map((candidate) => candidate.id)).toEqual(["existing"]);

    expect(findTechnicianWindowConflicts(jobs, {
      assignedTechId: "tech-1",
      scheduledAt: windowEnd,
      arrivalWindowEndAt: "2026-07-20T19:00:00.000Z"
    })).toEqual([]);
  });

  it("sorts open work first in chronological dispatch order and closed work last", () => {
    const jobs = [
      job({ id: "closed", status: "complete", scheduledAt: "2026-07-19T13:00:00.000Z" }),
      job({ id: "later", scheduledAt: "2026-07-21T13:00:00.000Z", arrivalWindowEndAt: "2026-07-21T16:00:00.000Z" }),
      job({ id: "earlier" })
    ];

    expect(jobs.sort(compareJobsForDispatch).map((candidate) => candidate.id)).toEqual(["earlier", "later", "closed"]);
  });

  it("orders unresolved work by urgency and nearest deadline", () => {
    const now = Date.parse("2026-07-20T14:30:00.000Z");
    const jobs = [
      job({ id: "longer", scheduledAt: "2026-07-20T13:00:00.000Z", arrivalWindowEndAt: "2026-07-20T16:00:00.000Z" }),
      job({ id: "sooner", scheduledAt: "2026-07-20T14:00:00.000Z", arrivalWindowEndAt: "2026-07-20T15:30:00.000Z" }),
      job({ id: "resolved-late", scheduledAt: "2026-07-20T10:00:00.000Z", arrivalWindowEndAt: "2026-07-20T12:00:00.000Z", arrivedAt: "2026-07-20T12:10:00.000Z", status: "in_progress" }),
      job({ id: "unresolved-late", scheduledAt: "2026-07-20T10:00:00.000Z", arrivalWindowEndAt: "2026-07-20T12:00:00.000Z" })
    ];

    expect(jobs.sort((a, b) => compareJobsForDispatch(a, b, now)).map((candidate) => candidate.id)).toEqual([
      "unresolved-late",
      "sooner",
      "longer",
      "resolved-late"
    ]);
  });
});

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    customerId: "customer-1",
    assignedTechId: "tech-1",
    status: "scheduled",
    scheduledAt: windowStart,
    arrivalWindowEndAt: windowEnd,
    serviceAddress: "123 Main St",
    description: "Service call",
    notes: "",
    createdAt: "2026-07-19T12:00:00.000Z",
    ...overrides
  };
}
