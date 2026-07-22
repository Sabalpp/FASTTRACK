import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import JobDetailPage from "@/app/jobs/[id]/page";
import { demoState } from "@/lib/demo-data";
import type {
  AllowedUser,
  AppState,
  Invoice,
  InvoiceSignature,
  JobPhoto,
  SignaturePurpose,
  Tier
} from "@/lib/types";

const harness = vi.hoisted(() => ({
  currentUser: undefined as AllowedUser | undefined,
  data: undefined as ReturnType<typeof buildData> | undefined,
  signatures: [] as InvoiceSignature[],
  jobId: "job-aaaaaaaa-0001-4000-8000-000000000001",
  push: vi.fn(),
  loadSignatures: vi.fn(),
  saveSignature: vi.fn(),
  rejectSignature: vi.fn()
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: harness.jobId }),
  useRouter: () => ({ push: harness.push, replace: vi.fn(), refresh: vi.fn() })
}));

vi.mock("@/lib/auth", () => ({ useAuth: () => ({ currentUser: harness.currentUser }) }));

vi.mock("@/lib/data-store", () => ({
  useAppData: () => harness.data,
  roleLabels: { owner: "Owner", tech: "Field technician", call_center: "Call center" },
  tierLabels: { standard: "Standard", good: "Good", better: "Better", best: "Best" },
  tierOptions: ["standard", "good", "better", "best"],
  unitOptions: ["each", "hour", "lb", "visit", "other"],
  photoKinds: ["before", "after", "other"]
}));

vi.mock("@/lib/use-current-time", () => ({
  useCurrentTime: () => Date.parse("2026-07-21T16:00:00.000Z")
}));

vi.mock("@/lib/runtime", () => ({ demoMode: true }));

vi.mock("@/components/AddressAutocomplete", () => ({
  AddressAutocomplete: ({ value }: { value: string }) => <input aria-label="Service address" value={value} readOnly />
}));

vi.mock("@/components/PhotoUploader", () => ({
  PhotoUploader: ({ lockedKind, checkpointLocked }: { lockedKind?: string; checkpointLocked?: boolean }) => (
    <div data-testid={`photo-uploader-${lockedKind}`} data-locked={checkpointLocked ? "true" : "false"}>
      <span>Photo uploader: {lockedKind}</span>
    </div>
  )
}));

vi.mock("@/components/LineItemForm", () => ({
  LineItemForm: () => <div>Technician line item editor</div>
}));

vi.mock("@/components/TierColumns", () => ({
  TierColumns: () => <div>Estimate option editor</div>
}));

vi.mock("@/components/SignatureStatusCard", () => ({
  SignatureStatusCard: ({
    title,
    signature,
    drawLabel,
    onDraw,
    drawDisabled,
    canReject,
    onReject
  }: {
    title: string;
    signature?: InvoiceSignature;
    drawLabel: string;
    onDraw: () => void;
    drawDisabled?: boolean;
    canReject?: boolean;
    onReject?: (reason: string) => Promise<void>;
  }) => (
    <section aria-label={title}>
      <span>{signature ? "Signed" : "Not signed"}</span>
      <button type="button" onClick={onDraw} disabled={drawDisabled}>{drawLabel}</button>
      {canReject && onReject ? <button type="button" onClick={() => void onReject("Customer requested a revised scope")}>Reject authorization</button> : null}
    </section>
  )
}));

vi.mock("@/components/SignatureDialog", () => ({
  SignatureDialog: ({
    open,
    title,
    onSave
  }: {
    open: boolean;
    title: string;
    onSave: (input: { signerName: string; signerRole: "customer"; image: Blob; width: number; height: number }) => Promise<void>;
  }) => open ? (
    <div role="dialog" aria-label={title}>
      <button type="button" onClick={() => void onSave({
        signerName: "John Smith",
        signerRole: "customer",
        image: new Blob(["signature"], { type: "image/png" }),
        width: 1200,
        height: 400
      })}>Save test signature</button>
    </div>
  ) : null
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
  loadSignatures: (...input: unknown[]) => harness.loadSignatures(...input),
  saveSignature: (input: unknown) => harness.saveSignature(input),
  rejectSignature: (...input: unknown[]) => harness.rejectSignature(...input)
}));

describe("two-signature technician job flow", () => {
  beforeEach(() => {
    harness.currentUser = techUser();
    harness.data = buildData();
    harness.signatures = [];
    harness.push.mockReset();
    harness.loadSignatures.mockReset();
    harness.loadSignatures.mockImplementation(async () => harness.signatures);
    harness.saveSignature.mockReset();
    harness.saveSignature.mockImplementation(async (input: { purpose: SignaturePurpose; selectedTier?: Tier }) => {
      if (input.purpose !== "work_authorization" && input.purpose !== "work_completion") {
        throw new Error(`Unexpected signature purpose in technician workflow: ${input.purpose}`);
      }
      const signature = signatureFor(input.purpose, input.selectedTier);
      harness.signatures = [signature, ...harness.signatures];
      return signature;
    });
    harness.rejectSignature.mockReset();
    harness.rejectSignature.mockImplementation(async (_target, signatureId: string, reason: string) => ({
      ...harness.signatures.find((signature) => signature.id === signatureId)!,
      status: "rejected" as const,
      rejectedAt: "2026-07-21T17:30:00.000Z",
      rejectionReason: reason
    }));
  });

  it("keeps the guided before-photo action required without hiding the rest of the job", async () => {
    harness.data!.jobPhotos = harness.data!.jobPhotos.filter((photo) => photo.jobId !== harness.jobId);
    const { rerender } = render(<JobDetailPage />);
    await act(async () => undefined);

    fireEvent.click(screen.getByRole("tab", { name: "Before" }));
    expect(screen.getByText("Photo uploader: before")).toBeTruthy();
    expect(nextActionButton()).toHaveProperty("disabled", true);
    expect(stageTab("Estimate")).toHaveProperty("disabled", false);

    harness.data!.jobPhotos.push(photo("before"));
    rerender(<JobDetailPage />);

    expect(nextActionButton()).toHaveProperty("disabled", false);
    fireEvent.click(nextActionButton());
    expect(stageTab("Estimate").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Technician line item editor")).toBeTruthy();
  });

  it("drives authorization, after evidence, completion signature, and invoice strictly forward", async () => {
    const { rerender } = render(<JobDetailPage />);

    fireEvent.click(stageTab("Estimate"));
    await screen.findByText("Technician line item editor");
    fireEvent.click(nextActionButton());
    expect(stageTab("Authorize").getAttribute("aria-selected")).toBe("true");

    fireEvent.click(screen.getByRole("radio", { name: /Good/ }));
    fireEvent.click(nextActionButton());
    fireEvent.click(screen.getByRole("button", { name: "Save test signature" }));

    await waitFor(() => expect(harness.saveSignature).toHaveBeenCalledWith(expect.objectContaining({
      purpose: "work_authorization",
      selectedTier: "good"
    })));
    expect(stageTab("After").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Photo uploader: after")).toBeTruthy();
    expect(nextActionButton()).toHaveProperty("disabled", true);
    expect(stageTab("Complete")).toHaveProperty("disabled", false);

    harness.data!.jobPhotos.push(photo("after"));
    rerender(<JobDetailPage />);
    fireEvent.click(nextActionButton());
    expect(stageTab("Complete").getAttribute("aria-selected")).toBe("true");

    fireEvent.click(nextActionButton());
    fireEvent.click(screen.getByRole("button", { name: "Save test signature" }));
    await waitFor(() => expect(harness.saveSignature).toHaveBeenCalledWith(expect.objectContaining({
      purpose: "work_completion",
      selectedTier: undefined
    })));

    fireEvent.click(nextActionButton());
    await waitFor(() => expect(harness.data!.updateJob).toHaveBeenCalledWith(
      harness.jobId,
      expect.objectContaining({ status: "complete" })
    ));
    expect(stageTab("Invoice").getAttribute("aria-selected")).toBe("true");

    fireEvent.click(nextActionButton());
    await waitFor(() => expect(harness.push).toHaveBeenCalledWith("/invoices/invoice-flow"));
  });

  it("opens authorization on the first populated option without arrival or before-photo gates", async () => {
    const targetJob = harness.data!.jobs.find((job) => job.id === harness.jobId)!;
    targetJob.arrivedAt = undefined;
    harness.data!.jobPhotos = harness.data!.jobPhotos.filter((photo) => photo.jobId !== harness.jobId);
    render(<JobDetailPage />);

    fireEvent.click(stageTab("Authorize"));
    const authorization = screen.getByRole("region", { name: "Customer authorization before work" });
    const signButton = within(authorization).getByRole("button", { name: "Authorize selected work" }) as HTMLButtonElement;
    await waitFor(() => expect(signButton.disabled).toBe(false));
    expect(screen.getByRole("radio", { name: /Good/ }).getAttribute("aria-checked")).toBe("true");

    fireEvent.click(signButton);
    expect(screen.getByRole("dialog", { name: "Authorize proposed work" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save test signature" }));
    await waitFor(() => expect(harness.saveSignature).toHaveBeenCalledWith(expect.objectContaining({
      purpose: "work_authorization",
      selectedTier: "good"
    })));
  });

  it("does not let an unsigned invoice draft take away technician pricing freedom", async () => {
    harness.data!.invoices.push(invoiceForJob());
    render(<JobDetailPage />);
    await act(async () => undefined);

    fireEvent.click(stageTab("Estimate"));
    expect(await screen.findByText("Technician line item editor")).toBeTruthy();
  });

  it("locks the signed scope but lets the assigned technician reject it to revise and re-sign", async () => {
    harness.signatures = [signatureFor("work_authorization", "good")];
    render(<JobDetailPage />);
    await waitFor(() => expect(stageTab("After")).toHaveProperty("disabled", false));

    fireEvent.click(stageTab("Before"));
    expect(screen.getByTestId("photo-uploader-before").getAttribute("data-locked")).toBe("false");

    fireEvent.click(stageTab("Estimate"));
    expect(screen.queryByText("Technician line item editor")).toBeNull();
    expect(screen.getByText(/Reject the authorization first/i)).toBeTruthy();

    fireEvent.click(stageTab("Authorize"));
    const authorization = screen.getByRole("region", { name: "Customer authorization before work" });
    fireEvent.click(within(authorization).getByRole("button", { name: "Reject authorization" }));

    await waitFor(() => expect(harness.rejectSignature).toHaveBeenCalledWith(
      { type: "job", id: harness.jobId },
      "signature-work_authorization",
      "Customer requested a revised scope"
    ));
  });

  it("locks after-work evidence once the customer confirms completion", async () => {
    harness.signatures = [
      signatureFor("work_completion"),
      signatureFor("work_authorization", "good")
    ];
    harness.data!.jobPhotos.push(photo("after"));
    render(<JobDetailPage />);

    await waitFor(() => expect(stageTab("After")).toHaveProperty("disabled", false));
    fireEvent.click(stageTab("After"));
    expect(screen.getByTestId("photo-uploader-after").getAttribute("data-locked")).toBe("true");
    fireEvent.click(stageTab("Before"));
    expect(screen.getByTestId("photo-uploader-before").getAttribute("data-locked")).toBe("true");
  });

  it("makes technician notes read-only after the completion signature is saved", async () => {
    harness.signatures = [
      signatureFor("work_completion"),
      signatureFor("work_authorization", "good")
    ];
    render(<JobDetailPage />);

    expect(await screen.findByText("Job notes · locked")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Technician notes" })).toBeNull();
  });

  it("fails closed when saved signature status cannot be loaded", async () => {
    harness.loadSignatures.mockRejectedValue(new Error("Signature service unavailable."));
    render(<JobDetailPage />);

    fireEvent.click(stageTab("Before"));
    await waitFor(() => expect(screen.getByTestId("photo-uploader-before").getAttribute("data-locked")).toBe("true"));

    fireEvent.click(stageTab("Estimate"));
    expect(screen.queryByText("Technician line item editor")).toBeNull();
    expect(await screen.findByText(/signature status must load successfully/i)).toBeTruthy();
  });
});

function nextActionButton(): HTMLButtonElement {
  return within(screen.getByRole("complementary", { name: "Next job action" })).getByRole("button") as HTMLButtonElement;
}

function stageTab(name: string): HTMLButtonElement {
  return screen.getByRole("tab", { name: new RegExp(`^${name}`) }) as HTMLButtonElement;
}

function techUser(): AllowedUser {
  const user = demoState.allowedUsers.find((candidate) => candidate.id === "22222222-2222-2222-2222-222222222222");
  if (!user) throw new Error("Demo technician is required.");
  return user;
}

function buildData() {
  const state = JSON.parse(JSON.stringify(demoState)) as AppState;
  const updateJob = vi.fn(async (id: string, patch: Record<string, unknown>) => {
    const target = state.jobs.find((job) => job.id === id);
    if (target) Object.assign(target, patch);
  });
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
    updateJob,
    markJobEnRoute: vi.fn(async () => undefined),
    markJobArrived: vi.fn(async () => undefined),
    addPhoto: vi.fn(),
    addLineItem: vi.fn(),
    updateLineItem: vi.fn(),
    deleteLineItem: vi.fn(),
    createPart: vi.fn(),
    createOrUpdateInvoiceDraft: vi.fn(() => invoiceForJob()),
    updateInvoice: vi.fn(),
    sendInvoice: vi.fn(),
    createAllowedUser: vi.fn(),
    updateAllowedUser: vi.fn()
  };
}

function signatureFor(purpose: Extract<SignaturePurpose, "work_authorization" | "work_completion">, selectedTier?: Tier): InvoiceSignature {
  return {
    id: `signature-${purpose}`,
    jobId: harness.jobId,
    purpose,
    signerName: "John Smith",
    signerRole: "customer",
    status: "active",
    contentSha256: "a".repeat(64),
    documentSha256: "b".repeat(64),
    signedAt: "2026-07-21T17:00:00.000Z",
    collectedBy: harness.currentUser!.id,
    createdAt: "2026-07-21T17:00:00.000Z",
    selectedTier
  };
}

function photo(kind: "before" | "after"): JobPhoto {
  return {
    id: `photo-${kind}`,
    jobId: harness.jobId,
    storagePath: `data:image/jpeg;base64,${kind}`,
    kind,
    caption: `${kind} evidence`,
    uploadedBy: harness.currentUser!.id,
    uploadedAt: "2026-07-21T16:30:00.000Z"
  };
}

function invoiceForJob(): Invoice {
  return {
    id: "invoice-flow",
    jobId: harness.jobId,
    invoiceNumber: "INV-FLOW",
    selectedTier: "good",
    subtotalGood: 89,
    subtotalBetter: 245,
    subtotalBest: 2100,
    taxRate: 0.06,
    totalGood: 94.34,
    totalBetter: 259.7,
    totalBest: 2226,
    status: "draft",
    optionLabel: "approved_work",
    notes: "",
    paymentStatus: "unpaid",
    amountPaid: 0,
    approvalStatus: "not_signed",
    pdfVersion: 0,
    createdAt: "2026-07-21T17:45:00.000Z",
    createdBy: harness.currentUser!.id,
    updatedAt: "2026-07-21T17:45:00.000Z"
  };
}
