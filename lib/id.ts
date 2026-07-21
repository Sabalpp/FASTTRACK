/**
 * Generate a UUID without assuming the page is running in a secure context.
 *
 * Safari does not expose `crypto.randomUUID()` on plain HTTP LAN origins, which
 * are commonly used while testing the technician workflow on an iPad. Use the
 * platform implementation when it exists, then fall back to random bytes, and
 * finally to a timestamp-backed UUID for older browsers.
 */
export function createId(): string {
  const webCrypto = globalThis.crypto;

  if (typeof webCrypto?.randomUUID === "function") {
    return webCrypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof webCrypto?.getRandomValues === "function") {
    webCrypto.getRandomValues(bytes);
  } else {
    const seed = `${Date.now()}-${performanceNow()}-${Math.random()}`;
    for (let index = 0; index < bytes.length; index += 1) {
      const character = seed.charCodeAt(index % seed.length);
      bytes[index] = (character + Math.floor(Math.random() * 256) + index * 17) & 0xff;
    }
  }

  // RFC 4122 version 4 and variant bits.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const value = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function performanceNow(): number {
  return typeof globalThis.performance?.now === "function" ? globalThis.performance.now() : 0;
}
