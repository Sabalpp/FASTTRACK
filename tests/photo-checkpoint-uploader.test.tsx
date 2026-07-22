import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PhotoUploader } from "@/components/PhotoUploader";
import type { PhotoKind } from "@/lib/types";

const harness = vi.hoisted(() => ({ addPhoto: vi.fn(), createPhotoPreview: vi.fn() }));

vi.mock("@/lib/data-store", () => ({
  useAppData: () => harness,
  photoKinds: ["before", "after", "other"]
}));

vi.mock("@/lib/photo-preview", () => ({
  createPhotoPreview: harness.createPhotoPreview
}));

vi.mock("@/lib/runtime", () => ({ demoMode: true }));

describe("photo checkpoint uploader", () => {
  beforeEach(() => {
    harness.addPhoto.mockReset();
    harness.addPhoto.mockResolvedValue({});
    harness.createPhotoPreview.mockReset();
    harness.createPhotoPreview.mockResolvedValue("data:image/jpeg;base64,cGhvdG8=");
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
      caption: `${label} evidence`
    }));
    const uploadedFile = harness.addPhoto.mock.calls[0][0].file as File;
    expect(uploadedFile).not.toBe(file);
    expect(uploadedFile.name).toBe(`${kind}.jpg`);
    expect(uploadedFile.type).toBe("image/jpeg");
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

  it("uploads the prepared JPEG bytes with a compatible filename for non-JPEG camera sources", async () => {
    const { container } = render(<PhotoUploader jobId="job-1" uploadedBy="tech-1" lockedKind="before" />);
    const original = new File(["heic-source"], "equipment.heic", { type: "image/heic" });
    const input = container.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error("Photo file input is required.");

    fireEvent.change(input, { target: { files: [original] } });
    await waitFor(() => expect(screen.getByAltText("Selected job photo preview")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Save photo" }));

    await waitFor(() => expect(harness.addPhoto).toHaveBeenCalledOnce());
    const uploadedFile = harness.addPhoto.mock.calls[0][0].file as File;
    expect(uploadedFile.name).toBe("equipment.jpg");
    expect(uploadedFile.type).toBe("image/jpeg");
    expect(uploadedFile.size).toBe(5);
  });

  it("refuses an unsupported camera original when JPEG conversion fails", async () => {
    harness.createPhotoPreview.mockResolvedValueOnce("data:image/heic;base64,aGVpYw==");
    const { container } = render(<PhotoUploader jobId="job-1" uploadedBy="tech-1" lockedKind="after" />);
    const original = new File(["heic"], "equipment.heic", { type: "image/heic" });
    const input = container.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error("Photo file input is required.");

    fireEvent.change(input, { target: { files: [original] } });

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("could not be converted to JPEG"));
    expect(harness.addPhoto).not.toHaveBeenCalled();
    expect(screen.queryByAltText("Selected job photo preview")).toBeNull();
  });

  it("requires an explicit second action before recording a skipped checkpoint", async () => {
    const onSkipCheckpoint = vi.fn().mockResolvedValue(undefined);
    const view = render(
      <PhotoUploader
        jobId="job-1"
        uploadedBy="tech-1"
        lockedKind="before"
        onSkipCheckpoint={onSkipCheckpoint}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Skip before photo" }));
    expect(onSkipCheckpoint).not.toHaveBeenCalled();
    expect(screen.getByRole("group", { name: "Confirm skip before photo" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Confirm skip" }));
    await waitFor(() => expect(onSkipCheckpoint).toHaveBeenCalledOnce());

    view.rerender(
      <PhotoUploader
        jobId="job-1"
        uploadedBy="tech-1"
        lockedKind="before"
        checkpointSkipped
        checkpointSkipSummary="Recorded July 22 by Taylor Tech."
        onSkipCheckpoint={onSkipCheckpoint}
      />
    );
    expect(screen.getByRole("status", { name: "Before photo skipped" })).toBeTruthy();
    expect(screen.getByText("Recorded July 22 by Taylor Tech.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Skip before photo" })).toBeNull();
    expect(view.container.querySelector('input[type="file"]')).toBeNull();
  });

  it("keeps the confirmation open and reports a failed skip for retry", async () => {
    const onSkipCheckpoint = vi.fn().mockRejectedValue(new Error("The checkpoint audit could not be saved."));
    render(
      <PhotoUploader
        jobId="job-1"
        uploadedBy="tech-1"
        lockedKind="after"
        onSkipCheckpoint={onSkipCheckpoint}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Skip after photo" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm skip" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("checkpoint audit could not be saved"));
    expect(screen.getByRole("group", { name: "Confirm skip after photo" })).toBeTruthy();
  });
});
