import { describe, expect, it, vi } from "vitest";
import { checkTwitterHealth, classifyTwitterError } from "@pipeline/collectors/health/twitter-health.js";
import type { TwitterCollectorCookie } from "@pipeline/services/credential-resolver.js";

describe("checkTwitterHealth", () => {
  const validCookie: TwitterCollectorCookie = { apiKey: "test-api-key", source: "env" };

  it("returns skipped when no cookie is resolved", async () => {
    const result = await checkTwitterHealth({ resolveCookie: vi.fn().mockResolvedValue(null) });

    expect(result.collector).toBe("twitter");
    expect(result.status).toBe("skipped");
    expect(result.reason).toContain("API key");
  });

  it("returns healthy when Rettiwt can authenticate", async () => {
    const mockClient = {
      fetchUserTimeline: vi.fn().mockResolvedValue({
        tweets: [{ id: "1", authorHandle: "user", fullText: "hello", createdAt: "2024-01-01", url: "https://x.com/user/1", likeCount: 0, retweetCount: 0, replyCount: 0, quoteCount: 0, photoUrls: [], isRetweet: false, isQuote: false }],
        nextCursor: null,
      }),
    };
    const resolveCookie = vi.fn().mockResolvedValue(validCookie);
    const createClient = vi.fn().mockReturnValue(mockClient);

    const result = await checkTwitterHealth({ resolveCookie, createClient });

    expect(result.status).toBe("healthy");
    expect(result.itemsFound).toBe(1);
  });

  it("returns healthy with multiple tweets", async () => {
    const mockClient = {
      fetchUserTimeline: vi.fn().mockResolvedValue({
        tweets: [
          { id: "1", authorHandle: "u", fullText: "a", createdAt: "2024-01-01", url: "https://x.com/u/1", likeCount: 0, retweetCount: 0, replyCount: 0, quoteCount: 0, photoUrls: [], isRetweet: false, isQuote: false },
          { id: "2", authorHandle: "u", fullText: "b", createdAt: "2024-01-01", url: "https://x.com/u/2", likeCount: 0, retweetCount: 0, replyCount: 0, quoteCount: 0, photoUrls: [], isRetweet: false, isQuote: false },
        ],
        nextCursor: null,
      }),
    };
    const resolveCookie = vi.fn().mockResolvedValue(validCookie);
    const createClient = vi.fn().mockReturnValue(mockClient);

    const result = await checkTwitterHealth({ resolveCookie, createClient });

    expect(result.status).toBe("healthy");
    expect(result.itemsFound).toBe(2);
  });

  it("returns failed when Rettiwt returns 401", async () => {
    const mockClient = {
      fetchUserTimeline: vi.fn().mockRejectedValue(new Error("Not authorized")),
    };
    const resolveCookie = vi.fn().mockResolvedValue(validCookie);
    const createClient = vi.fn().mockReturnValue(mockClient);

    const result = await checkTwitterHealth({ resolveCookie, createClient });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("cookie");
  });

  it("returns failed when fetch throws a network error", async () => {
    const mockClient = {
      fetchUserTimeline: vi.fn().mockRejectedValue(new Error("ETIMEDOUT")),
    };
    const resolveCookie = vi.fn().mockResolvedValue(validCookie);
    const createClient = vi.fn().mockReturnValue(mockClient);

    const result = await checkTwitterHealth({ resolveCookie, createClient });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("network");
  });

  it("returns failed when Rettiwt returns empty tweets array", async () => {
    const mockClient = {
      fetchUserTimeline: vi.fn().mockResolvedValue({ tweets: [], nextCursor: null }),
    };
    const resolveCookie = vi.fn().mockResolvedValue(validCookie);
    const createClient = vi.fn().mockReturnValue(mockClient);

    const result = await checkTwitterHealth({ resolveCookie, createClient });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("no tweets");
  });

  it("returns failed when Rettiwt returns tweets without IDs", async () => {
    const mockClient = {
      fetchUserTimeline: vi.fn().mockResolvedValue({
        tweets: [{ id: "", authorHandle: "user", fullText: "hello" }],
        nextCursor: null,
      }),
    };
    const resolveCookie = vi.fn().mockResolvedValue(validCookie);
    const createClient = vi.fn().mockReturnValue(mockClient);

    const result = await checkTwitterHealth({ resolveCookie, createClient });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("no tweets");
  });

  it("returns failed when resolveCookie throws a decrypt error", async () => {
    const resolveCookie = vi.fn().mockRejectedValue(new Error("decryption failed"));

    const result = await checkTwitterHealth({ resolveCookie });

    expect(result.status).toBe("skipped");
    expect(result.reason).toContain("could not");
    expect(result.reason).toBeDefined();
  });
});

describe("classifyTwitterError", () => {
  it("classifies 401/403 as auth/cookie errors", () => {
    const msg = classifyTwitterError(new Error("Not authorized to access requested resource"));
    expect(msg).toContain("cookie");
  });

  it("classifies network errors", () => {
    const msg = classifyTwitterError(new Error("ETIMEDOUT"));
    expect(msg).toContain("network");
  });

  it("classifies rate limits", () => {
    const msg = classifyTwitterError(new Error("429 Too Many Requests"));
    expect(msg).toContain("rate");
  });

  it("returns raw message for unknown errors", () => {
    const msg = classifyTwitterError(new Error("something unexpected"));
    expect(msg).toBe("something unexpected");
  });
});
