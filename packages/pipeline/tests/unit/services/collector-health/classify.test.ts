import { describe, it, expect } from "vitest";
import { classifyCollectorHealthError } from "@pipeline/services/collector-health/classify.js";
import type { CheckableCollector } from "@pipeline/services/collector-health/index.js";

// Classifier table test with an edge-case matrix:
// auth / rate-limit / timeout / network / schema / unknown
// per collector type
// Asserts human-readable phrases (REQ-006: "concise reason" surfaced to operator/Slack).

interface ErrorCase {
  name: string;
  collector: CheckableCollector;
  message: string;
  status?: number;
  errName?: string;
  expected: string;
}

const ERROR_CASES: ErrorCase[] = [
  // ─── auth errors ───────────────────────────────────────────────────
  { name: "401 status → auth", collector: "hn", message: "Unauthorized", status: 401, expected: "auth — check credentials" },
  { name: "403 status → auth", collector: "twitter", message: "Forbidden", status: 403, expected: "auth — check credentials" },
  { name: "'not authorized' message → auth (case insensitive)", collector: "reddit", message: "Not authorized to access requested resource", expected: "auth — check credentials" },
  { name: "'Not Authorized' message → auth (blog)", collector: "blog", message: "Not Authorized", expected: "auth — check credentials" },
  // ─── rate-limit errors ─────────────────────────────────────────────
  { name: "429 status → rate-limit", collector: "hn", message: "Too Many Requests", status: 429, expected: "rate limited by the source" },
  { name: "message containing '429' → rate-limit", collector: "web_search", message: "HTTP error: 429", expected: "rate limited by the source" },
  { name: "'rate limit exceeded' → rate-limit (case insensitive)", collector: "twitter", message: "Rate Limit Exceeded", expected: "rate limited by the source" },
  { name: "'rate limit' in message → rate-limit", collector: "web_search", message: "Tavily search failed: rate_limit_exceeded", expected: "rate limited by the source" },
  // ─── timeout errors ────────────────────────────────────────────────
  { name: "AbortError → network-timeout", collector: "blog", message: "The operation was aborted", errName: "AbortError", expected: "network timeout" },
  { name: "'timed out' message → network-timeout", collector: "blog", message: "Request timed out after 35000ms", expected: "network timeout" },
  { name: "'timeout' message → network-timeout", collector: "hn", message: "Operation timeout", expected: "network timeout" },
  { name: "'ETIMEDOUT' → network-timeout", collector: "reddit", message: "connect ETIMEDOUT 1.2.3.4:443", expected: "network timeout" },
  // ─── blocked / network errors ──────────────────────────────────────
  { name: "'ECONNREFUSED' → blocked", collector: "blog", message: "connect ECONNREFUSED 127.0.0.1:80", expected: "request blocked (egress/IP)" },
  // 403 on a web crawl may mean IP-blocked, but status 403 → auth (auth wins over blocked)
  { name: "403 (non-auth context, blog) → auth (status-403 → auth wins)", collector: "blog", message: "Forbidden", status: 403, expected: "auth — check credentials" },
  { name: "ENOTFOUND → blocked (DNS failure)", collector: "hn", message: "getaddrinfo ENOTFOUND hn.algolia.com", expected: "request blocked (egress/IP)" },
  { name: "'fetch failed' with no extra context → blocked", collector: "reddit", message: "fetch failed", expected: "request blocked (egress/IP)" },
  // ─── schema errors ─────────────────────────────────────────────────
  { name: "ZodError → schema", collector: "hn", message: "ZodError: invalid shape", errName: "ZodError", expected: "unexpected response shape" },
  { name: "'invalid shape' message → schema", collector: "hn", message: "HN API returned invalid shape", expected: "unexpected response shape" },
  { name: "'invalid XML' → schema", collector: "reddit", message: "Reddit RSS returned invalid XML", expected: "unexpected response shape" },
  { name: "'unexpected shape' message → schema", collector: "hn", message: "Algolia returned unexpected shape", expected: "unexpected response shape" },
  // ─── unknown fallback ──────────────────────────────────────────────
  { name: "unrecognized error → unknown", collector: "hn", message: "Something completely unexpected happened", expected: "unexpected error" },
  // ─── priority check: auth wins over rate-limit on both signals ──────
  { name: "auth takes priority over rate-limit when both signals present", collector: "twitter", message: "Not authorized: rate limit exceeded", expected: "auth — check credentials" },
];

describe("classifyCollectorHealthError — Error inputs", () => {
  it.each(ERROR_CASES)("$name", ({ collector, message, status, errName, expected }) => {
    const err = new Error(message);
    if (errName !== undefined) err.name = errName;
    const withStatus = status === undefined ? err : Object.assign(err, { status });
    expect(classifyCollectorHealthError(collector, withStatus)).toBe(expected);
  });
});

describe("classifyCollectorHealthError — non-Error inputs", () => {
  it.each([
    { name: "non-Error string → unknown", collector: "hn" as const, value: "some string error" as unknown },
    { name: "null → unknown", collector: "twitter" as const, value: null as unknown },
  ])("$name", ({ collector, value }) => {
    expect(classifyCollectorHealthError(collector, value)).toBe("unexpected error");
  });
});
