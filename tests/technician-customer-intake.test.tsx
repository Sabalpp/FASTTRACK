import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import NewCustomerPage from "@/app/customers/new/page";
import type { AllowedUser, Customer } from "@/lib/types";

const harness = vi.hoisted(() => ({
  replace: vi.fn(),
  createCustomer: vi.fn()
}));

const technician: AllowedUser = {
  id: "22222222-2222-2222-2222-222222222222",
  email: "tech@fasttrack.test",
  role: "tech",
  displayName: "Maya Tech",
  active: true,
  createdAt: "2026-06-01T00:00:00.000Z"
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: harness.replace }),
  useSearchParams: () => new URLSearchParams()
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ currentUser: technician })
}));

vi.mock("@/lib/data-store", () => ({
  useAppData: () => ({ createCustomer: harness.createCustomer })
}));

vi.mock("@/components/RoleGate", () => ({
  RoleGate: ({ children }: { children: React.ReactNode }) => <>{children}</>
}));

vi.mock("@/components/AddressAutocomplete", () => ({
  AddressAutocomplete: ({ value, onChange, required }: { value: string; onChange: (value: string) => void; required?: boolean }) => (
    <input required={required} value={value} onChange={(event) => onChange(event.target.value)} />
  )
}));

describe("restricted technician customer intake", () => {
  beforeEach(() => {
    harness.replace.mockReset();
    harness.createCustomer.mockReset();
    harness.createCustomer.mockImplementation(async (input: Omit<Customer, "id" | "phoneDigits" | "createdAt">) => ({
      ...input,
      id: "customer-new",
      phoneDigits: "7035551212",
      createdAt: "2026-07-21T21:00:00.000Z"
    }));
  });

  it("collects one private service request and ends on a safe handoff screen", async () => {
    render(<NewCustomerPage />);

    expect(screen.getByRole("heading", { level: 1, name: "Tell us how we can help" })).toBeTruthy();
    expect(screen.getByText("Private form")).toBeTruthy();
    expect(screen.getByLabelText("Describe the issue")).toBeTruthy();
    expect(screen.queryByText("Customers")).toBeNull();
    expect(screen.queryByText("Invoices")).toBeNull();

    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Jordan Lee" } });
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "7035551212" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "jordan@example.com" } });
    fireEvent.change(screen.getByLabelText("Street address"), { target: { value: "123 Main Street" } });
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Manassas" } });
    fireEvent.change(screen.getByLabelText("ZIP"), { target: { value: "20110" } });
    fireEvent.change(screen.getByLabelText("Describe the issue"), { target: { value: "Kitchen sink is leaking" } });
    fireEvent.change(screen.getByLabelText("Access note (optional)"), { target: { value: "Dog is friendly" } });
    fireEvent.click(screen.getByRole("button", { name: "Save my information" }));

    await waitFor(() => expect(harness.createCustomer).toHaveBeenCalledOnce());
    expect(harness.createCustomer).toHaveBeenCalledWith(expect.objectContaining({
      createdBy: technician.id,
      notes: "Service request: Kitchen sink is leaking\nAccess note: Dog is friendly"
    }));
    expect(await screen.findByRole("heading", { level: 1, name: "Thank you, Jordan." })).toBeTruthy();
    expect(screen.getByText("Please return this iPad to your technician.")).toBeTruthy();
    expect(harness.replace).not.toHaveBeenCalled();
  });
});
