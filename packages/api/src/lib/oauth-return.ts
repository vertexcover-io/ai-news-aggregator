/**
 * OAuth `returnTo` sanitiser (Fix #2).
 *
 * The OAuth start routes accept an optional `returnTo` so the session-less
 * callback can send the browser back to the surface the connect started from
 * — `/admin/settings` (default) or `/admin/onboarding` (the wizard). Since this
 * value drives a server-issued redirect, it MUST be locked down to a
 * same-origin admin path to prevent an open redirect: only bare relative paths
 * under `/admin` are allowed; anything else falls back to the default.
 */
const DEFAULT_RETURN_TO = "/admin/settings";

export function sanitizeReturnTo(raw: string | undefined): string {
  if (raw === undefined || raw === "") {
    return DEFAULT_RETURN_TO;
  }
  // Reject protocol-relative (`//host`) and absolute (`scheme:`) URLs — only a
  // bare same-origin path may pass. A query/hash would collide with the
  // callback's own `?platform=` param, so require a clean path too.
  if (
    raw.startsWith("//") ||
    /^[a-z][a-z0-9+.-]*:/i.test(raw) ||
    raw.includes("?") ||
    raw.includes("#")
  ) {
    return DEFAULT_RETURN_TO;
  }
  if (raw === "/admin" || raw.startsWith("/admin/")) {
    return raw;
  }
  return DEFAULT_RETURN_TO;
}
