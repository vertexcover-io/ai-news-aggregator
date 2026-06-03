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

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return String(err);
}

function errStatus(err: unknown): number | undefined {
  if (typeof err === "object" && err !== null && "status" in err) {
    const s = (err as { status: unknown }).status;
    if (typeof s === "number") return s;
  }
  return undefined;
}

function isAuth(err: unknown): boolean {
  const status = errStatus(err);
  if (status === 401 || status === 403) return true;
  const msg = errMessage(err);
  if (/not authorized/i.test(msg)) return true;
  if (/invalid authentication/i.test(msg)) return true;
  return false;
}

function isRateLimit(err: unknown): boolean {
  if (errStatus(err) === 429) return true;
  const msg = errMessage(err);
  if (msg.includes("429")) return true;
  if (/rate.?limit/i.test(msg)) return true;
  return false;
}

function isTimeout(err: unknown): boolean {
  if (err instanceof Error && err.name === "AbortError") return true;
  const msg = errMessage(err);
  if (/timed?\s*out|timeout|ETIMEDOUT/i.test(msg)) return true;
  return false;
}

function isBlocked(err: unknown): boolean {
  const msg = errMessage(err);
  if (/ECONNREFUSED|ENOTFOUND|ECONNRESET/i.test(msg)) return true;
  if (/fetch failed/i.test(msg)) return true;
  return false;
}

function isSchema(err: unknown): boolean {
  if (err instanceof Error && err.name === "ZodError") return true;
  const msg = errMessage(err);
  if (/ZodError/i.test(msg)) return true;
  if (/invalid\s+(?:shape|payload|response|xml)/i.test(msg)) return true;
  if (/unexpected\s+shape/i.test(msg)) return true;
  return false;
}

/** Returns the internal classification token (for equality checks and structured logs). */
export function classifyCollectorHealthToken(
  _collector: CheckableCollector,
  err: unknown,
): ClassifiedToken {
  // Priority: auth > rate-limit > timeout > blocked > schema > unknown
  if (isAuth(err)) return "auth";
  if (isRateLimit(err)) return "rate-limit";
  if (isTimeout(err)) return "network-timeout";
  if (isBlocked(err)) return "blocked";
  if (isSchema(err)) return "schema";
  return "unknown";
}

/** Returns a concise human-readable reason for display in the UI and Slack messages. */
export function classifyCollectorHealthError(
  collector: CheckableCollector,
  err: unknown,
): string {
  const token = classifyCollectorHealthToken(collector, err);
  return HUMAN_REASONS[token];
}
