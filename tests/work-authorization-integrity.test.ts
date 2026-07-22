import { describe, expect, it } from "vitest";
import {
  assertJobAuthorizationDocumentCurrent,
  assertJobCanAcceptAuthorization,
  jobAuthorizationDocumentHash,
  legacyJobAuthorizationDocumentHash
} from "@/lib/invoice-server";
import type { Job, JobLineItem, Tier } from "@/lib/types";

describe("customer work-authorization integrity", () => {
  it("allows authorization before arrival while rejecting closed jobs", () => {
    expect(() => assertJobCanAcceptAuthorization(job({ status: "scheduled", arrivedAt: undefined }))).not.toThrow();
    expect(() => assertJobCanAcceptAuthorization(job({ status: "in_progress", arrivedAt: undefined }))).not.toThrow();
    expect(() => assertJobCanAcceptAuthorization(job({ status: "complete" }))).toThrow(/closed/i);
    expect(() => assertJobCanAcceptAuthorization(job({ status: "cancelled" }))).toThrow(/closed/i);
  });

  it.each([
    ["selected option", (input: AuthorizationInput) => { input.selectedTier = "better"; }],
    ["job identity", (input: AuthorizationInput) => { input.job.id = "job-2"; }],
    ["customer identity", (input: AuthorizationInput) => { input.job.customerId = "customer-2"; }],
    ["service address", (input: AuthorizationInput) => { input.job.serviceAddress = "99 Changed Street"; }],
    ["service request", (input: AuthorizationInput) => { input.job.description = "Different requested work"; }],
    ["arrival window", (input: AuthorizationInput) => { input.job.arrivalWindowEndAt = "2026-07-21T18:30:00.000Z"; }],
    ["selected item identity", (input: AuthorizationInput) => { input.items[0].id = "line-changed"; }],
    ["selected item description", (input: AuthorizationInput) => { input.items[0].description = "Different repair"; }],
    ["selected item quantity", (input: AuthorizationInput) => { input.items[0].quantity = 3; }],
    ["selected item unit price", (input: AuthorizationInput) => { input.items[0].unitPrice = 180; }],
    ["selected item order", (input: AuthorizationInput) => { input.items[0].sortOrder = 9; }]
  ] as Array<[string, (input: AuthorizationInput) => void]>)
  ("invalidates authorization when %s changes", (_label, mutate) => {
    const original = authorizationInput();
    const changed = structuredClone(original);
    mutate(changed);

    expect(hash(changed)).not.toBe(hash(original));
  });

  it("keeps a pre-work authorization current when the technician later arrives", () => {
    const beforeArrival = authorizationInput();
    beforeArrival.job.arrivedAt = undefined;
    const afterArrival = structuredClone(beforeArrival);
    afterArrival.job.arrivedAt = "2026-07-21T14:10:00.000Z";

    expect(hash(afterArrival)).toBe(hash(beforeArrival));
  });

  it("accepts the legacy arrival-bound hash for already-signed records", () => {
    const input = authorizationInput();
    const legacyHash = legacyJobAuthorizationDocumentHash(input.job, input.items, input.selectedTier);

    expect(legacyHash).not.toBe(hash(input));
    expect(() => assertJobAuthorizationDocumentCurrent(
      legacyHash,
      input.job,
      input.items,
      input.selectedTier,
      "stale"
    )).not.toThrow();

    const changed = structuredClone(input);
    changed.job.serviceAddress = "99 Changed Street";
    expect(() => assertJobAuthorizationDocumentCurrent(
      legacyHash,
      changed.job,
      changed.items,
      changed.selectedTier,
      "stale"
    )).toThrow(/stale/i);
  });

  it("does not invalidate the chosen scope when an unselected alternative changes", () => {
    const original = authorizationInput();
    const changed = structuredClone(original);
    changed.items.find((item) => item.tier === "better")!.unitPrice = 9999;
    changed.items.find((item) => item.tier === "better")!.description = "Unselected premium alternative";

    expect(hash(changed)).toBe(hash(original));
  });

  it("canonicalizes selected items by saved sort order", () => {
    const original = authorizationInput();
    const reorderedArray = structuredClone(original);
    reorderedArray.items.reverse();

    expect(hash(reorderedArray)).toBe(hash(original));
  });

  it("binds the exact branded tax rate and derived subtotal, tax, and total", () => {
    const input = authorizationInput();
    const branded = jobAuthorizationDocumentHash(input.job, input.items, input.selectedTier, 0.06);

    expect(jobAuthorizationDocumentHash(input.job, input.items, input.selectedTier, 0.07)).not.toBe(branded);

    const changedPrice = structuredClone(input);
    changedPrice.items[0].unitPrice += 0.01;
    expect(hash(changedPrice)).not.toBe(branded);
  });
});

type AuthorizationInput = {
  job: Job;
  items: JobLineItem[];
  selectedTier: Tier;
};

function authorizationInput(): AuthorizationInput {
  return {
    job: job(),
    selectedTier: "standard",
    items: [
      item("line-2", "Permit and disposal", "standard", 1, 50, 2),
      item("line-1", "Custom isolation repair", "standard", 2, 125, 1),
      item("line-3", "Premium alternative", "better", 1, 425, 1)
    ]
  };
}

function hash(input: AuthorizationInput): string {
  return jobAuthorizationDocumentHash(input.job, input.items, input.selectedTier);
}

function job(patch: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    customerId: "customer-1",
    assignedTechId: "tech-1",
    status: "in_progress",
    scheduledAt: "2026-07-21T13:00:00.000Z",
    arrivalWindowEndAt: "2026-07-21T16:00:00.000Z",
    arrivedAt: "2026-07-21T14:05:00.000Z",
    serviceAddress: "1 Main Street, Centreville, VA 20120",
    description: "Repair leaking supply line",
    notes: "Internal diagnosis not shown in authorization.",
    createdAt: "2026-07-20T12:00:00.000Z",
    ...patch
  };
}

function item(
  id: string,
  description: string,
  tier: Tier,
  quantity: number,
  unitPrice: number,
  sortOrder: number
): JobLineItem {
  return { id, jobId: "job-1", description, tier, quantity, unitPrice, sortOrder, isManual: true };
}
