/**
 * Error classifier — promoted from `pipeline/services/collector-health/classify.ts`
 * so api, pipeline, and the incident pipeline share one taxonomy.
 *
 * The priority chain (auth > rate-limit > timeout > blocked > schema) is preserved
 * verbatim; `code-bug` is appended as a final pre-`unknown` step: an otherwise
 * unclassified error whose stack has a frame inside our own packages is our bug.
 */
import type { ErrorCategory, Fixability } from "./types.js";
import { topAppFrame } from "./fingerprint.js";

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return String(err);
}

function errStack(err: unknown): string | undefined {
  return err instanceof Error ? err.stack : undefined;
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

/** Classify an error into one category using the deterministic priority chain. */
export function classifyCategory(err: unknown): ErrorCategory {
  if (isAuth(err)) return "auth";
  if (isRateLimit(err)) return "rate-limit";
  if (isTimeout(err)) return "network-timeout";
  if (isBlocked(err)) return "blocked";
  if (isSchema(err)) return "schema";
  if (topAppFrame(errStack(err)) !== undefined) return "code-bug";
  return "unknown";
}

/** Map a category to its resolution lane (design §4). */
export function fixabilityFor(category: ErrorCategory): Fixability {
  switch (category) {
    case "schema":
    case "code-bug":
      return "agent";
    case "auth":
    case "unknown":
      return "human";
    case "rate-limit":
    case "network-timeout":
    case "blocked":
      return "notify";
  }
}

/** Classify an error into `{ category, fixability }`. */
export function classifyError(err: unknown): {
  category: ErrorCategory;
  fixability: Fixability;
} {
  const category = classifyCategory(err);
  return { category, fixability: fixabilityFor(category) };
}
