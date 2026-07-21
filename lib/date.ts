import { ARRIVAL_WINDOW_TIME_ZONE } from "@/lib/arrival-window";

export function formatDateTime(value: string | undefined): string {
  if (!value) return "Not scheduled";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: ARRIVAL_WINDOW_TIME_ZONE
  }).format(new Date(value));
}

export function formatDate(value: string | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: ARRIVAL_WINDOW_TIME_ZONE }).format(new Date(value));
}

export function formatTime(value: string | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: ARRIVAL_WINDOW_TIME_ZONE
  }).format(new Date(value));
}

export function dateInputValue(value: string | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
}
