import type { IncidentCategory } from "../types/incident.js";

/**
 * Compute a stable deduplication fingerprint for an incident.
 *
 * Format: `${category}:${source ?? "_"}:${signature ?? "_"}`
 *
 * The `source` must be a domain or queue name (NEVER a full URL) so that
 * multiple failures on the same domain collapse to one incident (EDGE-007).
 * Callers are responsible for extracting the domain before passing it here.
 */
export function fingerprintFor(
  category: IncidentCategory,
  source?: string,
  signature?: string,
): string {
  return `${category}:${source ?? "_"}:${signature ?? "_"}`;
}
