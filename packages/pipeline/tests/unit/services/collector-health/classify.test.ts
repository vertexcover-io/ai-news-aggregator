import { describe, it, expect } from "vitest";
import { classifyCollectorHealthError } from "@pipeline/services/collector-health/classify.js";

// Classifier table test with an edge-case matrix:
// auth / rate-limit / timeout / network / schema / unknown
// per collector type
// Asserts human-readable phrases (REQ-006: "concise reason" surfaced to operator/Slack).

describe("classifyCollectorHealthError", () => {
  // ─── auth errors ───────────────────────────────────────────────────
  it("classifies 401 status as auth phrase", () => {
    const err = Object.assign(new Error("Unauthorized"), { status: 401 });
    expect(classifyCollectorHealthError("hn", err)).toBe("auth — check credentials");
  });

  it("classifies 403 status as auth phrase", () => {
    const err = Object.assign(new Error("Forbidden"), { status: 403 });
    expect(classifyCollectorHealthError("twitter", err)).toBe("auth — check credentials");
  });

  it("classifies 'not authorized' message as auth phrase (case insensitive)", () => {
    const err = new Error("Not authorized to access requested resource");
    expect(classifyCollectorHealthError("reddit", err)).toBe("auth — check credentials");
  });

  it("classifies 'Not Authorized' message as auth phrase for blog collector", () => {
    const err = new Error("Not Authorized");
    expect(classifyCollectorHealthError("blog", err)).toBe("auth — check credentials");
  });

  // ─── rate-limit errors ─────────────────────────────────────────────
  it("classifies 429 status as rate-limit phrase", () => {
    const err = Object.assign(new Error("Too Many Requests"), { status: 429 });
    expect(classifyCollectorHealthError("hn", err)).toBe("rate limited by the source");
  });

  it("classifies message containing '429' as rate-limit phrase", () => {
    const err = new Error("HTTP error: 429");
    expect(classifyCollectorHealthError("web_search", err)).toBe("rate limited by the source");
  });

  it("classifies 'rate limit exceeded' message as rate-limit phrase (case insensitive)", () => {
    const err = new Error("Rate Limit Exceeded");
    expect(classifyCollectorHealthError("twitter", err)).toBe("rate limited by the source");
  });

  it("classifies 'rate limit' in message as rate-limit phrase", () => {
    const err = new Error("Tavily search failed: rate_limit_exceeded");
    expect(classifyCollectorHealthError("web_search", err)).toBe("rate limited by the source");
  });

  // ─── timeout errors ────────────────────────────────────────────────
  it("classifies AbortError as network-timeout phrase", () => {
    const err = new Error("The operation was aborted");
    err.name = "AbortError";
    expect(classifyCollectorHealthError("blog", err)).toBe("network timeout");
  });

  it("classifies 'timed out' message as network-timeout phrase", () => {
    const err = new Error("Request timed out after 35000ms");
    expect(classifyCollectorHealthError("blog", err)).toBe("network timeout");
  });

  it("classifies 'timeout' message as network-timeout phrase", () => {
    const err = new Error("Operation timeout");
    expect(classifyCollectorHealthError("hn", err)).toBe("network timeout");
  });

  it("classifies 'ETIMEDOUT' as network-timeout phrase", () => {
    const err = new Error("connect ETIMEDOUT 1.2.3.4:443");
    expect(classifyCollectorHealthError("reddit", err)).toBe("network timeout");
  });

  // ─── blocked / network errors ──────────────────────────────────────
  it("classifies 'ECONNREFUSED' as blocked phrase", () => {
    const err = new Error("connect ECONNREFUSED 127.0.0.1:80");
    expect(classifyCollectorHealthError("blog", err)).toBe("request blocked (egress/IP)");
  });

  it("classifies 403 (non-auth context) as auth phrase for blog (status-403 → auth wins)", () => {
    // 403 on a web crawl may mean IP-blocked, but the classifier maps status 403 → auth
    // (auth is higher-priority than blocked in the classification chain)
    const err = Object.assign(new Error("Forbidden"), { status: 403 });
    expect(classifyCollectorHealthError("blog", err)).toBe("auth — check credentials");
  });

  it("classifies ENOTFOUND as blocked phrase (DNS failure)", () => {
    const err = new Error("getaddrinfo ENOTFOUND hn.algolia.com");
    expect(classifyCollectorHealthError("hn", err)).toBe("request blocked (egress/IP)");
  });

  it("classifies 'fetch failed' with no extra context as blocked phrase", () => {
    const err = new Error("fetch failed");
    expect(classifyCollectorHealthError("reddit", err)).toBe("request blocked (egress/IP)");
  });

  // ─── schema errors ─────────────────────────────────────────────────
  it("classifies ZodError as schema phrase", () => {
    const err = new Error("ZodError: invalid shape");
    err.name = "ZodError";
    expect(classifyCollectorHealthError("hn", err)).toBe("unexpected response shape");
  });

  it("classifies 'invalid shape' message as schema phrase", () => {
    const err = new Error("HN API returned invalid shape");
    expect(classifyCollectorHealthError("hn", err)).toBe("unexpected response shape");
  });

  it("classifies 'invalid XML' as schema phrase", () => {
    const err = new Error("Reddit RSS returned invalid XML");
    expect(classifyCollectorHealthError("reddit", err)).toBe("unexpected response shape");
  });

  it("classifies 'unexpected shape' message as schema phrase", () => {
    const err = new Error("Algolia returned unexpected shape");
    expect(classifyCollectorHealthError("hn", err)).toBe("unexpected response shape");
  });

  // ─── unknown fallback ──────────────────────────────────────────────
  it("classifies unrecognized error as unknown phrase", () => {
    const err = new Error("Something completely unexpected happened");
    expect(classifyCollectorHealthError("hn", err)).toBe("unexpected error");
  });

  it("classifies non-Error as unknown phrase", () => {
    expect(classifyCollectorHealthError("hn", "some string error")).toBe("unexpected error");
  });

  it("classifies null as unknown phrase", () => {
    expect(classifyCollectorHealthError("twitter", null)).toBe("unexpected error");
  });

  // ─── priority check: auth wins over rate-limit on 403 ──────────────
  it("auth classification takes priority over rate-limit when both signals present", () => {
    // A message like "Not authorized: rate limit" should classify as auth (auth checked first)
    const err = new Error("Not authorized: rate limit exceeded");
    expect(classifyCollectorHealthError("twitter", err)).toBe("auth — check credentials");
  });
});
