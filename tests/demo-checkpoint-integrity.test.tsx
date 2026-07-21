import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppDataProvider, useAppData } from "@/lib/data-store";
import type { PhotoKind, SignaturePurpose } from "@/lib/types";

vi.mock("@/lib/runtime", () => ({ demoMode: true }));

const SIGNATURES_KEY = "hvac-plumbing-mvp-signatures-v1";

describe("demo photo checkpoint integrity", () => {
  beforeEach(() => window.localStorage.clear());

  it.each([
    ["before" as const, "work_authorization" as const, "Reject the saved customer work authorization"],
    ["after" as const, "work_completion" as const, "Reject the saved completion signature"]
  ])("blocks %s evidence after its active %s signature", async (kind, purpose, expectedError) => {
    storeActiveSignature(purpose);
    render(<AppDataProvider><DemoCheckpointProbe kind={kind} /></AppDataProvider>);
    await waitFor(() => expect(screen.getByText("Workspace loaded")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: `Add ${kind} photo` }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain(expectedError));
    expect(screen.getByTestId("photo-count").textContent).toBe(screen.getByTestId("initial-photo-count").textContent);
  });

  it("clears persisted signatures when demo data is reset", async () => {
    storeActiveSignature("work_authorization");
    render(<AppDataProvider><DemoCheckpointProbe kind="before" /></AppDataProvider>);
    await waitFor(() => expect(screen.getByText("Workspace loaded")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Reset demo data" }));

    expect(window.localStorage.getItem(SIGNATURES_KEY)).toBeNull();
  });

  it("blocks after-work evidence once a demo job is completed even without a signature", async () => {
    render(<AppDataProvider><DemoCheckpointProbe kind="after" /></AppDataProvider>);
    await waitFor(() => expect(screen.getByText("Workspace loaded")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Complete demo job" }));
    await waitFor(() => expect(screen.getByTestId("job-status").textContent?.includes("complete")).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Add after photo" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent?.includes("already been completed")).toBe(true));
    expect(screen.getByTestId("photo-count").textContent).toBe(screen.getByTestId("initial-photo-count").textContent);
  });

  it("blocks completion-bound notes and service details after a demo job is complete", async () => {
    render(<AppDataProvider><DemoCheckpointProbe kind="after" /></AppDataProvider>);
    await waitFor(() => expect(screen.getByText("Workspace loaded")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Complete demo job" }));
    await waitFor(() => expect(screen.getByTestId("job-status").textContent?.includes("complete")).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Edit completed notes" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent?.includes("Completion-bound job details are locked")).toBe(true));
  });
});

function DemoCheckpointProbe({ kind }: { kind: PhotoKind }) {
  const data = useAppData();
  const [error, setError] = useState("");
  const [initialCount] = useState(data.jobPhotos.length);
  const targetJob = data.jobs.find((job) => job.id === "job-aaaaaaaa-0001-4000-8000-000000000001");

  if (!data.loaded) return <p>Loading workspace</p>;

  return (
    <div>
      <p>Workspace loaded</p>
      <span data-testid="initial-photo-count">{initialCount}</span>
      <span data-testid="photo-count">{data.jobPhotos.length}</span>
      <span data-testid="job-status">{targetJob?.status}</span>
      <button type="button" onClick={() => void data.addPhoto({
        jobId: "job-aaaaaaaa-0001-4000-8000-000000000001",
        uploadedBy: "22222222-2222-2222-2222-222222222222",
        kind,
        caption: `${kind} checkpoint`,
        storagePath: "data:image/jpeg;base64,cGhvdG8="
      }).catch((reason) => setError(reason instanceof Error ? reason.message : "Photo failed."))}>
        Add {kind} photo
      </button>
      <button type="button" onClick={() => void data.updateJob("job-aaaaaaaa-0001-4000-8000-000000000001", {
        status: "complete",
        completedAt: "2026-07-21T18:00:00.000Z"
      })}>Complete demo job</button>
      <button type="button" onClick={() => void data.updateJob("job-aaaaaaaa-0001-4000-8000-000000000001", {
        notes: "Changed after completion"
      }).catch((reason) => setError(reason instanceof Error ? reason.message : "Notes update failed."))}>Edit completed notes</button>
      <button type="button" onClick={data.resetDemoData}>Reset demo data</button>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}

function storeActiveSignature(purpose: SignaturePurpose) {
  window.localStorage.setItem(SIGNATURES_KEY, JSON.stringify([{
    id: `signature-${purpose}`,
    jobId: "job-aaaaaaaa-0001-4000-8000-000000000001",
    purpose,
    signerName: "Test Customer",
    signerRole: "customer",
    status: "active",
    contentSha256: "a".repeat(64),
    documentSha256: "b".repeat(64),
    signedAt: "2026-07-21T17:00:00.000Z",
    collectedBy: "22222222-2222-2222-2222-222222222222",
    createdAt: "2026-07-21T17:00:00.000Z",
    selectedTier: purpose === "work_authorization" ? "standard" : undefined
  }]));
}
