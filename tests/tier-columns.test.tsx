import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TierColumns } from "@/components/TierColumns";
import type { JobLineItem, Tier } from "@/lib/types";

describe("estimate option workspace", () => {
  it("switches between Standard and optional Good, Better, and Best scopes", () => {
    render(<TierColumns items={items} taxRate={0.06} />);

    expect(screen.getByRole("tab", { name: /Standard/i }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Straightforward repair")).toBeTruthy();
    expect(screen.queryByText("Better repair")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: /Better/i }));

    expect(screen.getByRole("tab", { name: /Better/i }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Better repair")).toBeTruthy();
    expect(screen.queryByText("Straightforward repair")).toBeNull();
  });

  it("moves a line item to a different option only after an explicit persisted save", async () => {
    const onEdit = vi.fn().mockResolvedValue(undefined);
    render(<TierColumns items={items} taxRate={0.06} editable onEdit={onEdit} onDelete={vi.fn()} />);

    fireEvent.click(screen.getByRole("tab", { name: /Good/i }));
    fireEvent.click(screen.getByText("Edit line"));
    fireEvent.change(screen.getByRole("combobox", { name: "Move Good repair to estimate option" }), {
      target: { value: "best" }
    });

    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.getByRole("tab", { name: /Good/i }).getAttribute("aria-selected")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onEdit).toHaveBeenCalledWith("good-item", {
      description: "Good repair",
      quantity: 1,
      unitPrice: 100,
      tier: "best"
    }));
    await waitFor(() => expect(screen.getByRole("tab", { name: /Best/i }).getAttribute("aria-selected")).toBe("true"));
  });

  it("waits for a matching destination line to be removed before persisting the move", async () => {
    const order: string[] = [];
    const onEdit = vi.fn(async () => { order.push("edit"); });
    const onDelete = vi.fn(async () => { order.push("delete"); });
    const duplicateServiceItems = [
      lineItem("source-item", "Condenser coil replacement", "good", 1850),
      lineItem("destination-item", "Condenser coil replacement", "better", 1850)
    ];
    render(<TierColumns items={duplicateServiceItems} taxRate={0.06} editable onEdit={onEdit} onDelete={onDelete} />);

    fireEvent.click(screen.getByText("Edit line"));
    fireEvent.change(screen.getByRole("combobox", { name: "Move Condenser coil replacement to estimate option" }), {
      target: { value: "better" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(onDelete).toHaveBeenCalledWith("destination-item"));
    await waitFor(() => expect(onEdit).toHaveBeenCalledWith("source-item", expect.objectContaining({ tier: "better" })));
    expect(order).toEqual(["delete", "edit"]);
  });

  it("keeps unsaved draft prices out of the displayed total and surfaces persistence errors", async () => {
    const onEdit = vi.fn().mockRejectedValue(new Error("Network save failed."));
    render(<TierColumns items={items} taxRate={0.06} editable onEdit={onEdit} onDelete={vi.fn()} />);

    fireEvent.click(screen.getByText("Edit line"));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Unit price for Straightforward repair" }), {
      target: { value: "999" }
    });

    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.getAllByText("$94.34").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Network save failed.");
    expect(screen.getAllByText("$94.34").length).toBeGreaterThan(0);
  });
});

const items: JobLineItem[] = [
  lineItem("standard-item", "Straightforward repair", "standard", 89),
  lineItem("good-item", "Good repair", "good", 100),
  lineItem("better-item", "Better repair", "better", 200)
];

function lineItem(id: string, description: string, tier: Tier, unitPrice: number): JobLineItem {
  return {
    id,
    jobId: "job-1",
    description,
    quantity: 1,
    unitPrice,
    tier,
    isManual: true,
    sortOrder: 1
  };
}
