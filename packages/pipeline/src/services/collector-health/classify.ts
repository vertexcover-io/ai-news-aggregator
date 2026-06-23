import { classifyCategory } from "@newsletter/shared/errors";

type CheckableCollector = "hn" | "reddit" | "twitter" | "blog" | "web_search";

/** Internal token for equality checks (e.g. Twitter auth branch in index.ts) */
export type ClassifiedToken = "auth" | "rate-limit" | "network-timeout" | "blocked" | "schema" | "unknown";

const HUMAN_REASONS: Record<ClassifiedToken, string> = {
  "auth": "auth — check credentials",
  "rate-limit": "rate limited by the source",
  "network-timeout": "network timeout",
  "blocked": "request blocked (egress/IP)",
  "schema": "unexpected response shape",
  "unknown": "unexpected error",
};

/**
 * Returns the internal classification token (for equality checks and structured logs).
 *
 * Delegates to the shared classifier (`@newsletter/shared/errors`) so the whole
 * system shares one taxonomy. The shared classifier adds a `code-bug` category
 * for errors originating in our own stack frames; collector-health has no such
 * token, so it maps to `unknown` — exactly where those errors landed before the
 * shared classifier existed.
 */
export function classifyCollectorHealthToken(
  _collector: CheckableCollector,
  err: unknown,
): ClassifiedToken {
  const category = classifyCategory(err);
  return category === "code-bug" ? "unknown" : category;
}

/** Returns a concise human-readable reason for display in the UI and Slack messages. */
export function classifyCollectorHealthError(
  collector: CheckableCollector,
  err: unknown,
): string {
  const token = classifyCollectorHealthToken(collector, err);
  return HUMAN_REASONS[token];
}
