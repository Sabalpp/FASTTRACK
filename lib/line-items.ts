import type { JobLineItem } from "@/lib/types";

type LineItemIdentity = Pick<JobLineItem, "partId" | "description">;

export function sameLineItemService(left: LineItemIdentity, right: LineItemIdentity) {
  if (left.partId || right.partId) return Boolean(left.partId && left.partId === right.partId);
  return normalizedDescription(left.description) === normalizedDescription(right.description);
}

function normalizedDescription(value: string) {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}
