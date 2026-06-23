/**
 * Host-classification configuration for the host→tenant resolver (P5,
 * REQ-020/021/022). Everything comes from env so deploys re-point domains
 * without code changes:
 *
 *   ROOT_DOMAIN        apex under which tenant sites live (`<slug>.<root>`),
 *                      e.g. "agentloop.live"
 *   APP_HOST           comma-separated hosts treated as the admin/signup
 *                      surface (REQ-020). Defaults to `app.<ROOT_DOMAIN>`.
 *                      Loopback hosts (localhost/127.0.0.1) are always
 *                      app-class so local dev and liveness probes keep working.
 *   CUSTOM_DOMAIN_MAP  comma-separated `host=slug` pairs — the hardcoded
 *                      custom-domain→tenant map (REQ-022; AGENTLOOP's domain
 *                      maps to the tenant-0 slug).
 *
 * Dev overrides (any NODE_ENV except "production"): the `X-Tenant-Slug`
 * request header and `*.lvh.me` subdomains target a tenant without real DNS.
 */
export interface DomainConfig {
  /** Domains whose single-label subdomains are tenant slugs (REQ-021). */
  rootDomains: readonly string[];
  /** Hosts classified as the admin/signup surface — never Host-resolved (REQ-020). */
  appHosts: ReadonlySet<string>;
  /** Custom domain → tenant slug (REQ-022). */
  customDomainMap: ReadonlyMap<string, string>;
  /** Allow `X-Tenant-Slug` header + `*.lvh.me` (local dev only). */
  allowDevOverrides: boolean;
}

const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "::1"] as const;
const DEV_ROOT_DOMAIN = "lvh.me";

/** Lowercases and strips the port from a Host header value (`a.b:3000` → `a.b`). */
export function normalizeHost(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.startsWith("[")) {
    // Bracketed IPv6 literal, e.g. "[::1]:3000".
    const end = trimmed.indexOf("]");
    return end === -1 ? trimmed : trimmed.slice(1, end);
  }
  const colon = trimmed.indexOf(":");
  return colon === -1 ? trimmed : trimmed.slice(0, colon);
}

export function loadDomainConfig(
  env: Record<string, string | undefined>,
): DomainConfig {
  const allowDevOverrides = env.NODE_ENV !== "production";
  const rootDomain = normalizeHost(env.ROOT_DOMAIN ?? "");

  const rootDomains: string[] = [];
  if (rootDomain) rootDomains.push(rootDomain);
  if (allowDevOverrides) rootDomains.push(DEV_ROOT_DOMAIN);

  const appHosts = new Set<string>(LOOPBACK_HOSTS);
  const explicitAppHosts = (env.APP_HOST ?? "")
    .split(",")
    .map(normalizeHost)
    .filter((host) => host.length > 0);
  for (const host of explicitAppHosts) appHosts.add(host);
  if (explicitAppHosts.length === 0 && rootDomain) {
    appHosts.add(`app.${rootDomain}`);
  }
  if (allowDevOverrides) appHosts.add(`app.${DEV_ROOT_DOMAIN}`);

  const customDomainMap = new Map<string, string>();
  for (const pair of (env.CUSTOM_DOMAIN_MAP ?? "").split(",")) {
    const separator = pair.indexOf("=");
    if (separator === -1) continue;
    const host = normalizeHost(pair.slice(0, separator));
    const slug = pair.slice(separator + 1).trim().toLowerCase();
    if (host && slug) customDomainMap.set(host, slug);
  }

  return { rootDomains, appHosts, customDomainMap, allowDevOverrides };
}
