"use client";

import { useEffect, useId, useMemo, useState } from "react";

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
  const googleKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
  const provider = googleKey ? "google" : mapboxToken ? "mapbox" : "manual";
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const listboxId = useId();
  const sessionToken = useMemo(
    () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now())),
    []
  );

  useEffect(() => {
    if (disabled) {
      setSuggestions([]);
      setOpen(false);
      setBusy(false);
      return;
    }
    const query = value.trim();
    if (query.length < 3 || provider === "manual") {
      setSuggestions([]);
      setBusy(false);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setBusy(true);
      if (provider === "google" && googleKey) {
        void suggestGoogleAddresses(googleKey, query)
          .then((nextSuggestions) => {
            setSuggestions(nextSuggestions);
            setOpen(nextSuggestions.length > 0);
          })
          .catch((error) => {
            if ((error as Error).name !== "AbortError") console.warn("Google address autocomplete failed", error);
            setSuggestions([]);
          })
          .finally(() => setBusy(false));
        return;
      }

      if (provider === "mapbox" && mapboxToken) {
        void suggestMapboxAddresses(mapboxToken, sessionToken, query, controller.signal)
          .then((nextSuggestions) => {
            setSuggestions(nextSuggestions);
            setOpen(nextSuggestions.length > 0);
          })
          .catch((error) => {
            if ((error as Error).name !== "AbortError") console.warn("Mapbox address autocomplete failed", error);
            setSuggestions([]);
          })
          .finally(() => setBusy(false));
      }
    }, 220);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [disabled, googleKey, mapboxToken, provider, sessionToken, value]);

  async function selectSuggestion(suggestion: Suggestion) {
    setOpen(false);

    try {
      const selection = suggestion.provider === "google" && googleKey
        ? await retrieveGoogleAddress(googleKey, suggestion)
        : suggestion.provider === "mapbox" && mapboxToken
          ? await retrieveMapboxAddress(mapboxToken, sessionToken, suggestion)
          : fallbackAddress(suggestion);
      onChange(selection.formatted);
      onSelect?.(selection);
    } catch (error) {
      console.warn("Address retrieve failed", error);
      const fallback = fallbackAddress(suggestion);
      onChange(fallback.formatted);
      onSelect?.(fallback);
    }
  }

  return (
    <div className="address-autocomplete">
      <input
        required={required}
        disabled={disabled}
        value={value}
        placeholder={placeholder ?? (provider === "manual" ? "Street address" : "Start typing an address")}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => {
          if (suggestions.length > 0) setOpen(true);
        }}
        onBlur={() => window.setTimeout(() => setOpen(false), 140)}
        autoComplete="street-address"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={provider !== "manual" && open && suggestions.length > 0}
        aria-controls={provider !== "manual" && suggestions.length > 0 ? listboxId : undefined}
        aria-busy={busy}
      />
      {provider !== "manual" && open && suggestions.length > 0 ? (
        <div className="address-suggestions" id={listboxId} role="listbox" aria-label="Suggested addresses">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion.id}
              type="button"
              role="option"
              aria-selected="false"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void selectSuggestion(suggestion)}
            >
              <strong>{suggestion.name}</strong>
              <span>{suggestion.secondary}</span>
            </button>
          ))}
        </div>
      ) : null}
      {busy ? <span className="address-busy" aria-hidden="true" /> : null}
    </div>
  );
}

async function suggestGoogleAddresses(apiKey: string, query: string): Promise<Suggestion[]> {
  const google = await loadGoogleMaps(apiKey);
  const service = new google.maps.places.AutocompleteService();
  return new Promise((resolve) => {
    service.getPlacePredictions(
      {
        input: query,
        bounds: NOVA_BOUNDS,
        componentRestrictions: { country: "us" },
        types: ["address"]
      },
      (predictions, status) => {
        if (status !== "OK" || !predictions) {
          resolve([]);
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

  window.__fastTrackGoogleMapsPromise = new Promise((resolve, reject) => {
    const callbackName = `__fastTrackMapsReady_${Date.now()}`;
    const callbacks = window as unknown as Record<string, () => void>;
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&loading=async&libraries=places&callback=${callbackName}`;
    script.async = true;
    script.onerror = () => reject(new Error("Google Maps script failed to load."));
    callbacks[callbackName] = () => {
      delete callbacks[callbackName];
      if (!window.google?.maps?.places) reject(new Error("Google Places library did not load."));
      else resolve(window.google);
    };
    document.head.appendChild(script);
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
  const addressLine1 = properties?.address ?? properties?.name ?? suggestion.name;
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
