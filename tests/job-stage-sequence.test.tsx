import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { JobStageNav } from "@/components/JobStageNav";

describe("technician job-stage sequence", () => {
  it("makes before and after photos separate forward checkpoints", () => {
    const onChange = vi.fn();
    render(<JobStageNav active="overview" onChange={onChange} />);

    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Overview",
      "Before",
      "Estimate",
      "Authorize",
      "After",
      "Complete",
      "Invoice"
    ]);

    fireEvent.click(screen.getByRole("tab", { name: "After" }));
    expect(onChange).toHaveBeenCalledWith("after");
  });
});
