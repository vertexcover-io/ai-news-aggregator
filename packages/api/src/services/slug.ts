export type SlugValidation = "available-shape" | "invalid";

const RESERVED = new Set([
  "app",
  "www",
  "admin",
  "api",
  "mail",
  "smtp",
  "ftp",
  "blog",
  "help",
  "support",
  "status",
  "assets",
  "static",
  "cdn",
  "docs",
]);

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MIN_LENGTH = 3;
const MAX_LENGTH = 63;

export function isReserved(slug: string): boolean {
  return RESERVED.has(slug);
}

export function validateSlug(slug: string): SlugValidation {
  if (slug.length < MIN_LENGTH || slug.length > MAX_LENGTH) return "invalid";
  if (!SLUG_RE.test(slug)) return "invalid";
  if (isReserved(slug)) return "invalid";
  return "available-shape";
}
