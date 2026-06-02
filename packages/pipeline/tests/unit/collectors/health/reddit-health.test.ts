import { describe, expect, it, vi } from "vitest";
import { checkRedditHealth, classifyRedditError } from "@pipeline/collectors/health/reddit-health.js";

describe("checkRedditHealth", () => {
  const validRss = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>t3_abc123</id>
    <title>Test Post</title>
    <link href="https://reddit.com/r/test/comments/abc"/>
  </entry>
</feed>`;

  it("returns healthy when RSS returns a valid entry", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(validRss, { status: 200 }));

    const result = await checkRedditHealth({ fetchFn });

    expect(result.collector).toBe("reddit");
    expect(result.status).toBe("healthy");
    expect(result.itemsFound).toBe(1);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("returns healthy with multiple entries", async () => {
    const multiRss = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry><id>t3_1</id><title>Post 1</title></entry>
  <entry><id>t3_2</id><title>Post 2</title></entry>
</feed>`;
    const fetchFn = vi.fn().mockResolvedValue(new Response(multiRss, { status: 200 }));

    const result = await checkRedditHealth({ fetchFn });

    expect(result.status).toBe("healthy");
    expect(result.itemsFound).toBe(2);
  });

  it("returns failed when RSS returns HTTP 500", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("Error", { status: 500 }));

    const result = await checkRedditHealth({ fetchFn });

    expect(result.status).toBe("failed");
    expect(result.error).toBeDefined();
    expect(typeof result.error).toBe("string");
    expect(result.error.length).toBeLessThanOrEqual(200);
  });

  it("returns failed when RSS returns HTTP 403", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("Forbidden", { status: 403 }));

    const result = await checkRedditHealth({ fetchFn });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("access");
  });

  it("returns failed when XML has parsererror", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("<parsererror>Bad XML</parsererror>", { status: 200 }));

    const result = await checkRedditHealth({ fetchFn });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("structure");
  });

  it("returns failed when there are no entry elements", async () => {
    const emptyRss = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom"></feed>`;
    const fetchFn = vi.fn().mockResolvedValue(new Response(emptyRss, { status: 200 }));

    const result = await checkRedditHealth({ fetchFn });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("no valid");
  });

  it("returns failed when entries lack t3_-prefixed ids", async () => {
    const badEntries = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry><id>t2_user</id><title>User not post</title></entry>
</feed>`;
    const fetchFn = vi.fn().mockResolvedValue(new Response(badEntries, { status: 200 }));

    const result = await checkRedditHealth({ fetchFn });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("no valid");
  });

  it("returns failed when fetch throws a network error", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("ENOTFOUND reddit.com"));

    const result = await checkRedditHealth({ fetchFn });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("network");
  });

  it("uses default subreddit and fetch", async () => {
    const result = await checkRedditHealth({});
    expect(result.collector).toBe("reddit");
    expect(["healthy", "failed"]).toContain(result.status);
  });
});

describe("classifyRedditError", () => {
  it("classifies 401/403 as auth errors", () => {
    const msg = classifyRedditError(new Error("Non-retryable HTTP error: 403"));
    expect(msg).toContain("access");
  });

  it("classifies 429 as rate limit", () => {
    const msg = classifyRedditError(new Error("HTTP error: 429"));
    expect(msg).toContain("rate");
  });

  it("classifies 5xx as unreachable", () => {
    const msg = classifyRedditError(new Error("HTTP error: 503"));
    expect(msg).toContain("unreachable");
  });

  it("classifies network errors", () => {
    const msg = classifyRedditError(new Error("fetch failed: ENOTFOUND"));
    expect(msg).toContain("network");
  });

  it("classifies parsererror in XML", () => {
    const msg = classifyRedditError(new Error("Reddit RSS returned invalid XML: parse error"));
    expect(msg).toContain("structure");
  });

  it("returns raw message for unknown errors", () => {
    const msg = classifyRedditError(new Error("something else"));
    expect(msg).toBe("something else");
  });
});
