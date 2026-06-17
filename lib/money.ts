export function money(value: number | null | undefined): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(Number(value ?? 0));
}

export function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}
