import { describe, expect, it } from "vitest";
import { canCreateCustomers, canEditCustomers, canScheduleJobs, canViewCustomer } from "@/lib/access";
import type { AllowedUser, Customer } from "@/lib/types";

describe("technician customer intake access", () => {
  it("allows creation without granting editing or scheduling", () => {
    expect(canCreateCustomers("tech")).toBe(true);
    expect(canEditCustomers("tech")).toBe(false);
    expect(canScheduleJobs("tech")).toBe(false);
  });

  it("lets a technician view only their own unassigned intake record", () => {
    const tech = user("tech-a");
    expect(canViewCustomer(tech, customer("tech-a"), [])).toBe(true);
    expect(canViewCustomer(tech, customer("tech-b"), [])).toBe(false);
  });
});

function user(id: string): AllowedUser {
  return { id, email: `${id}@example.com`, role: "tech", displayName: id, active: true, createdAt: "2026-07-21T00:00:00.000Z" };
}

function customer(createdBy: string): Customer {
  return {
    id: `customer-${createdBy}`,
    name: "Test Customer",
    phone: "(703) 555-0100",
    phoneDigits: "7035550100",
    emailNotificationsEnabled: true,
    smsConsentStatus: "unknown",
    addressLine1: "1 Main St",
    city: "Fairfax",
    state: "VA",
    zip: "22030",
    notes: "",
    createdAt: "2026-07-21T00:00:00.000Z",
    createdBy
  };
}
