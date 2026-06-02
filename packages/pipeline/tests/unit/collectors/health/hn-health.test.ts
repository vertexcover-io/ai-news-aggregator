import { describe, expect, it, vi } from "vitest";
import { checkHnHealth, classifyHnError } from "@pipeline/collectors/health/hn-health.js";

describe("checkHnHealth", () => {
  it("returns healthy when Algolia returns a valid story", async () => {
    const json = {
      hits: [
        { objectID: "123", title: "Test Story", url: "https://example.com", points: 10 },
      ],
    };
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify(json), { status: 200 }));

    const result = await checkHnHealth({ fetchFn });

    expect(result.collector).toBe("hn");
    expect(result.status).toBe("healthy");
    expect(result.itemsFound).toBe(1);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.error).toBeUndefined();
  });

  it("returns healthy when Algolia returns multiple valid hits", async () => {
    const json = {
      hits: [
        { objectID: "1", title: "Story 1", url: "https://example.com/1", points: 10 },
        { objectID: "2", title: "Story 2", url: "https://example.com/2", points: 20 },
        { objectID: "3", title: "Story 3", url: "https://example.com/3", points: 30 },
      ],
    };
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify(json), { status: 200 }));

    const result = await checkHnHealth({ fetchFn });

    expect(result.status).toBe("healthy");
    expect(result.itemsFound).toBe(3);
  });

  it("returns failed when Algolia returns HTTP 500", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("Internal Server Error", { status: 500 }));

    const result = await checkHnHealth({ fetchFn });

    expect(result.collector).toBe("hn");
    expect(result.status).toBe("failed");
    expect(result.error).toBeDefined();
    expect(typeof result.error).toBe("string");
    expect(result.error.length).toBeLessThanOrEqual(200);
  });

  it("returns failed when Algolia returns HTTP 403", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("Forbidden", { status: 403 }));

    const result = await checkHnHealth({ fetchFn });

    expect(result.status).toBe("failed");
    // 403 is non-retryable auth error
    expect(result.error).toContain("access");
    expect(typeof result.error).toBe("string");
    expect(result.error.length).toBeLessThanOrEqual(200);
  });

  it("returns failed when the hits array is empty", async () => {
    const json = { hits: [] };
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify(json), { status: 200 }));

    const result = await checkHnHealth({ fetchFn });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("no valid");
    expect(typeof result.error).toBe("string");
    expect(result.error.length).toBeLessThanOrEqual(200);
  });

  it("returns failed when hits lack required fields", async () => {
    const json = {
      hits: [
        { objectID: "1", points: 10 }, // missing title
      ],
    };
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify(json), { status: 200 }));

    const result = await checkHnHealth({ fetchFn });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("no valid");
  });

  it("returns failed when the response body is not valid JSON", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("not json", { status: 200 }));

    const result = await checkHnHealth({ fetchFn });

    expect(result.status).toBe("failed");
    expect(result.error).toBeDefined();
    expect(typeof result.error).toBe("string");
    expect(result.error.length).toBeLessThanOrEqual(200);
  });

  it("returns failed when the network request throws", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED"));

    const result = await checkHnHealth({ fetchFn });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("network");
    expect(typeof result.error).toBe("string");
    expect(result.error.length).toBeLessThanOrEqual(200);
  });

  it("uses default fetch when no fetchFn is provided", async () => {
    // Should not throw — will actually make an HTTP request or fail gracefully
    const result = await checkHnHealth({});
    // Either way it returns a valid HealthCheckResult
    expect(result.collector).toBe("hn");
    expect(["healthy", "failed"]).toContain(result.status);
  });
});

describe("classifyHnError", () => {
  it("classifies HTTP 401/403 as auth errors", () => {
    const msg = classifyHnError(new Error("HTTP error: 403"));
    expect(msg).toContain("access");
  });

  it("classifies HTTP 429 as rate limit errors", () => {
    const msg = classifyHnError(new Error("HTTP error: 429"));
    expect(msg).toContain("rate");
  });

  it("classifies HTTP 5xx as unreachable errors", () => {
    const msg = classifyHnError(new Error("HTTP error: 502"));
    expect(msg).toContain("unreachable");
  });

  it("classifies connection refused as network errors", () => {
    const msg = classifyHnError(new Error("connect ECONNREFUSED"));
    expect(msg).toContain("network");
  });

  it("classifies timeout errors", () => {
    const msg = classifyHnError(new Error("The operation was aborted due to timeout"));
    expect(msg).toContain("timed out");
  });

  it("classifies JSON parse errors", () => {
    const msg = classifyHnError(new SyntaxError("Unexpected token"));
    expect(msg).toContain("response");
  });

  it("returns raw message for unknown errors", () => {
    const msg = classifyHnError(new Error("something unexpected happened"));
    expect(msg).toBe("something unexpected happened");
  });

  it("handles non-Error thrown values", () => {
    const msg = classifyHnError("just a string");
    expect(msg).toBe("just a string");
  });
});
