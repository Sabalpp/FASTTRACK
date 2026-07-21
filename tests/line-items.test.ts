import { describe, expect, it } from "vitest";
import { sameLineItemService } from "@/lib/line-items";

describe("line item identity", () => {
  it("matches catalog services by part ID across estimate options", () => {
    expect(sameLineItemService(
      { partId: "part-1", description: "Old label" },
      { partId: "part-1", description: "Updated label" }
    )).toBe(true);
  });

  it("matches manual services by a normalized exact description", () => {
    expect(sameLineItemService(
      { description: "  Condenser   Coil Replacement " },
      { description: "condenser coil replacement" }
    )).toBe(true);
    expect(sameLineItemService(
      { description: "Condenser coil replacement" },
      { description: "Evaporator coil replacement" }
    )).toBe(false);
  });
});
