import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SignaturePadHandle } from "@/components/SignaturePad";

vi.mock("@/components/SignaturePad", async () => {
  const React = await import("react");
  const SignaturePad = React.forwardRef<SignaturePadHandle, {
    onStrokeCountChange?: (count: number) => void;
    onSignatureMethodChange?: (method: "drawn" | "typed" | undefined) => void;
  }>(
    function MockSignaturePad({ onStrokeCountChange, onSignatureMethodChange }, ref) {
      const [count, setCount] = React.useState(0);
      const publish = (next: number) => {
        setCount(next);
        onStrokeCountChange?.(next);
      };
      React.useImperativeHandle(ref, () => ({
        clear: () => { publish(0); onSignatureMethodChange?.(undefined); },
        undo: () => { publish(Math.max(0, count - 1)); onSignatureMethodChange?.(count > 1 ? "drawn" : undefined); },
        setTypedName: () => { publish(1); onSignatureMethodChange?.("typed"); },
        isEmpty: () => count === 0,
        exportPng: async () => {
          if (count === 0) throw new Error("Draw a signature before saving.");
          return { blob: new Blob(["signature"], { type: "image/png" }), width: 1600, height: 600 };
        }
      }), [count]);
      return <button type="button" onClick={() => { publish(count + 1); onSignatureMethodChange?.("drawn"); }}>Add test stroke</button>;
    }
  );
  return { SignaturePad };
});

import { SignatureDialog } from "@/components/SignatureDialog";

describe("signature dialog save behavior", () => {
  it("keeps the dialog open and reports that approval failed when storage fails", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("The signature image could not be stored. Nothing was approved."));
    renderDialog({ onSave });

    fireEvent.click(screen.getByRole("button", { name: "Add test stroke" }));
    fireEvent.click(screen.getByRole("button", { name: "Save signature" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Nothing was approved");
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toMatchObject({ signerName: "Jordan Taylor", signerRole: "customer", width: 1600, height: 600 });
  });

  it("shows a saving state until the signature callback succeeds", async () => {
    let finishSave: (() => void) | undefined;
    const onSave = vi.fn(() => new Promise<void>((resolve) => { finishSave = resolve; }));
    renderDialog({ onSave });

    fireEvent.click(screen.getByRole("button", { name: "Add test stroke" }));
    fireEvent.click(screen.getByRole("button", { name: "Save signature" }));

    expect(screen.getByRole("button", { name: "Saving signature..." })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    await act(async () => {
      finishSave?.();
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Save signature" })).toBeTruthy());
  });

  it("does not reset an in-progress signature when a parent callback identity changes", () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const firstCancel = vi.fn();
    const view = renderDialog({ onSave, onCancel: firstCancel });

    const name = screen.getByLabelText("Signer full name") as HTMLInputElement;
    fireEvent.change(name, { target: { value: "Edited Customer Name" } });
    fireEvent.click(screen.getByRole("button", { name: "Add test stroke" }));

    view.rerender(dialog({ onSave, onCancel: vi.fn() }));
    expect((screen.getByLabelText("Signer full name") as HTMLInputElement).value).toBe("Edited Customer Name");
    expect((screen.getByRole("button", { name: "Save signature" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("offers an accessible typed-signature path and connects the dialog description", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderDialog({ onSave });

    const dialogElement = screen.getByRole("dialog");
    expect(dialogElement.getAttribute("aria-describedby")).toBe("signature-dialog-description");
    fireEvent.click(screen.getByRole("button", { name: "Use typed signature" }));
    expect((screen.getByLabelText("Signer full name") as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Save signature" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  });
});

function renderDialog({
  onSave,
  onCancel = vi.fn()
}: {
  onSave: (input: { signerName: string; signerRole: "customer" | "technician" | "company"; image: Blob; width: number; height: number }) => Promise<void>;
  onCancel?: () => void;
}) {
  return render(dialog({ onSave, onCancel }));
}

function dialog({
  onSave,
  onCancel
}: {
  onSave: (input: { signerName: string; signerRole: "customer" | "technician" | "company"; image: Blob; width: number; height: number }) => Promise<void>;
  onCancel: () => void;
}) {
  return (
    <SignatureDialog
      open
      title="Customer approval"
      description="Review and sign."
      signerRole="customer"
      defaultSignerName="Jordan Taylor"
      onCancel={onCancel}
      onSave={onSave}
    />
  );
}
