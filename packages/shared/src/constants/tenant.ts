/**
 * Reserved words that can never be claimed as a tenant slug (REQ-033 / EDGE-003).
 * Slugs become subdomains (`<slug>.<root>`), so anything that collides with
 * infrastructure hostnames, app routes, or brand-sensitive words is blocked.
 * Consumed by slug validation (onboarding wizard) and host resolution.
 */
export const RESERVED_TENANT_SLUGS = [
  // infrastructure / DNS
  "www",
  "api",
  "app",
  "cdn",
  "static",
  "assets",
  "mail",
  "smtp",
  "imap",
  "pop",
  "mx",
  "ns",
  "ns1",
  "ns2",
  "ftp",
  "vpn",
  "proxy",
  "localhost",
  // product surfaces / routes
  "admin",
  "dashboard",
  "settings",
  "login",
  "logout",
  "signup",
  "register",
  "auth",
  "oauth",
  "archive",
  "archives",
  "sources",
  "subscribe",
  "unsubscribe",
  "newsletter",
  "digest",
  "preview",
  "status",
  "health",
  // company / support
  "docs",
  "help",
  "support",
  "blog",
  "about",
  "contact",
  "legal",
  "terms",
  "privacy",
  "security",
  "billing",
  "pricing",
  // brand
  "agentloop",
  "vertexcover",
] as const;

const RESERVED_TENANT_SLUG_SET: ReadonlySet<string> = new Set(RESERVED_TENANT_SLUGS);

export const isReservedTenantSlug = (slug: string): boolean =>
  RESERVED_TENANT_SLUG_SET.has(slug.toLowerCase());

/**
 * Slug format (REQ-033): lowercase alphanumeric + hyphens, no leading/trailing
 * hyphen, max 63 chars (DNS label limit — slugs become subdomains).
 */
export const TENANT_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Format check only — reserved-word policy is `isReservedTenantSlug`. */
export const isValidTenantSlugFormat = (slug: string): boolean =>
  TENANT_SLUG_PATTERN.test(slug);

/**
 * Slug of tenant 0 — the migrated AGENTLOOP tenant (P2 backfill). Used to
 * derive `isTenantZero` branding (REQ-042) and as the app-host/dev fallback
 * tenant for public branding. Reserved above, so no other tenant can take it.
 */
export const TENANT_ZERO_SLUG = "agentloop";
