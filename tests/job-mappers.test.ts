import { describe, expect, it } from "vitest";
import { jobFromRow, jobPatchToRow, jobToRow } from "@/lib/supabase-mappers";

describe("job persistence mapping", () => {
  it("persists an explicit unassignment as SQL null", () => {
    expect(jobPatchToRow({ assignedTechId: null })).toEqual({ assigned_tech_id: null });
    expect(jobPatchToRow({ completedAt: null })).toEqual({ completed_at: null });
  });

  it("does not allow the generic patch path to forge or clear arrival time", () => {
    expect(jobPatchToRow({ arrivedAt: "2026-07-20T13:00:00.000Z" })).toEqual({});
    expect(jobPatchToRow({ arrivedAt: undefined })).toEqual({});
  });

  it("does not accept an arrival timestamp during job creation", () => {
    expect(jobToRow({
      id: "job-1",
      customerId: "customer-1",
      assignedTechId: "tech-1",
      status: "scheduled",
      scheduledAt: "2026-07-20T13:00:00.000Z",
      arrivalWindowEndAt: "2026-07-20T16:00:00.000Z",
      arrivedAt: "2026-07-20T12:00:00.000Z",
      serviceAddress: "123 Main St",
      description: "Service call",
      notes: "",
      createdAt: "2026-07-19T13:00:00.000Z"
    })).not.toHaveProperty("arrived_at");
  });

  it("normalizes a legacy database job to a three-hour display window", () => {
    const mapped = jobFromRow({
      id: "job-1",
      customer_id: "customer-1",
      assigned_tech_id: null,
      status: "scheduled",
      scheduled_at: "2026-07-20T13:00:00.000Z",
      service_address: "123 Main St",
      description: "Service call",
      notes: "",
      originating_call_id: null,
      created_at: "2026-07-19T13:00:00.000Z",
      completed_at: null
    });

    expect(mapped.arrivalWindowEndAt).toBe("2026-07-20T16:00:00.000Z");
  });
});
