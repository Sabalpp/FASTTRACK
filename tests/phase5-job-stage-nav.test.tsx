import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { JobStageNav, jobStages } from "@/components/JobStageNav";

describe("Phase 5 job stage navigation", () => {
  it("presents the seven field-work checkpoints as labeled tabs without a numbered rail", () => {
    render(<JobStageNav active="overview" onChange={vi.fn()} />);

    expect(screen.getAllByRole("tab")).toHaveLength(7);
    for (const stage of jobStages) {
      expect(screen.getByRole("tab", { name: new RegExp(stage.shortLabel, "i") })).toBeTruthy();
    }
    expect(screen.queryByText(/^1$/)).toBeNull();
    expect(screen.getByRole("tab", { name: /overview/i }).getAttribute("aria-selected")).toBe("true");
  });

  it("moves to a selected stage and keeps counts informational", () => {
    const onChange = vi.fn();
    render(
      <JobStageNav
        active="photos"
        onChange={onChange}
        counts={{ photos: 3, work: 2 }}
        completion={{ photos: true }}
      />
    );

    expect(screen.getByText("3")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /estimate/i }));
    expect(onChange).toHaveBeenCalledWith("work");
  });
});
