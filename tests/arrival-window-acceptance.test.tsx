import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ArrivalWindowField } from "@/components/ArrivalWindowField";
import {
  STANDARD_ARRIVAL_WINDOW_MINUTES,
  formatArrivalWindowRange,
  resolveArrivalWindow,
  type ArrivalWindowDraft
} from "@/lib/arrival-window";

describe("arrival-window acceptance", () => {
  it("turns an Eastern local start into a derived three-hour customer promise", () => {
    const resolution = resolveArrivalWindow({
      localDate: "2026-07-21",
      localStartTime: "09:00",
      durationMinutes: STANDARD_ARRIVAL_WINDOW_MINUTES
    });

    expect(resolution).toEqual({
      status: "valid",
      startAt: "2026-07-21T13:00:00.000Z",
      endAt: "2026-07-21T16:00:00.000Z",
      durationMinutes: 180
    });
    if (resolution.status !== "valid") throw new Error("Expected a valid arrival window.");
    expect(formatArrivalWindowRange(resolution.startAt, resolution.endAt)).toBe(
      "Tue, Jul 21 · 9:00 AM–12:00 PM"
    );
  });

  it("uses native start and end controls and communicates the customer promise", () => {
    const value: ArrivalWindowDraft = {
      localDate: "2026-07-21",
      localStartTime: "09:00",
      durationMinutes: 180
    };
    const onChange = vi.fn();
    const { container } = render(<ArrivalWindowField value={value} onChange={onChange} required />);

    const fieldset = screen.getByRole("group", { name: "Arrival window" });
    expect(withinText(fieldset, "Customer arrival window")).toBeTruthy();
    expect(screen.getByLabelText("Date").getAttribute("type")).toBe("date");
    expect(screen.getByLabelText("Starts at").getAttribute("type")).toBe("time");
    expect(screen.getByLabelText("Ends at").getAttribute("type")).toBe("time");
    expect(screen.getByLabelText("Ends at")).toHaveProperty("value", "12:00");
    expect(screen.queryByText(/service duration/i)).toBeNull();
    expect(screen.getByText(/9:00 AM–12:00 PM/)).toBeTruthy();
    expect(screen.getByText(/Eastern time \(EDT\) · 3 hours/)).toBeTruthy();

    const summary = container.querySelector('[aria-live="polite"][aria-atomic="true"]');
    expect(summary).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Starts at"), { target: { value: "10:15" } });
    expect(onChange).toHaveBeenCalledWith({
      localDate: "2026-07-21",
      localStartTime: "10:15",
      durationMinutes: 105
    });

    fireEvent.change(screen.getByLabelText("Ends at"), { target: { value: "13:00" } });
    expect(onChange).toHaveBeenCalledWith({
      localDate: "2026-07-21",
      localStartTime: "09:00",
      durationMinutes: 240
    });
  });

  it("rejects ambiguous or nonexistent Eastern wall-clock times instead of silently shifting them", () => {
    expect(resolveArrivalWindow({
      localDate: "2026-03-08",
      localStartTime: "02:30",
      durationMinutes: 180
    })).toEqual({
      status: "invalid",
      error: "That start time does not exist in Eastern time because of daylight saving time. Choose another time."
    });

    expect(resolveArrivalWindow({
      localDate: "2026-11-01",
      localStartTime: "01:30",
      durationMinutes: 180
    })).toEqual({
      status: "invalid",
      error: "That start time occurs twice in Eastern time because of daylight saving time. Choose another time."
    });
  });

  it("encodes a narrow-container, touch-safe no-overflow contract for iPad and phone widths", () => {
    const css = readFileSync(
      resolve(process.cwd(), "components/ArrivalWindowField.module.css"),
      "utf8"
    );

    expect(css).toMatch(/\.fieldset\s*\{[^}]*container-type:\s*inline-size/s);
    expect(css).toMatch(/\.controls\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1\.15fr\)\s+repeat\(2,\s*minmax\(8\.5rem,\s*0\.75fr\)\)/s);
    expect(css).toMatch(/@container\s*\(max-width:\s*42rem\)[\s\S]*?\.controls\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
    expect(css).toMatch(/\.field input\s*\{[^}]*box-sizing:\s*border-box[^}]*min-width:\s*0[^}]*max-width:\s*100%/s);
    expect(css).toMatch(/\.field input\s*\{[^}]*min-height:\s*4[48]px[^}]*font-size:\s*16px/s);
  });

  it("treats overlapping arrival promises as a route warning, not a service-duration collision", () => {
    const newJob = readFileSync(resolve(process.cwd(), "app/jobs/new/page.tsx"), "utf8");
    const jobDetail = readFileSync(resolve(process.cwd(), "app/jobs/[id]/page.tsx"), "utf8");

    expect(newJob).toContain("Overlapping customer arrival windows");
    expect(jobDetail).toContain("Overlapping customer arrival windows");
    expect(newJob).toContain("These windows do not represent planned service duration.");
    expect(newJob).not.toContain("Technician schedule overlap");
    expect(jobDetail).not.toContain("Technician schedule overlap");
    expect(newJob).not.toContain("conflictConfirmed");
    expect(newJob).not.toContain("Schedule anyway");
  });
});

function withinText(container: HTMLElement, text: string): Element | undefined {
  return Array.from(container.querySelectorAll("*")).find((element) => element.textContent === text);
}
