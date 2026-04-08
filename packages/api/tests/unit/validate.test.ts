import { describe, it, expect } from "vitest";
import { runSubmitSchema } from "@api/lib/validate.js";

describe("runSubmitSchema (REQ-002)", () => {
  it("accepts a payload with hn only", () => {
    const result = runSubmitSchema.safeParse({
      topN: 10,
      hn: { sinceDays: 1 },
    });
    expect(result.success).toBe(true);
  });

  it("accepts a payload with reddit only", () => {
    const result = runSubmitSchema.safeParse({
      topN: 10,
      reddit: { subreddits: ["LocalLLaMA"], sinceDays: 1 },
    });
    expect(result.success).toBe(true);
  });

  it("rejects topN: 0", () => {
    const result = runSubmitSchema.safeParse({
      topN: 0,
      hn: { sinceDays: 1 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects topN: 51", () => {
    const result = runSubmitSchema.safeParse({
      topN: 51,
      hn: { sinceDays: 1 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects payload with no source group", () => {
    const result = runSubmitSchema.safeParse({ topN: 10 });
    expect(result.success).toBe(false);
  });

  it("rejects reddit with empty subreddits array", () => {
    const result = runSubmitSchema.safeParse({
      topN: 10,
      reddit: { subreddits: [], sinceDays: 1 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects sinceDays > 30", () => {
    const result = runSubmitSchema.safeParse({
      topN: 10,
      hn: { sinceDays: 31 },
    });
    expect(result.success).toBe(false);
  });

  it("accepts hn feeds, count, and commentsPerItem", () => {
    const result = runSubmitSchema.safeParse({
      topN: 10,
      hn: {
        sinceDays: 3,
        feeds: ["newest", "best"],
        count: 50,
        commentsPerItem: 10,
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects hn feeds with an unknown value", () => {
    const result = runSubmitSchema.safeParse({
      topN: 10,
      hn: { sinceDays: 3, feeds: ["trending"] },
    });
    expect(result.success).toBe(false);
  });

  it("rejects hn feeds as an empty array", () => {
    const result = runSubmitSchema.safeParse({
      topN: 10,
      hn: { sinceDays: 3, feeds: [] },
    });
    expect(result.success).toBe(false);
  });

  it("rejects hn count > 1000", () => {
    const result = runSubmitSchema.safeParse({
      topN: 10,
      hn: { sinceDays: 3, count: 1001 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects hn commentsPerItem > 100", () => {
    const result = runSubmitSchema.safeParse({
      topN: 10,
      hn: { sinceDays: 3, commentsPerItem: 101 },
    });
    expect(result.success).toBe(false);
  });

  it("accepts hn commentsPerItem = 0 (disabled)", () => {
    const result = runSubmitSchema.safeParse({
      topN: 10,
      hn: { sinceDays: 3, commentsPerItem: 0 },
    });
    expect(result.success).toBe(true);
  });

  it("accepts a payload with web only", () => {
    const result = runSubmitSchema.safeParse({
      topN: 10,
      web: {
        sources: [
          { name: "Anthropic", listingUrl: "https://www.anthropic.com/research" },
        ],
        maxItems: 5,
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts a web payload with optional sinceDays", () => {
    const result = runSubmitSchema.safeParse({
      topN: 10,
      web: {
        sources: [{ name: "OpenAI", listingUrl: "https://openai.com/blog" }],
        maxItems: 5,
        sinceDays: 14,
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects web with empty sources array", () => {
    const result = runSubmitSchema.safeParse({
      topN: 10,
      web: { sources: [], maxItems: 5 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects web source with invalid listingUrl", () => {
    const result = runSubmitSchema.safeParse({
      topN: 10,
      web: {
        sources: [{ name: "Anthropic", listingUrl: "not-a-url" }],
        maxItems: 5,
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects web source with empty name", () => {
    const result = runSubmitSchema.safeParse({
      topN: 10,
      web: {
        sources: [{ name: "", listingUrl: "https://example.com" }],
        maxItems: 5,
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects web maxItems > 100", () => {
    const result = runSubmitSchema.safeParse({
      topN: 10,
      web: {
        sources: [{ name: "X", listingUrl: "https://example.com" }],
        maxItems: 101,
      },
    });
    expect(result.success).toBe(false);
  });
});
