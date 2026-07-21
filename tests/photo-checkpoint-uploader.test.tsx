import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PhotoUploader } from "@/components/PhotoUploader";
import type { PhotoKind } from "@/lib/types";

const harness = vi.hoisted(() => ({ addPhoto: vi.fn() }));

vi.mock("@/lib/data-store", () => ({
  useAppData: () => harness,
  photoKinds: ["before", "after", "other"]
}));

vi.mock("@/lib/photo-preview", () => ({
  createPhotoPreview: vi.fn(async () => "data:image/jpeg;base64,cGhvdG8=")
}));

vi.mock("@/lib/runtime", () => ({ demoMode: true }));

describe("photo checkpoint uploader", () => {
  beforeEach(() => {
    harness.addPhoto.mockReset();
    harness.addPhoto.mockResolvedValue({});
  });

  it.each([
    ["before" as const, "Before work"],
    ["after" as const, "After work"]
  ])("locks the %s checkpoint so a field photo cannot be misclassified", async (kind, label) => {
    const { container } = render(
      <PhotoUploader jobId="job-1" uploadedBy="tech-1" lockedKind={kind} />
    );
    const file = new File(["photo"], `${kind}.jpg`, { type: "image/jpeg" });
    const input = container.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error("Photo file input is required.");

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByAltText("Selected job photo preview")).toBeTruthy());
    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "before" })).toBeNull();
    expect(screen.queryByRole("button", { name: "after" })).toBeNull();

    fireEvent.change(screen.getByLabelText(/Caption/), { target: { value: `${label} evidence` } });
    fireEvent.click(screen.getByRole("button", { name: "Save photo" }));

    expect(harness.addPhoto).toHaveBeenCalledWith(expect.objectContaining({
      jobId: "job-1",
      uploadedBy: "tech-1",
      kind: kind as PhotoKind,
      caption: `${label} evidence`,
      file
    }));
    await waitFor(() => expect(screen.getByText("Photo saved")).toBeTruthy());
  });

  it("replaces the capture controls with a clear locked checkpoint state", () => {
    const { container } = render(
      <PhotoUploader
        jobId="job-1"
        uploadedBy="tech-1"
        lockedKind="before"
        checkpointLocked
        lockedTitle="Before photos locked by customer authorization"
        lockedMessage="Reject the active authorization before changing this evidence."
      />
    );

    expect(screen.getByRole("status", { name: "Before photos locked" })).toBeTruthy();
    expect(screen.getByText("Before photos locked by customer authorization")).toBeTruthy();
    expect(screen.getByText("Reject the active authorization before changing this evidence.")).toBeTruthy();
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(screen.queryByRole("button", { name: "Save photo" })).toBeNull();
  });

  it("does not report a photo as saved until persistence finishes", async () => {
    let finishSaving: (() => void) | undefined;
    harness.addPhoto.mockImplementation(() => new Promise((resolve) => {
      finishSaving = () => resolve({});
    }));
    const { container } = render(<PhotoUploader jobId="job-1" uploadedBy="tech-1" lockedKind="before" />);
    const file = new File(["photo"], "before.jpg", { type: "image/jpeg" });
    const input = container.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error("Photo file input is required.");

    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByAltText("Selected job photo preview")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Save photo" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Saving…" })).toBeTruthy());
    expect(screen.queryByText("Photo saved")).toBeNull();

    finishSaving?.();
    await waitFor(() => expect(screen.getByText("Photo saved")).toBeTruthy());
  });

  it("keeps the selected photo and surfaces a persistence error for retry", async () => {
    harness.addPhoto.mockRejectedValue(new Error("Private photo upload failed."));
    const { container } = render(<PhotoUploader jobId="job-1" uploadedBy="tech-1" lockedKind="after" />);
    const file = new File(["photo"], "after.jpg", { type: "image/jpeg" });
    const input = container.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error("Photo file input is required.");

    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByAltText("Selected job photo preview")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Save photo" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Private photo upload failed."));
    expect(screen.getByAltText("Selected job photo preview")).toBeTruthy();
    expect(screen.queryByText("Photo saved")).toBeNull();
  });
});
