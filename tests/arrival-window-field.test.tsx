import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { ArrivalWindowField } from "@/components/ArrivalWindowField";
import { emptyArrivalWindowDraft, type ArrivalWindowDraft } from "@/lib/arrival-window";

describe("ArrivalWindowField", () => {
  it("asks only for a date and start time, then presents the derived Eastern-time window", () => {
    render(<Harness />);

    const date = screen.getByLabelText("Date");
    const start = screen.getByLabelText("Starts at");
    expect(date).toHaveProperty("type", "date");
    expect(start).toHaveProperty("type", "time");
    expect(screen.queryByLabelText("Window ends")).toBeNull();

    fireEvent.change(date, { target: { value: "2026-07-21" } });
    fireEvent.change(start, { target: { value: "16:30" } });

    expect(screen.getByText("Tue, Jul 21 · 4:30 PM–7:30 PM")).toBeTruthy();
    expect(screen.getByText("Eastern time (EDT) · 3 hours")).toBeTruthy();
  });

  it("preserves a legacy custom duration and only then offers the standard three-hour reset", () => {
    render(<Harness initial={{ localDate: "2026-07-21", localStartTime: "16:30", durationMinutes: 120 }} />);

    expect(screen.getByText("This job has an existing window length of 2 hours.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use standard 3 hours" }));
    expect(screen.getByText("Eastern time (EDT) · 3 hours")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Use standard 3 hours" })).toBeNull();
  });

  it("renders a read-only summary without disabled form controls", () => {
    render(
      <ArrivalWindowField
        editable={false}
        value={{ localDate: "2026-07-21", localStartTime: "16:30", durationMinutes: 180 }}
      />
    );

    expect(screen.getByText("Tue, Jul 21 · 4:30 PM–7:30 PM")).toBeTruthy();
    expect(screen.queryByLabelText("Date")).toBeNull();
    expect(screen.queryByLabelText("Starts at")).toBeNull();
  });
});

function Harness({ initial = emptyArrivalWindowDraft() }: { initial?: ArrivalWindowDraft }) {
  const [value, setValue] = useState(initial);
  return <ArrivalWindowField value={value} onChange={setValue} required />;
}
