export type UtmSource = "email" | "linkedin" | "twitter";

/**
 * Returns the input URL with `utm_source` set to `source`.
 * Uses the URL API to preserve path, existing query params, and encoding.
 * Inputs are always absolute operator-configured bases.
 */
export function withUtmSource(url: string, source: UtmSource): string {
  const u = new URL(url);
  u.searchParams.set("utm_source", source);
  return u.toString();
}
