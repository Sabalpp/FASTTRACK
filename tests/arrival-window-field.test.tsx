import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { ArrivalWindowField } from "@/components/ArrivalWindowField";
import { emptyArrivalWindowDraft, type ArrivalWindowDraft } from "@/lib/arrival-window";

describe("ArrivalWindowField", () => {
  it("uses native date, start, and end controls and presents the Eastern-time window", () => {
    render(<Harness />);

    const date = screen.getByLabelText("Date");
    const start = screen.getByLabelText("Starts at");
    const end = screen.getByLabelText("Ends at");
    expect(date).toHaveProperty("type", "date");
    expect(start).toHaveProperty("type", "time");
    expect(end).toHaveProperty("type", "time");
    expect(end).toHaveProperty("disabled", true);

    fireEvent.change(date, { target: { value: "2026-07-21" } });
    fireEvent.change(start, { target: { value: "16:30" } });

    expect(end).toHaveProperty("disabled", false);
    expect(end).toHaveProperty("value", "19:30");
    expect(screen.getByText("Tue, Jul 21 · 4:30 PM–7:30 PM")).toBeTruthy();
    expect(screen.getByText("Eastern time (EDT) · 3 hours")).toBeTruthy();
  });

  it("keeps start and end independently editable", () => {
    render(<Harness initial={{ localDate: "2026-07-21", localStartTime: "09:00", durationMinutes: 180 }} />);

    fireEvent.change(screen.getByLabelText("Starts at"), { target: { value: "10:00" } });
    expect(screen.getByLabelText("Ends at")).toHaveProperty("value", "12:00");
    expect(screen.getByText("Eastern time (EDT) · 2 hours")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Ends at"), { target: { value: "13:15" } });
    expect(screen.getByText("Tue, Jul 21 · 10:00 AM–1:15 PM")).toBeTruthy();
    expect(screen.getByText("Eastern time (EDT) · 3 hours 15 minutes")).toBeTruthy();
  });

  it("preserves a legacy custom duration and offers the owner-configured default reset", () => {
    render(<Harness initial={{ localDate: "2026-07-21", localStartTime: "16:30", durationMinutes: 120 }} defaultDurationMinutes={240} />);

    expect(screen.getByText("This window is 2 hours.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use default 4 hours" }));
    expect(screen.getByText("Eastern time (EDT) · 4 hours")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Use default 4 hours" })).toBeNull();
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
    expect(screen.queryByLabelText("Ends at")).toBeNull();
  });
});

function Harness({
  initial = emptyArrivalWindowDraft(),
  defaultDurationMinutes
}: {
  initial?: ArrivalWindowDraft;
  defaultDurationMinutes?: number;
}) {
  const [value, setValue] = useState(initial);
  return <ArrivalWindowField value={value} onChange={setValue} required defaultDurationMinutes={defaultDurationMinutes} />;
}
