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
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY = "public-google-fallback-test-key";
    const onSelect = vi.fn();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        features: [{
          id: "address.1",
          geometry: { coordinates: [-77.4753, 38.7509] },
          properties: {
            mapbox_id: "address.1",
            name: "7749 Black Horse Court",
            place_formatted: "Manassas, Virginia 20109, United States",
            full_address: "7749 Black Horse Court, Manassas, Virginia 20109, United States",
            context: {
              place: { name: "Manassas" },
              region: { name: "Virginia", region_code: "US-VA" },
              postcode: { name: "20109" }
            }
          }
        }]
      }))
      .mockResolvedValueOnce(jsonResponse({
        features: [{
          id: "address.1",
          properties: {
            mapbox_id: "address.1",
            name: "7749 Black Horse Court",
            full_address: "7749 Black Horse Court, Manassas, Virginia 20109, United States",
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
    expect(screen.getByRole("link", { name: /address search powered by Mapbox/i })).toBeTruthy();
    const map = screen.getByRole("img", { name: /map showing the suggested addresses/i }) as HTMLImageElement;
    expect(map.src).toContain("api.mapbox.com/styles/v1/mapbox/streets-v12/static/geojson");
    expect(map.src).toContain("access_token=public-mapbox-test-token");
    const suggestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(suggestUrl.pathname).toBe("/search/geocode/v6/forward");
    expect(suggestUrl.searchParams.get("q")).toBe("7749 Black");
    expect(suggestUrl.searchParams.get("country")).toBe("us");
    expect(suggestUrl.searchParams.get("types")).toBe("address");
    expect(suggestUrl.searchParams.get("proximity")).toBe("-77.45,38.85");
    expect(suggestUrl.searchParams.get("autocomplete")).toBe("true");
    expect(suggestUrl.searchParams.get("permanent")).toBe("false");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toBeTruthy();
    fireEvent.keyDown(input, { key: "Enter" });
    await flushPromises();

    expect(onSelect).toHaveBeenCalledWith({
      formatted: "7749 Black Horse Court, Manassas, Virginia 20109, United States",
      addressLine1: "7749 Black Horse Court",
      city: "Manassas",
      state: "VA",
      zip: "20109"
    });
    expect((input as HTMLInputElement).value).toBe("7749 Black Horse Court, Manassas, Virginia 20109, United States");
    const selectionUrl = new URL(String(fetchMock.mock.calls[1]?.[0]));
    expect(selectionUrl.pathname).toBe("/search/geocode/v6/forward");
    expect(selectionUrl.searchParams.get("q")).toBe("address.1");
    expect(selectionUrl.searchParams.get("autocomplete")).toBe("false");
    expect(selectionUrl.searchParams.get("permanent")).toBe("true");
    expect(screen.queryByRole("option")).toBeNull();
  });

  it("waits for three characters and the debounce before searching", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ features: [] }));
    vi.stubGlobal("fetch", fetchMock);

    render(<AddressHarness />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "12" } });
    await flushDebounce();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "123" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(249);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledOnce();
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
        features: [{
          id: "address.2",
          properties: {
            mapbox_id: "address.2",
            name: "123 Main Street",
            place_formatted: "Manassas, Virginia 20110, United States",
            full_address: "123 Main Street, Manassas, Virginia 20110, United States"
          }
        }]
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
    const option = screen.getByRole("option", { name: /123 Main Street/ });
    expect(option).toBeTruthy();
  });

  it("keeps typed text and does not persist a temporary result when exact retrieval fails", async () => {
    const onSelect = vi.fn();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        features: [{
          id: "address.touch",
          properties: {
            mapbox_id: "address.touch",
            name: "123 Main Street",
            place_formatted: "Manassas, Virginia 20110, United States",
            full_address: "123 Main Street, Manassas, Virginia 20110, United States",
            context: {
              place: { name: "Manassas" },
              region: { region_code: "US-VA" },
              postcode: { name: "20110" }
            }
          }
        }]
      }))
      .mockRejectedValueOnce(new Error("selection lookup offline"));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    render(<AddressHarness onSelect={onSelect} />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "123 Main" } });
    await flushDebounce();
    const option = screen.getByRole("option", { name: /123 Main Street/ });
    fireEvent.pointerDown(option, { pointerType: "touch" });
    fireEvent.click(option);
    await flushPromises();

    expect(onSelect).not.toHaveBeenCalled();
    expect((input as HTMLInputElement).value).toBe("123 Main");
    expect(screen.getByText("Address suggestions are unavailable. You can still enter the address manually.")).toBeTruthy();
  });

  it("uses the existing Google provider only as a fallback when Mapbox is unavailable", async () => {
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY = "public-google-fallback-test-key";
    const predictionRequest = vi.fn();
    class AutocompleteService {
      getPlacePredictions(
        request: unknown,
        callback: (predictions: Array<{
          place_id: string;
          description: string;
          structured_formatting: { main_text: string; secondary_text: string };
        }> | null, status: string) => void
      ) {
        predictionRequest(request);
        callback([{
          place_id: "google-place-1",
          description: "123 Main Street, Manassas, VA",
          structured_formatting: { main_text: "123 Main Street", secondary_text: "Manassas, VA" }
        }], "OK");
      }
    }
    class PlacesService {
      getDetails() {
        // Selection is not needed for this fallback assertion.
      }
    }
    Object.defineProperty(window, "google", {
      configurable: true,
      writable: true,
      value: { maps: { places: { AutocompleteService, PlacesService } } }
    });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("mapbox offline")));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    render(<AddressHarness />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "123 Main" } });
    await flushDebounce();
    await flushDebounce();

    expect(screen.getByRole("option", { name: /123 Main Street/ })).toBeTruthy();
    expect(predictionRequest).toHaveBeenCalledWith(expect.objectContaining({
      componentRestrictions: { country: "us" },
      types: ["address"]
    }));
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
    await vi.advanceTimersByTimeAsync(250);
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
