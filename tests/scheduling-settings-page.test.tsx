import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SchedulingSettingsPage from "@/app/settings/scheduling/page";
import { DEFAULT_SCHEDULING_SETTINGS } from "@/lib/scheduling-settings";

const harness = vi.hoisted(() => ({
  load: vi.fn(),
  update: vi.fn()
}));

vi.mock("@/components/RoleGate", () => ({
  RoleGate: ({ children }: { children: React.ReactNode }) => <>{children}</>
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    currentUser: { id: "owner", email: "owner@example.com", role: "owner", displayName: "Owner", active: true }
  })
}));

vi.mock("@/lib/scheduling-settings-client", () => ({
  loadSchedulingSettings: harness.load,
  updateSchedulingSettings: harness.update
}));

describe("owner scheduling settings page", () => {
  beforeEach(() => {
    harness.load.mockReset();
    harness.update.mockReset();
    harness.load.mockResolvedValue({ ...DEFAULT_SCHEDULING_SETTINGS });
    harness.update.mockImplementation(async (patch) => ({
      ...DEFAULT_SCHEDULING_SETTINGS,
      ...patch,
      updatedAt: "2026-07-22T20:00:00.000Z"
    }));
  });

  it("uses native business-hour controls and previews three sequential default windows", async () => {
    render(<SchedulingSettingsPage />);

    const start = await screen.findByLabelText("Business day starts");
    const end = screen.getByLabelText("Business day ends");
    expect(start).toHaveProperty("type", "time");
    expect(end).toHaveProperty("type", "time");
    expect(start).toHaveProperty("value", "08:00");
    expect(end).toHaveProperty("value", "17:00");
    expect(screen.getByText("3 complete windows at 3 hours each.")).toBeTruthy();
    expect(screen.getByText("8:00 AM–11:00 AM")).toBeTruthy();
    expect(screen.getByText("2:00 PM–5:00 PM")).toBeTruthy();
  });

  it("validates, previews, and saves owner changes", async () => {
    render(<SchedulingSettingsPage />);
    const duration = await screen.findByLabelText(/Default arrival-window length/);

    fireEvent.change(duration, { target: { value: "120" } });
    expect(screen.getByText("4 complete windows at 2 hours each.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save scheduling defaults" }));

    await waitFor(() => expect(harness.update).toHaveBeenCalledOnce());
    expect(harness.update).toHaveBeenCalledWith({
      defaultArrivalWindowMinutes: 120,
      businessDayStartTime: "08:00",
      businessDayEndTime: "17:00",
      schedulingIncrementMinutes: 15
    }, "owner");
    expect(await screen.findByText("Scheduling defaults saved. New jobs will use them automatically.")).toBeTruthy();
  });

  it("blocks an end time that is not later than the business-day start", async () => {
    render(<SchedulingSettingsPage />);
    const end = await screen.findByLabelText("Business day ends");

    fireEvent.change(end, { target: { value: "07:30" } });
    expect(screen.getByText("Business-day end time must be later than its start time.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save scheduling defaults" })).toHaveProperty("disabled", true);
  });
});
