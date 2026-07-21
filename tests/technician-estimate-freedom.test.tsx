import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LineItemForm } from "@/components/LineItemForm";
import { TierColumns } from "@/components/TierColumns";
import type { JobLineItem, Part } from "@/lib/types";

const harness = vi.hoisted(() => ({
  parts: [] as Part[],
  jobLineItems: [] as JobLineItem[],
  addLineItem: vi.fn(),
  updateLineItem: vi.fn(),
  deleteLineItem: vi.fn()
}));

vi.mock("@/lib/data-store", () => ({
  useAppData: () => harness,
  tierLabels: {
    standard: "Standard",
    good: "Good",
    better: "Better",
    best: "Best"
  },
  tierOptions: ["standard", "good", "better", "best"]
}));

describe("technician estimate freedom", () => {
  beforeEach(() => {
    harness.parts = [];
    harness.jobLineItems = [];
    harness.addLineItem.mockReset();
    harness.updateLineItem.mockReset();
    harness.deleteLineItem.mockReset();
    harness.addLineItem.mockResolvedValue(undefined);
    harness.updateLineItem.mockResolvedValue(undefined);
    harness.deleteLineItem.mockResolvedValue(undefined);
  });

  it("lets a technician create a fully custom Standard line without a catalog part", () => {
    render(<LineItemForm jobId="job-1" />);

    expect(screen.getByRole("option", { name: "Custom item" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Standard" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Good" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Better" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Best" })).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "Emergency isolation and custom bypass" }
    });
    fireEvent.change(screen.getByLabelText("Quantity"), { target: { value: "2.5" } });
    fireEvent.change(screen.getByLabelText("Unit price ($)"), { target: { value: "187.75" } });
    fireEvent.click(screen.getByRole("button", { name: "Save line item" }));

    expect(harness.addLineItem).toHaveBeenCalledWith({
      jobId: "job-1",
      partId: undefined,
      description: "Emergency isolation and custom bypass",
      quantity: 2.5,
      unitPrice: 187.75,
      tier: "standard",
      isManual: true
    });
  });

  it("keeps description, quantity, price, and option editable with one explicit save", async () => {
    const item: JobLineItem = {
      id: "line-1",
      jobId: "job-1",
      description: "Custom site repair",
      quantity: 1,
      unitPrice: 225,
      tier: "standard",
      isManual: true,
      sortOrder: 1
    };

    render(
      <TierColumns
        items={[item]}
        taxRate={0.06}
        editable
        onEdit={harness.updateLineItem}
        onDelete={harness.deleteLineItem}
      />
    );

    fireEvent.click(screen.getByText("Edit line"));
    fireEvent.change(screen.getByRole("textbox", { name: "Description for Custom site repair" }), {
      target: { value: "Custom site repair with access work" }
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Quantity for Custom site repair" }), {
      target: { value: "3" }
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Unit price for Custom site repair" }), {
      target: { value: "199.5" }
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Move Custom site repair to estimate option" }), {
      target: { value: "better" }
    });

    expect(harness.updateLineItem).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(harness.updateLineItem).toHaveBeenCalledWith("line-1", {
      description: "Custom site repair with access work",
      quantity: 3,
      unitPrice: 199.5,
      tier: "better"
    }));
    expect(harness.deleteLineItem).not.toHaveBeenCalled();
  });

  it("reports the selected option after a new custom line is durably saved", async () => {
    const onSaved = vi.fn();
    let finishSave: (() => void) | undefined;
    harness.addLineItem.mockImplementation(() => new Promise((resolve) => {
      finishSave = () => resolve(undefined);
    }));
    render(<LineItemForm jobId="job-1" onSaved={onSaved} />);

    fireEvent.change(screen.getByRole("combobox", { name: /Estimate option/ }), { target: { value: "best" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Description" }), { target: { value: "Custom premium repair" } });
    fireEvent.change(screen.getByLabelText("Unit price ($)"), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: "Save line item" }));

    expect(screen.getByRole("button", { name: "Saving line item…" })).toHaveProperty("disabled", true);
    expect(onSaved).not.toHaveBeenCalled();
    finishSave?.();
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("best"));
  });
});
