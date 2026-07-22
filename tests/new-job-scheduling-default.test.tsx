import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import NewJobPage from "@/app/jobs/new/page";
import { DEFAULT_SCHEDULING_SETTINGS } from "@/lib/scheduling-settings";

const harness = vi.hoisted(() => ({
  loadSettings: vi.fn()
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams()
}));

vi.mock("@/components/RoleGate", () => ({
  RoleGate: ({ children }: { children: React.ReactNode }) => <>{children}</>
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    currentUser: { id: "owner", email: "owner@example.com", role: "owner", displayName: "Owner", active: true }
  })
}));

vi.mock("@/lib/data-store", () => ({
  useAppData: () => ({
    customers: [],
    allowedUsers: [],
    jobs: [],
    createJob: vi.fn()
  })
}));

vi.mock("@/components/CustomerPicker", () => ({
  CustomerPicker: () => <div>Customer picker</div>
}));

vi.mock("@/components/AddressAutocomplete", () => ({
  AddressAutocomplete: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <input value={value} onChange={(event) => onChange(event.target.value)} />
  )
}));

vi.mock("@/lib/scheduling-settings-client", () => ({
  loadSchedulingSettings: harness.loadSettings
}));

describe("new-job scheduling defaults", () => {
  beforeEach(() => {
    harness.loadSettings.mockReset();
    harness.loadSettings.mockResolvedValue({
      ...DEFAULT_SCHEDULING_SETTINGS,
      defaultArrivalWindowMinutes: 240,
      schedulingIncrementMinutes: 30
    });
  });

  it("applies the effective owner duration and picker increment to untouched new jobs", async () => {
    render(<NewJobPage />);

    await waitFor(() => expect(harness.loadSettings).toHaveBeenCalledOnce());
    const date = screen.getByLabelText("Date");
    const start = screen.getByLabelText("Starts at");
    const end = screen.getByLabelText("Ends at");
    fireEvent.change(date, { target: { value: "2026-07-23" } });
    fireEvent.change(start, { target: { value: "09:00" } });

    expect(start).toHaveProperty("step", "1800");
    expect(end).toHaveProperty("step", "1800");
    expect(end).toHaveProperty("value", "13:00");
    expect(screen.getByText("Eastern time (EDT) · 4 hours")).toBeTruthy();
  });
});
