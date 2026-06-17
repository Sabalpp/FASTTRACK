export function normalizePhone(input: string | null | undefined): string {
  const digits = String(input ?? "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

export function formatPhone(input: string | null | undefined): string {
  const digits = normalizePhone(input);
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return input ?? "";
}
