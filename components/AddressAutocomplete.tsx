"use client";

import { useEffect, useMemo, useState } from "react";

type AddressSelection = {
  formatted: string;
  addressLine1: string;
  city: string;
  state: string;
  zip: string;
};

type Suggestion = {
  mapbox_id: string;
  name: string;
  full_address?: string;
  place_formatted?: string;
};

type SuggestResponse = {
  suggestions?: Suggestion[];
};

type RetrieveFeature = {
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

type RetrieveResponse = {
  features?: RetrieveFeature[];
};

export function AddressAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder,
  required
}: {
  value: string;
  onChange: (value: string) => void;
  onSelect?: (selection: AddressSelection) => void;
  placeholder?: string;
  required?: boolean;
}) {
  const token = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const sessionToken = useMemo(
    () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now())),
    []
  );

  useEffect(() => {
    const query = value.trim();
    if (!token || query.length < 3) {
      setSuggestions([]);
      setBusy(false);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setBusy(true);
      const url = new URL("https://api.mapbox.com/search/searchbox/v1/suggest");
      url.searchParams.set("q", query);
      url.searchParams.set("access_token", token);
      url.searchParams.set("session_token", sessionToken);
      url.searchParams.set("country", "US");
      url.searchParams.set("types", "address");
      url.searchParams.set("limit", "5");
      url.searchParams.set("language", "en");

      fetch(url, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() as Promise<SuggestResponse> : Promise.reject(new Error("Address search failed."))))
        .then((payload) => {
          setSuggestions(payload.suggestions ?? []);
          setOpen(true);
        })
        .catch((error) => {
          if ((error as Error).name !== "AbortError") {
            console.warn("Address autocomplete failed", error);
            setSuggestions([]);
          }
        })
        .finally(() => setBusy(false));
    }, 220);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [sessionToken, token, value]);

  async function selectSuggestion(suggestion: Suggestion) {
    if (!token) return;
    setOpen(false);

    try {
      const url = new URL(`https://api.mapbox.com/search/searchbox/v1/retrieve/${suggestion.mapbox_id}`);
      url.searchParams.set("access_token", token);
      url.searchParams.set("session_token", sessionToken);
      const response = await fetch(url);
      if (!response.ok) throw new Error("Address retrieve failed.");
      const payload = await response.json() as RetrieveResponse;
      const feature = payload.features?.[0];
      const selection = parseRetrievedAddress(feature, suggestion);
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
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => {
          if (suggestions.length > 0) setOpen(true);
        }}
        onBlur={() => window.setTimeout(() => setOpen(false), 140)}
        autoComplete="street-address"
      />
      {token && open && suggestions.length > 0 ? (
        <div className="address-suggestions" role="listbox">
          {suggestions.map((suggestion) => (
            <button key={suggestion.mapbox_id} type="button" onMouseDown={() => void selectSuggestion(suggestion)}>
              <strong>{suggestion.name}</strong>
              <span>{suggestion.full_address ?? suggestion.place_formatted}</span>
            </button>
          ))}
        </div>
      ) : null}
      {busy ? <span className="address-busy" aria-hidden="true" /> : null}
    </div>
  );
}

function parseRetrievedAddress(feature: RetrieveFeature | undefined, suggestion: Suggestion): AddressSelection {
  const properties = feature?.properties;
  const context = properties?.context;
  const addressLine1 = properties?.address ?? properties?.name ?? suggestion.name;
  const city = context?.place?.name ?? context?.locality?.name ?? context?.district?.name ?? "";
  const state = (context?.region?.region_code ?? context?.region?.name ?? "").replace(/^US-/, "").toUpperCase();
  const zip = context?.postcode?.name ?? "";
  const formatted = properties?.full_address ?? suggestion.full_address ?? [addressLine1, city, state, zip].filter(Boolean).join(", ");

  return {
    formatted,
    addressLine1,
    city,
    state,
    zip
  };
}

function fallbackAddress(suggestion: Suggestion): AddressSelection {
  const formatted = suggestion.full_address ?? [suggestion.name, suggestion.place_formatted].filter(Boolean).join(", ");
  return {
    formatted,
    addressLine1: suggestion.name,
    city: "",
    state: "",
    zip: ""
  };
}
