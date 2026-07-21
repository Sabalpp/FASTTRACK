import { describe, expect, it, vi } from "vitest";
import { demoState } from "@/lib/demo-data";
import { compactDemoStateForStorage, persistDemoState } from "@/lib/demo-storage";

describe("demo browser storage", () => {
  it("drops oversized camera payloads before persisting state", () => {
    const state = {
      ...demoState,
      jobPhotos: [
        {
          ...demoState.jobPhotos[0],
          id: "large-photo",
          storagePath: `data:image/jpeg;base64,${"a".repeat(600_000)}`
        },
        ...demoState.jobPhotos
      ]
    };

    const compacted = compactDemoStateForStorage(state);
    expect(compacted.jobPhotos.some((photo) => photo.id === "large-photo")).toBe(false);
    expect(compacted.jobPhotos.some((photo) => photo.storagePath.startsWith("https://"))).toBe(true);
  });

  it("never throws when Safari rejects a localStorage write", () => {
    const storage = { setItem: vi.fn(() => { throw new DOMException("Quota exceeded", "QuotaExceededError"); }) };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(() => persistDemoState(storage, "demo", demoState)).not.toThrow();
    expect(storage.setItem).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("retries without inline media after a quota failure", () => {
    const state = {
      ...demoState,
      jobPhotos: [{ ...demoState.jobPhotos[0], id: "inline", storagePath: "data:image/jpeg;base64,small" }]
    };
    const saved: string[] = [];
    const storage = {
      setItem: vi.fn((_key: string, value: string) => {
        if (saved.length === 0) {
          saved.push(value);
          throw new DOMException("Quota exceeded", "QuotaExceededError");
        }
        saved.push(value);
      })
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(persistDemoState(storage, "demo", state)).toBe(false);
    expect(saved[1]).not.toContain("data:image");
    warn.mockRestore();
  });
});
