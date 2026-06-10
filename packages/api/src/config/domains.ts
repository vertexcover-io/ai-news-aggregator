/**
 * Domain and host configuration for multi-tenant routing.
 *
 * All values are read from environment with sensible defaults for local
 * development (lvh.me wildcard DNS). In production, these MUST be set.
 */

/** The root domain that tenant slugs are subdomains of. */
export const ROOT_DOMAIN =
  process.env.ROOT_DOMAIN ?? process.env.NODE_ENV === "production"
    ? (() => { throw new Error("ROOT_DOMAIN is required in production"); })()
    : "lvh.me";

/** The app host for the admin/signup surface (e.g. "app.vertexcover.io"). */
export const APP_HOST =
  process.env.APP_HOST ?? process.env.NODE_ENV === "production"
    ? (() => { throw new Error("APP_HOST is required in production"); })()
    : `app.${ROOT_DOMAIN}`;

/** Hardcoded custom domain -> tenant identifier map.
 * Example: { "agentloop.io": "CUSTOM_TENANT_0" }.
 * CUSTOM_TENANT_0 is a sentinel that the resolver recognizes and routes to the
 * tenant with slug "agentloop" (the first tenant / AGENTLOOP).
 */
export const CUSTOM_DOMAIN_MAP: Record<string, string> =
  parseCustomDomainMap(process.env.CUSTOM_DOMAIN_MAP);

function parseCustomDomainMap(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  const map: Record<string, string> = {};
  for (const entry of raw.split(",")) {
    const [domain, value] = entry.split("=");
    if (domain && value) {
      map[domain.trim()] = value.trim();
    }
  }
  return map;
}

/** Sentinel value in CUSTOM_DOMAIN_MAP signifying tenant 0 (AGENTLOOP). */
export const CUSTOM_TENANT_0_SENTINEL = "CUSTOM_TENANT_0";
