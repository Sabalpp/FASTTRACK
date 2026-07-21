"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createId } from "@/lib/id";

type AddressSelection = {
  formatted: string;
  addressLine1: string;
  city: string;
  state: string;
  zip: string;
};

type Suggestion = {
  id: string;
  provider: "google" | "mapbox";
  name: string;
  secondary?: string;
  mapboxId?: string;
  placeId?: string;
  fullAddress?: string;
  placeFormatted?: string;
};

type MapboxSuggestResponse = {
  suggestions?: Array<{
    mapbox_id: string;
    name: string;
    full_address?: string;
    place_formatted?: string;
  }>;
};

type MapboxFeature = {
  properties?: {
    name?: string;
    address?: string;
    full_address?: string;
    context?: {
      place?: { name?: string };
      locality?: { name?: string };
      district?: { name?: string };
      region?: { name?: string; region_code?: string };
      postcode?: { name?: string };
    };
  };
};

type MapboxRetrieveResponse = {
  features?: MapboxFeature[];
};

type GoogleAddressComponent = {
  long_name: string;
  short_name: string;
  types: string[];
};

type GooglePrediction = {
  place_id: string;
  description: string;
  structured_formatting?: {
    main_text?: string;
    secondary_text?: string;
  };
};

type GooglePlaceResult = {
  name?: string;
  formatted_address?: string;
  address_components?: GoogleAddressComponent[];
};

type GooglePlacesStatus = "OK" | "ZERO_RESULTS" | string;
type AddressProvider = Suggestion["provider"] | "manual";
type SearchStatus = "idle" | "loading" | "results" | "empty" | "unavailable";

type GoogleMapsApi = {
  maps: {
    places: {
      AutocompleteService: new () => {
        getPlacePredictions: (
          request: {
            input: string;
            bounds?: { north: number; south: number; east: number; west: number };
            componentRestrictions?: { country: string };
            types?: string[];
          },
          callback: (predictions: GooglePrediction[] | null, status: GooglePlacesStatus) => void
        ) => void;
      };
      PlacesService: new (element: HTMLDivElement) => {
        getDetails: (
          request: { placeId: string; fields: string[] },
          callback: (place: GooglePlaceResult | null, status: GooglePlacesStatus) => void
        ) => void;
      };
    };
  };
};

const NOVA_BOUNDS = {
  north: 39.18,
  south: 38.48,
  east: -76.86,
  west: -77.92
};

declare global {
  interface Window {
    google?: GoogleMapsApi;
    __fastTrackGoogleMapsPromise?: Promise<GoogleMapsApi>;
  }
}

export function AddressAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder,
  required,
  disabled = false
}: {
  value: string;
  onChange: (value: string) => void;
  onSelect?: (selection: AddressSelection) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const googleKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim();
  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN?.trim();
  const configuredProvider: AddressProvider = googleKey ? "google" : mapboxToken ? "mapbox" : "manual";
  const [provider, setProvider] = useState<AddressProvider>(configuredProvider);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [searchStatus, setSearchStatus] = useState<SearchStatus>(configuredProvider === "manual" ? "unavailable" : "idle");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [retryNonce, setRetryNonce] = useState(0);
  const listboxId = useId();
  const statusId = useId();
  const sessionToken = useMemo(() => createId(), []);
  const skipSearchValuesRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setProvider(configuredProvider);
    setSearchStatus(configuredProvider === "manual" ? "unavailable" : "idle");
  }, [configuredProvider]);

  useEffect(() => {
    if (disabled) {
      setSuggestions([]);
      setOpen(false);
      setBusy(false);
      setActiveIndex(-1);
      setSearchStatus("idle");
      return;
    }

    const query = value.trim();
    if (skipSearchValuesRef.current.has(query)) {
      skipSearchValuesRef.current.clear();
      setSuggestions([]);
      setOpen(false);
      setBusy(false);
      setActiveIndex(-1);
      setSearchStatus("idle");
      return;
    }

    if (query.length < 3 || provider === "manual") {
      setSuggestions([]);
      setOpen(false);
      setBusy(false);
      setActiveIndex(-1);
      setSearchStatus(provider === "manual" ? "unavailable" : "idle");
      return;
    }

    const controller = new AbortController();
    let active = true;
    const timeout = window.setTimeout(() => {
      setBusy(true);
      setSearchStatus("loading");
      if (provider === "google" && googleKey) {
        void suggestGoogleAddresses(googleKey, query)
          .then((nextSuggestions) => {
            if (!active) return;
            setSuggestions(nextSuggestions);
            setOpen(nextSuggestions.length > 0);
            setActiveIndex(-1);
            setSearchStatus(nextSuggestions.length > 0 ? "results" : "empty");
          })
          .catch((error) => {
            if (!active || (error as Error).name === "AbortError") return;
            console.warn("Google address suggestions are unavailable.");
            setSuggestions([]);
            setOpen(false);
            setActiveIndex(-1);
            if (mapboxToken) {
              setProvider("mapbox");
              setSearchStatus("loading");
            } else {
              setSearchStatus("unavailable");
            }
          })
          .finally(() => {
            if (active) setBusy(false);
          });
        return;
      }

      if (provider === "mapbox" && mapboxToken) {
        void suggestMapboxAddresses(mapboxToken, sessionToken, query, controller.signal)
          .then((nextSuggestions) => {
            if (!active) return;
            setSuggestions(nextSuggestions);
            setOpen(nextSuggestions.length > 0);
            setActiveIndex(-1);
            setSearchStatus(nextSuggestions.length > 0 ? "results" : "empty");
          })
          .catch((error) => {
            if (!active || (error as Error).name === "AbortError") return;
            console.warn("Address suggestions are unavailable.");
            setSuggestions([]);
            setOpen(false);
            setActiveIndex(-1);
            setSearchStatus("unavailable");
          })
          .finally(() => {
            if (active) setBusy(false);
          });
      }
    }, 220);

    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [disabled, googleKey, mapboxToken, provider, retryNonce, sessionToken, value]);

  async function selectSuggestion(suggestion: Suggestion) {
    setOpen(false);
    setActiveIndex(-1);

    try {
      const selection = suggestion.provider === "google" && googleKey
        ? await retrieveGoogleAddress(googleKey, suggestion)
        : suggestion.provider === "mapbox" && mapboxToken
          ? await retrieveMapboxAddress(mapboxToken, sessionToken, suggestion)
          : fallbackAddress(suggestion);
      skipSearchValuesRef.current = new Set([selection.formatted.trim(), selection.addressLine1.trim()]);
      onChange(selection.formatted);
      onSelect?.(selection);
      setSuggestions([]);
      setSearchStatus("idle");
    } catch (error) {
      console.warn("The selected address could not be fully retrieved; using its displayed address.");
      const fallback = fallbackAddress(suggestion);
      skipSearchValuesRef.current = new Set([fallback.formatted.trim(), fallback.addressLine1.trim()]);
      onChange(fallback.formatted);
      onSelect?.(fallback);
      setSuggestions([]);
      setSearchStatus("idle");
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
      return;
    }

    if (suggestions.length === 0 || (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Enter")) return;

    if (event.key === "Enter") {
      if (!open || activeIndex < 0) return;
      event.preventDefault();
      void selectSuggestion(suggestions[activeIndex]);
      return;
    }

    event.preventDefault();
    setOpen(true);
    setActiveIndex((current) => {
      if (event.key === "ArrowDown") return current >= suggestions.length - 1 ? 0 : current + 1;
      return current <= 0 ? suggestions.length - 1 : current - 1;
    });
  }

  const statusMessage = searchStatus === "loading"
    ? "Finding matching addresses…"
    : searchStatus === "empty"
      ? "No matching address found. Keep typing or enter it manually."
      : searchStatus === "unavailable"
        ? "Address suggestions are unavailable. You can still enter the address manually."
        : undefined;

  return (
    <div className="address-autocomplete">
      <input
        required={required}
        disabled={disabled}
        value={value}
        placeholder={placeholder ?? (provider === "manual" ? "Street address" : "Start typing an address")}
        onChange={(event) => {
          setOpen(false);
          setActiveIndex(-1);
          onChange(event.target.value);
        }}
        onFocus={() => {
          if (suggestions.length > 0) setOpen(true);
        }}
        onBlur={() => window.setTimeout(() => setOpen(false), 140)}
        onKeyDown={handleKeyDown}
        autoComplete="street-address"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open && suggestions.length > 0}
        aria-controls={suggestions.length > 0 ? listboxId : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
        aria-describedby={statusMessage ? statusId : undefined}
        aria-busy={busy}
      />
      {provider !== "manual" && open && suggestions.length > 0 ? (
        <div className="address-suggestions" id={listboxId} role="listbox" aria-label="Suggested addresses">
          {suggestions.map((suggestion, index) => (
            <button
              key={suggestion.id}
              id={`${listboxId}-option-${index}`}
              type="button"
              role="option"
              aria-selected={activeIndex === index}
              className={activeIndex === index ? "active" : undefined}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => void selectSuggestion(suggestion)}
            >
              <strong>{suggestion.name}</strong>
              <span>{suggestion.secondary}</span>
            </button>
          ))}
        </div>
      ) : null}
      {busy ? <span className="address-busy" aria-hidden="true" /> : null}
      {statusMessage ? (
        <div className={`address-status ${searchStatus === "unavailable" ? "is-warning" : ""}`} id={statusId} role="status" aria-live="polite">
          <span>{statusMessage}</span>
          {searchStatus === "unavailable" && configuredProvider !== "manual" ? (
            <button
              type="button"
              onClick={() => {
                setProvider(configuredProvider);
                setSearchStatus("idle");
                setRetryNonce((current) => current + 1);
              }}
            >
              Try again
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

async function suggestGoogleAddresses(apiKey: string, query: string): Promise<Suggestion[]> {
  const google = await loadGoogleMaps(apiKey);
  const service = new google.maps.places.AutocompleteService();
  return new Promise((resolve, reject) => {
    service.getPlacePredictions(
      {
        input: query,
        bounds: NOVA_BOUNDS,
        componentRestrictions: { country: "us" },
        types: ["address"]
      },
      (predictions, status) => {
        if (status === "ZERO_RESULTS") {
          resolve([]);
          return;
        }
        if (status !== "OK" || !predictions) {
          reject(new Error("Address suggestions are unavailable."));
          return;
        }

        resolve(predictions.slice(0, 5).map((prediction) => ({
          id: prediction.place_id,
          provider: "google",
          placeId: prediction.place_id,
          name: prediction.structured_formatting?.main_text ?? prediction.description,
          secondary: prediction.structured_formatting?.secondary_text ?? prediction.description
        })));
      }
    );
  });
}

async function retrieveGoogleAddress(apiKey: string, suggestion: Suggestion): Promise<AddressSelection> {
  if (!suggestion.placeId) return fallbackAddress(suggestion);
  const google = await loadGoogleMaps(apiKey);
  const service = new google.maps.places.PlacesService(document.createElement("div"));
  return new Promise((resolve, reject) => {
    service.getDetails(
      { placeId: suggestion.placeId!, fields: ["address_components", "formatted_address", "name"] },
      (place, status) => {
        if (status !== "OK" || !place) {
          reject(new Error("Google place details failed."));
          return;
        }
        resolve(parseGoogleAddress(place, suggestion));
      }
    );
  });
}

function loadGoogleMaps(apiKey: string): Promise<GoogleMapsApi> {
  if (window.google?.maps?.places) return Promise.resolve(window.google);
  if (window.__fastTrackGoogleMapsPromise) return window.__fastTrackGoogleMapsPromise;

  const loader = new Promise<GoogleMapsApi>((resolve, reject) => {
    const callbackName = `__fastTrackMapsReady_${Date.now()}`;
    const callbacks = window as unknown as Record<string, () => void>;
    const script = document.createElement("script");
    let settled = false;
    const cleanup = () => {
      window.clearTimeout(timeout);
      delete callbacks[callbackName];
    };
    const fail = () => {
      if (settled) return;
      settled = true;
      cleanup();
      script.remove();
      reject(new Error("Google Places could not be loaded."));
    };
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&loading=async&libraries=places&callback=${callbackName}`;
    script.async = true;
    script.dataset.fastTrackGoogleMaps = "true";
    script.onerror = fail;
    callbacks[callbackName] = () => {
      if (settled) return;
      if (!window.google?.maps?.places) {
        fail();
        return;
      }
      settled = true;
      cleanup();
      resolve(window.google);
    };
    const timeout = window.setTimeout(fail, 10_000);
    document.head.appendChild(script);
  });

  window.__fastTrackGoogleMapsPromise = loader.catch((error) => {
    window.__fastTrackGoogleMapsPromise = undefined;
    throw error;
  });

  return window.__fastTrackGoogleMapsPromise;
}

async function suggestMapboxAddresses(token: string, sessionToken: string, query: string, signal: AbortSignal): Promise<Suggestion[]> {
  const url = new URL("https://api.mapbox.com/search/searchbox/v1/suggest");
  url.searchParams.set("q", query);
  url.searchParams.set("access_token", token);
  url.searchParams.set("session_token", sessionToken);
  url.searchParams.set("country", "US");
  url.searchParams.set("types", "address");
  url.searchParams.set("limit", "5");
  url.searchParams.set("language", "en");
  url.searchParams.set("proximity", "-77.45,38.85");

  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error("Address search failed.");
  const payload = await response.json() as MapboxSuggestResponse;
  return (payload.suggestions ?? []).map((suggestion) => ({
    id: suggestion.mapbox_id,
    provider: "mapbox",
    mapboxId: suggestion.mapbox_id,
    name: suggestion.name,
    secondary: suggestion.full_address ?? suggestion.place_formatted,
    fullAddress: suggestion.full_address,
    placeFormatted: suggestion.place_formatted
  }));
}

async function retrieveMapboxAddress(token: string, sessionToken: string, suggestion: Suggestion): Promise<AddressSelection> {
  if (!suggestion.mapboxId) return fallbackAddress(suggestion);
  const url = new URL(`https://api.mapbox.com/search/searchbox/v1/retrieve/${suggestion.mapboxId}`);
  url.searchParams.set("access_token", token);
  url.searchParams.set("session_token", sessionToken);
  const response = await fetch(url);
  if (!response.ok) throw new Error("Address retrieve failed.");
  const payload = await response.json() as MapboxRetrieveResponse;
  return parseMapboxAddress(payload.features?.[0], suggestion);
}

function parseGoogleAddress(place: GooglePlaceResult, suggestion: Suggestion): AddressSelection {
  const components = place.address_components ?? [];
  const streetNumber = component(components, "street_number", "short_name");
  const route = component(components, "route", "long_name");
  const addressLine1 = [streetNumber, route].filter(Boolean).join(" ") || place.name || suggestion.name;
  const city = component(components, "locality", "long_name")
    || component(components, "sublocality", "long_name")
    || component(components, "administrative_area_level_3", "long_name")
    || "";
  const state = component(components, "administrative_area_level_1", "short_name").toUpperCase();
  const zip = component(components, "postal_code", "short_name");
  const formatted = place.formatted_address ?? [addressLine1, city, state, zip].filter(Boolean).join(", ");
  return { formatted, addressLine1, city, state, zip };
}

function parseMapboxAddress(feature: MapboxFeature | undefined, suggestion: Suggestion): AddressSelection {
  const properties = feature?.properties;
  const context = properties?.context;
  const addressLine1 = properties?.name ?? properties?.address ?? suggestion.name;
  const city = context?.place?.name ?? context?.locality?.name ?? context?.district?.name ?? "";
  const state = (context?.region?.region_code ?? context?.region?.name ?? "").replace(/^US-/, "").toUpperCase();
  const zip = context?.postcode?.name ?? "";
  const formatted = properties?.full_address ?? suggestion.fullAddress ?? [addressLine1, city, state, zip].filter(Boolean).join(", ");
  return { formatted, addressLine1, city, state, zip };
}

function component(components: GoogleAddressComponent[], type: string, field: "long_name" | "short_name") {
  return components.find((candidate) => candidate.types.includes(type))?.[field] ?? "";
}

function fallbackAddress(suggestion: Suggestion): AddressSelection {
  const formatted = suggestion.fullAddress ?? [suggestion.name, suggestion.placeFormatted ?? suggestion.secondary].filter(Boolean).join(", ");
  return {
    formatted,
    addressLine1: suggestion.name,
    city: "",
    state: "",
    zip: ""
  };
}
