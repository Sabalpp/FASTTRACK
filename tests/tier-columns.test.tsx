import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TierColumns } from "@/components/TierColumns";
import type { JobLineItem, Tier } from "@/lib/types";

describe("estimate option workspace", () => {
  it("switches between Good, Better, and Best without rendering three wide columns", () => {
    render(<TierColumns items={items} taxRate={0.06} />);

    expect(screen.getByRole("tab", { name: /Good/i }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Good repair")).toBeTruthy();
    expect(screen.queryByText("Better repair")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: /Better/i }));

    expect(screen.getByRole("tab", { name: /Better/i }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Better repair")).toBeTruthy();
    expect(screen.queryByText("Good repair")).toBeNull();
  });

  it("moves a line item to a different option instead of cloning it", () => {
    const onEdit = vi.fn();
    render(<TierColumns items={items} taxRate={0.06} editable onEdit={onEdit} onDelete={vi.fn()} />);

    fireEvent.click(screen.getByText("Edit line"));
    fireEvent.change(screen.getByRole("combobox", { name: "Move Good repair to estimate option" }), {
      target: { value: "best" }
    });

    expect(onEdit).toHaveBeenCalledWith("good-item", { tier: "best" });
    expect(screen.getByRole("tab", { name: /Best/i }).getAttribute("aria-selected")).toBe("true");
  });

  it("removes an existing matching destination line before moving the service", () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    const duplicateServiceItems = [
      lineItem("source-item", "Condenser coil replacement", "good", 1850),
      lineItem("destination-item", "Condenser coil replacement", "better", 1850)
    ];
    render(<TierColumns items={duplicateServiceItems} taxRate={0.06} editable onEdit={onEdit} onDelete={onDelete} />);

    fireEvent.click(screen.getByText("Edit line"));
    fireEvent.change(screen.getByRole("combobox", { name: "Move Condenser coil replacement to estimate option" }), {
      target: { value: "better" }
    });

    expect(onDelete).toHaveBeenCalledWith("destination-item");
    expect(onEdit).toHaveBeenCalledWith("source-item", { tier: "better" });
  });
});

const items: JobLineItem[] = [
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
