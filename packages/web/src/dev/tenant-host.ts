/**
 * Local-dev helper for the Vite `/api` proxy (multi-tenant subdomain serving).
 *
 * In production the API resolves the tenant from the request `Host`
 * (`<slug>.<root>`). In local dev the Vite proxy forwards `/api` with
 * `changeOrigin: true`, which rewrites `Host` to the proxy target
 * (`127.0.0.1`), so the browser's `<slug>.lvh.me` host never reaches the API.
 * To bridge that, the proxy sets the `X-Tenant-Slug` dev-override header
 * (honoured only when `NODE_ENV !== "production"`, see the API's
 * `classifyHost`) from the incoming `*.lvh.me` subdomain.
 *
 * This mirrors the API's slug classification (`config/domains.ts`): only
 * single-label `*.lvh.me` hosts are tenant slugs. `localhost`, loopback IPs,
 * the bare `lvh.me` apex, deeper nesting, and the reserved `app` label all map
 * to the admin/app surface (tenant comes from the session) → no override.
 */
const DEV_ROOT_SUFFIX = ".lvh.me";
/** Mirrors the API's reserved app host: `app.<root>` is never a tenant slug. */
const RESERVED_APP_LABEL = "app";

/** Lowercases and strips the port from a Host header value (`a.b:5173` → `a.b`). */
function normalizeHost(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  const colon = trimmed.indexOf(":");
  return colon === -1 ? trimmed : trimmed.slice(0, colon);
}

/**
 * Returns the dev tenant slug for a `*.lvh.me` Host, or `undefined` when the
 * host is the app surface / not a single-label tenant subdomain.
 */
export function devTenantSlugFromHost(host: string | undefined): string | undefined {
  if (!host) return undefined;
  const normalized = normalizeHost(host);
  if (!normalized.endsWith(DEV_ROOT_SUFFIX)) return undefined;

  const label = normalized.slice(0, -DEV_ROOT_SUFFIX.length);
  // Only single-label subdomains are slugs; bare apex / deeper nesting is not.
  if (!label || label.includes(".")) return undefined;
  if (label === RESERVED_APP_LABEL) return undefined;
  return label;
}
