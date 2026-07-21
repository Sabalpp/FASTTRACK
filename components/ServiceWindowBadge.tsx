import { StatusPill } from "@/components/ui";
import { getServiceWindowTiming } from "@/lib/service-window";
import type { Job } from "@/lib/types";

export function ServiceWindowBadge({ job, now }: { job: Job; now?: number }) {
  const timing = getServiceWindowTiming(job, now);
  return <StatusPill tone={timing.tone}>{timing.label}</StatusPill>;
}
