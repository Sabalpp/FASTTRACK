import React, { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";

type Selection = {
  formatted: string;
  addressLine1: string;
  city: string;
  state: string;
  zip: string;
};

const originalGoogleKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
const originalMapboxToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;

describe("AddressAutocomplete", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY = "";
    process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN = "public-mapbox-test-token";
    delete window.google;
    delete window.__fastTrackGoogleMapsPromise;
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalGoogleKey === undefined) delete process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    else process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY = originalGoogleKey;
    if (originalMapboxToken === undefined) delete process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
    else process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN = originalMapboxToken;
    vi.unstubAllGlobals();
  });

  it("retrieves a selected service address and supports keyboard selection", async () => {
    const onSelect = vi.fn();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        suggestions: [{
          mapbox_id: "address.1",
          name: "7749 Black Horse Court",
          full_address: "7749 Black Horse Court, Manassas, Virginia 20109, United States"
        }]
      }))
      .mockResolvedValueOnce(jsonResponse({
        features: [{
          properties: {
            name: "7749 Black Horse Court",
            full_address: "7749 Black Horse Court, Manassas, VA 20109",
            context: {
              place: { name: "Manassas" },
              region: { region_code: "US-VA" },
              postcode: { name: "20109" }
            }
          }
        }]
      }));
    vi.stubGlobal("fetch", fetchMock);

    render(<AddressHarness onSelect={onSelect} />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "7749 Black" } });
    await flushDebounce();

    expect(screen.getByRole("option", { name: /7749 Black Horse Court/ })).toBeTruthy();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toBeTruthy();
    fireEvent.keyDown(input, { key: "Enter" });
    await flushPromises();

    expect(onSelect).toHaveBeenCalledWith({
      formatted: "7749 Black Horse Court, Manassas, VA 20109",
      addressLine1: "7749 Black Horse Court",
      city: "Manassas",
      state: "VA",
      zip: "20109"
    });
    expect((input as HTMLInputElement).value).toBe("7749 Black Horse Court, Manassas, VA 20109");
    expect(screen.queryByRole("option")).toBeNull();
  });

  it("keeps manual entry usable and explains when no provider is configured", () => {
    process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN = "";
    render(<AddressHarness />);

    const input = screen.getByRole("combobox");
    expect(screen.getByText("Address suggestions are unavailable. You can still enter the address manually.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();

    fireEvent.change(input, { target: { value: "123 Main Street" } });
    expect((input as HTMLInputElement).value).toBe("123 Main Street");
  });

  it("falls back without blocking typing when the provider is down and can retry", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(jsonResponse({
        suggestions: [{ mapbox_id: "address.2", name: "123 Main Street", place_formatted: "Manassas, Virginia 20110" }]
      }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    render(<AddressHarness />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "123 Main" } });
    await flushDebounce();

    expect(screen.getByText("Address suggestions are unavailable. You can still enter the address manually.")).toBeTruthy();
    expect((input as HTMLInputElement).value).toBe("123 Main");

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await flushDebounce();
    expect(screen.getByRole("option", { name: /123 Main Street/ })).toBeTruthy();
  });
});

function AddressHarness({ onSelect }: { onSelect?: (selection: Selection) => void }) {
  const [value, setValue] = useState("");
  return <AddressAutocomplete value={value} onChange={setValue} onSelect={onSelect} />;
}

function jsonResponse(payload: unknown) {
  return { ok: true, json: async () => payload } as Response;
}

async function flushDebounce() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(220);
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}
