/**
 * Client-side host classification for routing (mirrors the API's
 * `config/domains.ts`). The SPA is served from the same bundle on every host,
 * so the router must decide synchronously, from the URL alone, whether it is on:
 *
 *   - the "app" surface  → the platform itself (apex / `app.<root>` / loopback):
 *                          serve the product landing at `/`.
 *   - a "tenant" surface  → a tenant's `<slug>.<root>` or verified custom domain:
 *                          serve that tenant's public newsletter `HomePage` at `/`
 *                          (unchanged from the single-tenant behaviour).
 *
 * The API is the authoritative classifier (it 404s public content on the app
 * host and fences tenant hosts); this is only the front-of-house routing choice,
 * so a misclassified custom domain degrades to an empty page, never a data leak.
 *
 * Detection is URL-derived. The root domain is taken from the build-time
 * `VITE_PUBLIC_ROOT_DOMAIN` (set in the deploy workflow) so apex/`app.<root>`
 * match exactly and arbitrary custom domains default to "tenant". Loopback and
 * `*.lvh.me` keep local dev working without any env.
 */
export type HostSurface = "app" | "tenant";

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
]);

/** Local-dev root: `app.lvh.me` / `lvh.me` are the app surface, `<slug>.lvh.me` a tenant. */
const DEV_ROOT_DOMAIN = "lvh.me";

/** Lowercases and strips the port / IPv6 brackets from a hostname. */
function normalizeHost(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    return end === -1 ? trimmed : trimmed.slice(1, end);
  }
  const colon = trimmed.indexOf(":");
  return colon === -1 ? trimmed : trimmed.slice(0, colon);
}

function configuredRootDomain(): string {
  const root = import.meta.env.VITE_PUBLIC_ROOT_DOMAIN as string | undefined;
  // The wizard default ("ourdomain.com") is a placeholder, not a real host:
  // treat it as "unset" so we fall back to the structural heuristics below.
  if (root === undefined || root === "" || root === "ourdomain.com") {
    return "";
  }
  return normalizeHost(root);
}

function configuredAppHost(): string {
  const appHost = import.meta.env.VITE_APP_HOST as string | undefined;
  return appHost !== undefined && appHost !== "" ? normalizeHost(appHost) : "";
}

/** Classifies a hostname as the app surface or a tenant surface. */
export function hostSurfaceFor(hostname: string): HostSurface {
  const host = normalizeHost(hostname);
  if (host === "") return "tenant";
  if (LOOPBACK_HOSTS.has(host)) return "app";

  // Local dev: lvh.me apex + reserved `app` label are the app surface.
  if (host === DEV_ROOT_DOMAIN || host === `app.${DEV_ROOT_DOMAIN}`) {
    return "app";
  }

  const appHost = configuredAppHost();
  if (appHost && host === appHost) return "app";

  const root = configuredRootDomain();
  if (root) {
    // Apex and the reserved `app.<root>` are the app surface; everything else
    // under the root is a tenant slug, and unrelated hosts (custom domains)
    // default to tenant.
    if (host === root || host === `app.${root}`) return "app";
    return "tenant";
  }

  // No configured root domain (e.g. a misconfigured build): fall back to the
  // structural signal that the reserved `app` label can never be a tenant slug.
  if (host.startsWith("app.")) return "app";
  return "tenant";
}

/** The surface for the current browser location (SSR-safe default: "tenant"). */
export function currentHostSurface(): HostSurface {
  if (typeof window === "undefined") return "tenant";
  return hostSurfaceFor(window.location.hostname);
}

/** True on the platform app surface (apex / `app.<root>` / loopback). */
export function isAppSurface(): boolean {
  return currentHostSurface() === "app";
}
