import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CustomersPage from "@/app/customers/page";
import CustomerDetailPage from "@/app/customers/[id]/page";
import type { AllowedUser, Customer, Job } from "@/lib/types";

const owner: AllowedUser = {
  id: "owner-1",
  email: "owner@fasttrack.test",
  role: "owner",
  displayName: "Jordan",
  active: true,
  createdAt: "2026-01-01T00:00:00.000Z"
};

const customer: Customer = {
  id: "customer-1",
  name: "Alex Rivera",
  phone: "7035551212",
  phoneDigits: "7035551212",
  email: "alex@example.com",
  emailNotificationsEnabled: true,
  smsConsentStatus: "opted_in",
  smsConsentAt: "2026-07-20T12:00:00.000Z",
  smsConsentSource: "staff_recorded",
  addressLine1: "123 Main Street",
  addressLine2: "Unit 4",
  city: "Manassas",
  state: "VA",
  zip: "20110",
  notes: "Gate code is 1234",
  createdAt: "2026-07-20T12:00:00.000Z",
  createdBy: owner.id
};

const job: Job = {
  id: "job-1",
  customerId: customer.id,
  assignedTechId: null,
  status: "scheduled",
  scheduledAt: "2026-07-22T13:00:00.000Z",
  arrivalWindowEndAt: "2026-07-22T16:00:00.000Z",
  serviceAddress: "123 Main Street, Manassas, VA 20110",
  description: "Kitchen sink leak",
  notes: "",
  createdAt: "2026-07-20T12:00:00.000Z"
};

const harness = vi.hoisted(() => ({
  customers: [] as Customer[],
  jobs: [] as Job[],
  searchCustomers: vi.fn(),
  updateCustomer: vi.fn()
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "customer-1" })
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  )
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ currentUser: owner })
}));

vi.mock("@/lib/data-store", () => ({
  useAppData: () => ({
    customers: harness.customers,
    jobs: harness.jobs,
    searchCustomers: harness.searchCustomers,
    updateCustomer: harness.updateCustomer
  })
}));

vi.mock("@/lib/use-current-time", () => ({
  useCurrentTime: () => Date.parse("2026-07-21T12:00:00.000Z")
}));

vi.mock("@/components/AddressAutocomplete", () => ({
  AddressAutocomplete: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <input value={value} onChange={(event) => onChange(event.target.value)} />
  )
}));

describe("customer surface clutter reduction", () => {
  beforeEach(() => {
    harness.customers = [customer];
    harness.jobs = [job];
    harness.searchCustomers.mockReset();
    harness.updateCustomer.mockReset();
    harness.searchCustomers.mockResolvedValue([customer]);
    harness.updateCustomer.mockResolvedValue(undefined);
  });

  it("uses one populated-list action and one useful job fact per customer", async () => {
    render(<CustomersPage />);

    expect(await screen.findByText("Alex Rivera")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Create customer" })).toHaveLength(1);
    expect(screen.queryByRole("link", { name: "Schedule service" })).toBeNull();
    expect(screen.queryByText("Customer first")).toBeNull();
    expect(screen.getByText(/Next visit/)).toBeTruthy();
  });

  it("keeps the empty-state create action contextual", async () => {
    harness.customers = [];
    harness.jobs = [];
    render(<CustomersPage />);

    await waitFor(() => expect(screen.getByText("No customers yet")).toBeTruthy());
    expect(screen.getAllByRole("link", { name: "Create customer" })).toHaveLength(2);
  });

  it("shows a concise customer summary before revealing editable and consent fields", () => {
    render(<CustomerDetailPage />);

    expect(screen.getAllByRole("link", { name: "Schedule service" })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Call Alex Rivera" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Text Alex Rivera" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Email Alex Rivera" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open map for Alex Rivera" })).toBeTruthy();
    expect(screen.queryByLabelText("Notes")).toBeNull();
    expect(screen.queryByText(/Reply STOP to opt out/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Notes")).toBeTruthy();
    expect(screen.getByText(/Reply STOP to opt out/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Notes")).toBeNull();
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
  });
});
