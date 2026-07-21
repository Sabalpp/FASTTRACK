import { afterEach, describe, expect, it, vi } from "vitest";
import { createId } from "@/lib/id";

const originalCrypto = globalThis.crypto;

afterEach(() => {
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: originalCrypto });
  vi.restoreAllMocks();
});

describe("createId", () => {
  it("uses the browser UUID implementation when available", () => {
    const randomUUID = vi.fn(() => "11111111-1111-4111-8111-111111111111" as `${string}-${string}-${string}-${string}-${string}`);
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: { randomUUID }
    });

    expect(createId()).toBe("11111111-1111-4111-8111-111111111111");
    expect(randomUUID).toHaveBeenCalledOnce();
  });

  it("creates a valid version-four UUID without randomUUID", () => {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: {
        getRandomValues(bytes: Uint8Array) {
          bytes.fill(18);
          return bytes;
        }
      }
    });

    expect(createId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("still creates an id when Web Crypto is unavailable", () => {
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: undefined });

    expect(createId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
