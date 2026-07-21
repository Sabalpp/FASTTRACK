import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DashboardPage from "@/app/dashboard/page";
import JobDetailPage from "@/app/jobs/[id]/page";
import { demoState } from "@/lib/demo-data";
import type { AllowedUser, AppState } from "@/lib/types";

const harness = vi.hoisted(() => ({
  currentUser: undefined as AllowedUser | undefined,
  data: undefined as ReturnType<typeof buildData> | undefined,
  jobId: "job-aaaaaaaa-0001-4000-8000-000000000001",
  push: vi.fn()
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: harness.jobId }),
  useRouter: () => ({ push: harness.push, replace: vi.fn(), refresh: vi.fn() })
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ currentUser: harness.currentUser })
}));

vi.mock("@/lib/data-store", () => ({
  useAppData: () => harness.data,
  roleLabels: {
    owner: "Owner",
    tech: "Field technician",
    call_center: "Call center"
  },
  tierLabels: { good: "Good", better: "Better", best: "Best" },
  tierOptions: ["good", "better", "best"],
  unitOptions: ["each", "hour", "lb", "visit", "other"],
  photoKinds: ["before", "after", "other"]
}));

vi.mock("@/lib/use-current-time", () => ({
  useCurrentTime: () => Date.parse("2026-07-21T16:00:00.000Z")
}));

vi.mock("@/lib/runtime", () => ({
  demoMode: true
}));

vi.mock("@/components/OperationsChart", () => ({
  OperationsChart: () => <div data-testid="operations-chart">Operations chart</div>
}));

vi.mock("@/components/AddressAutocomplete", () => ({
  AddressAutocomplete: ({ value, disabled }: { value: string; disabled?: boolean }) => (
    <input aria-label="Service address" value={value} disabled={disabled} readOnly />
  )
}));

vi.mock("@/components/PhotoUploader", () => ({
  PhotoUploader: () => <div>Photo uploader</div>
}));

vi.mock("@/components/LineItemForm", () => ({
  LineItemForm: () => <div>Line item form</div>
}));

vi.mock("@/components/TierColumns", () => ({
  TierColumns: () => <div>Estimate options</div>
}));

vi.mock("@/components/SignatureDialog", () => ({
  SignatureDialog: () => null
}));

vi.mock("@/components/SignatureStatusCard", () => ({
  SignatureStatusCard: () => <div>Signature status</div>
}));

vi.mock("@/components/AppointmentConfirmationCard", () => ({
  AppointmentConfirmationCard: () => <div>Appointment confirmation</div>
}));

vi.mock("@/lib/appointment-confirmations-client", () => ({
  dispatchJobConfirmations: vi.fn(async () => ({ notifications: [] })),
  fetchJobConfirmations: vi.fn(async () => ({ notifications: [] }))
}));

vi.mock("@/lib/invoices-client", () => ({
  completeProtectedJob: vi.fn(),
  createProtectedInvoiceDraft: vi.fn()
}));

vi.mock("@/lib/signatures-client", () => ({
  loadSignatures: vi.fn(() => new Promise(() => undefined)),
  rejectSignature: vi.fn(),
  saveSignature: vi.fn()
}));

describe("technician workflow acceptance", () => {
  beforeEach(() => {
    harness.currentUser = techUser();
    harness.data = buildData();
    harness.jobId = "job-aaaaaaaa-0001-4000-8000-000000000001";
    harness.push.mockReset();
  });

  it("turns Tech Home into a today-first route instead of an owner analytics dashboard", () => {
    render(<DashboardPage />);

    expect(screen.getByRole("heading", { level: 1, name: "Today’s work" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Current job" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Up next" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "New customer" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open current job" })).toBeTruthy();

    expect(screen.queryByRole("heading", { name: "Workload" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Invoice tasks" })).toBeNull();
    expect(screen.queryByTestId("operations-chart")).toBeNull();
    expect(screen.queryByText("Assigned worker", { exact: true })).toBeNull();
  });

  it("shows a scheduled job as a read-only field brief with one obvious en-route action", async () => {
    harness.jobId = "job-bbbbbbbb-0002-4000-8000-000000000002";
    const { container } = render(<JobDetailPage />);

    const title = screen.getByRole("heading", {
      level: 1,
      name: "Water heater not heating consistently."
    });
    expect(title.nextElementSibling?.textContent).toContain("Alicia Nguyen");

    expect(screen.getByRole("link", { name: "Call" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Text" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Directions" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit dispatch" })).toBeNull();

    expect(container.querySelectorAll('input[type="datetime-local"]')).toHaveLength(0);
    expect(container.querySelectorAll("select")).toHaveLength(0);
    expect(screen.queryByText("Job status", { exact: true })).toBeNull();

    const nextAction = screen.getByRole("complementary", { name: "Next job action" });
    expect(within(nextAction).getAllByRole("button")).toHaveLength(1);
    const onMyWay = within(nextAction).getByRole("button", { name: "On my way" });
    expect(Array.from(container.querySelectorAll("button:disabled, input:disabled, select:disabled, textarea:disabled"))).toHaveLength(0);
    fireEvent.click(onMyWay);
    await waitFor(() => {
      expect(harness.data?.markJobEnRoute).toHaveBeenCalledWith(harness.jobId);
      expect(onMyWay.hasAttribute("disabled")).toBe(false);
    });

    await waitFor(() => expect(screen.getByRole("tabpanel")).toBeTruthy());
  });

  it("changes the one scheduled-job action to arrival after the technician is en route", () => {
    harness.jobId = "job-bbbbbbbb-0002-4000-8000-000000000002";
    const scheduledJob = harness.data?.jobs.find((job) => job.id === harness.jobId);
    if (!scheduledJob) throw new Error("Scheduled demo job is required for workflow tests.");
    scheduledJob.enRouteAt = "2026-07-21T20:00:00.000Z";

    render(<JobDetailPage />);

    const nextAction = screen.getByRole("complementary", { name: "Next job action" });
    expect(within(nextAction).getAllByRole("button")).toHaveLength(1);
    expect(within(nextAction).getByRole("button", { name: "Arrived — start job" })).toBeTruthy();
    expect(within(nextAction).queryByRole("button", { name: "On my way" })).toBeNull();
  });

  it("gives an arrived technician one continuation action without dispatch controls", async () => {
    const { container } = render(<JobDetailPage />);

    const nextAction = screen.getByRole("complementary", { name: "Next job action" });
    expect(within(nextAction).getAllByRole("button")).toHaveLength(1);
    expect(within(nextAction).getByRole("button", { name: "Continue to photos" })).toBeTruthy();

    const overview = screen.getByRole("tabpanel");
    expect(within(overview).queryByText("Window starts", { exact: true })).toBeNull();
    expect(within(overview).queryByText("Window ends", { exact: true })).toBeNull();
    expect(within(overview).queryByText("Assigned technician", { exact: true })).toBeNull();
    expect(container.querySelectorAll('input[type="datetime-local"], select')).toHaveLength(0);

    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toBeTruthy());
  });

  it.each([
    { status: "cancelled" as const, label: "Back to schedule" },
    { status: "complete" as const, label: "Continue to invoice" }
  ])("keeps exactly one primary action for a $status job", ({ status, label }) => {
    harness.jobId = "job-bbbbbbbb-0002-4000-8000-000000000002";
    const job = harness.data?.jobs.find((candidate) => candidate.id === harness.jobId);
    if (!job) throw new Error("Scheduled demo job is required for workflow tests.");
    job.status = status;
    if (status === "complete") {
      job.enRouteAt = "2026-07-21T20:00:00.000Z";
      job.arrivedAt = "2026-07-21T20:15:00.000Z";
      job.completedAt = "2026-07-21T21:15:00.000Z";
    }

    render(<JobDetailPage />);

    const nextAction = screen.getByRole("complementary", { name: "Next job action" });
    expect(within(nextAction).getAllByRole("button")).toHaveLength(1);
    expect(within(nextAction).getByRole("button", { name: label })).toBeTruthy();
  });

  it("keeps call-center dispatch editing out of the technician workflow", () => {
    harness.currentUser = callCenterUser();
    harness.jobId = "job-bbbbbbbb-0002-4000-8000-000000000002";

    render(<JobDetailPage />);

    expect(screen.getAllByRole("tab")).toHaveLength(1);
    expect(screen.getByRole("tab", { name: "Overview" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit dispatch" })).toBeTruthy();
    expect(screen.queryByRole("complementary", { name: "Next job action" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Photos" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Invoice" })).toBeNull();
  });
});

function techUser(): AllowedUser {
  const user = demoState.allowedUsers.find((candidate) => candidate.role === "tech");
  if (!user) throw new Error("Demo technician is required for workflow tests.");
  return user;
}

function callCenterUser(): AllowedUser {
  const user = demoState.allowedUsers.find((candidate) => candidate.role === "call_center");
  if (!user) throw new Error("Demo call-center user is required for workflow tests.");
  return user;
}

function buildData() {
  const state = JSON.parse(JSON.stringify(demoState)) as AppState;
  return {
    ...state,
    loaded: true,
    lastError: undefined,
    loadError: undefined,
    retryLoad: vi.fn(),
    setState: vi.fn(),
    resetDemoData: vi.fn(),
    searchCustomers: vi.fn(async () => []),
    createCustomer: vi.fn(),
    updateCustomer: vi.fn(),
    createJob: vi.fn(),
    updateJob: vi.fn(async () => undefined),
    markJobEnRoute: vi.fn(async () => undefined),
    markJobArrived: vi.fn(async () => undefined),
    addPhoto: vi.fn(),
    addLineItem: vi.fn(),
    updateLineItem: vi.fn(),
    deleteLineItem: vi.fn(),
    createPart: vi.fn(),
    createOrUpdateInvoiceDraft: vi.fn(),
    updateInvoice: vi.fn(),
    sendInvoice: vi.fn(),
    createAllowedUser: vi.fn(),
    updateAllowedUser: vi.fn()
  };
}
