import { describe, expect, it } from "vitest";
import { resolveBaseUrls } from "@api/lib/base-urls.js";

describe("resolveBaseUrls", () => {
  // Regression: previously baseUrl fell back to localhost when BASE_URL was
  // unset, even if NEWSLETTER_BASE_URL was set — so confirm-email links in
  // prod pointed at http://localhost:3000.
  it("falls back to NEWSLETTER_BASE_URL when BASE_URL is unset", () => {
    const result = resolveBaseUrls({
      NEWSLETTER_BASE_URL: "https://news.vertexcover.io",
    });
    expect(result.baseUrl).toBe("https://news.vertexcover.io");
    expect(result.webBaseUrl).toBe("https://news.vertexcover.io");
  });

  it("uses BASE_URL when set, regardless of NEWSLETTER_BASE_URL", () => {
    const result = resolveBaseUrls({
      BASE_URL: "https://api.example.com",
      NEWSLETTER_BASE_URL: "https://news.example.com",
    });
    expect(result.baseUrl).toBe("https://api.example.com");
    expect(result.webBaseUrl).toBe("https://news.example.com");
  });

  it("falls back to localhost only when both URL vars are unset", () => {
    const result = resolveBaseUrls({});
    expect(result.baseUrl).toBe("http://localhost:3000");
    expect(result.webBaseUrl).toBe("http://localhost:3000");
  });

  it("respects API_PORT in the localhost fallback", () => {
    const result = resolveBaseUrls({ API_PORT: "4000" });
    expect(result.baseUrl).toBe("http://localhost:4000");
    expect(result.webBaseUrl).toBe("http://localhost:4000");
  });
});
