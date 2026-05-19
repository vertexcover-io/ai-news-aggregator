export function formatCostUsd(value: number | null): string {
  if (value === null) return "?";
  return `$${value.toFixed(3)}`;
}

export function formatTokens(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  return value.toLocaleString("en-US");
}
