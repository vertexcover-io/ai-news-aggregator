import { describe, it, expect } from "vitest";
import {
  runSubmitSchema,
  userSettingsUpsertSchema,
  archivePatchSchema,
  addPostSchema,
} from "@api/lib/validate.js";

const validSettings = {
  topN: 10,
  halfLifeHours: null,
  hnConfig: { sinceDays: 1 },
  redditConfig: null,
  webConfig: null,
  scheduleTime: "09:30",
  scheduleTimezone: "America/New_York",
  scheduleEnabled: true,
};

describe("userSettingsUpsertSchema (REQ-012/REQ-013/EDGE-004)", () => {
  it("accepts a valid payload", () => {
    const r = userSettingsUpsertSchema.safeParse(validSettings);
    expect(r.success).toBe(true);
  });

  it("REQ-013: rejects scheduleEnabled=true with all sources null", () => {
    const r = userSettingsUpsertSchema.safeParse({
      ...validSettings,
      hnConfig: null,
      redditConfig: null,
      webConfig: null,
    });
    expect(r.success).toBe(false);
  });

  it("accepts scheduleEnabled=false with all sources null", () => {
    const r = userSettingsUpsertSchema.safeParse({
      ...validSettings,
      hnConfig: null,
      redditConfig: null,
      webConfig: null,
      scheduleEnabled: false,
    });
    expect(r.success).toBe(true);
  });

  it("rejects scheduleTime that is not HH:MM", () => {
    const r = userSettingsUpsertSchema.safeParse({
      ...validSettings,
      scheduleTime: "9:30",
    });
    expect(r.success).toBe(false);
  });

  it("rejects scheduleTime out-of-range hours/minutes", () => {
    expect(
      userSettingsUpsertSchema.safeParse({ ...validSettings, scheduleTime: "24:00" }).success,
    ).toBe(false);
    expect(
      userSettingsUpsertSchema.safeParse({ ...validSettings, scheduleTime: "12:60" }).success,
    ).toBe(false);
  });

  it("EDGE-004: rejects invalid IANA timezone 'GMT+5'", () => {
    const r = userSettingsUpsertSchema.safeParse({
      ...validSettings,
      scheduleTimezone: "GMT+5",
    });
    expect(r.success).toBe(false);
  });

  it("rejects topN out of range", () => {
    expect(
      userSettingsUpsertSchema.safeParse({ ...validSettings, topN: 0 }).success,
    ).toBe(false);
    expect(
      userSettingsUpsertSchema.safeParse({ ...validSettings, topN: 51 }).success,
    ).toBe(false);
  });

  it("rejects halfLifeHours = 0 or negative", () => {
    expect(
      userSettingsUpsertSchema.safeParse({ ...validSettings, halfLifeHours: 0 })
        .success,
    ).toBe(false);
    expect(
      userSettingsUpsertSchema.safeParse({ ...validSettings, halfLifeHours: -1 })
        .success,
    ).toBe(false);
  });
});

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

describe("archivePatchSchema (REQ-160 – REQ-162, EDGE-110)", () => {
  it("accepts a non-empty rankedItems list", () => {
    const r = archivePatchSchema.safeParse({
      rankedItems: [
        { id: 1, sourceType: "hn" },
        { id: 2, sourceType: "reddit" },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("REQ-162: rejects an empty list", () => {
    const r = archivePatchSchema.safeParse({ rankedItems: [] });
    expect(r.success).toBe(false);
  });

  it("EDGE-110: rejects duplicate ids", () => {
    const r = archivePatchSchema.safeParse({
      rankedItems: [
        { id: 1, sourceType: "hn" },
        { id: 1, sourceType: "hn" },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("rejects items missing required fields", () => {
    const r = archivePatchSchema.safeParse({
      rankedItems: [{ id: 1 }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects non-integer ids", () => {
    const r = archivePatchSchema.safeParse({
      rankedItems: [{ id: 1.5, sourceType: "hn" }],
    });
    expect(r.success).toBe(false);
  });

  it("accepts item with only id + sourceType (no optional fields)", () => {
    const r = archivePatchSchema.safeParse({
      rankedItems: [{ id: 1, sourceType: "hn" }],
    });
    expect(r.success).toBe(true);
  });

  it("accepts item with all new optional fields", () => {
    const r = archivePatchSchema.safeParse({
      rankedItems: [
        {
          id: 1,
          sourceType: "hn",
          summary: "A summary",
          bullets: ["Point A", "Point B"],
          bottomLine: "The bottom line",
          imageUrl: "https://example.com/img.png",
        },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("accepts item with imageUrl = null", () => {
    const r = archivePatchSchema.safeParse({
      rankedItems: [
        {
          id: 1,
          sourceType: "hn",
          imageUrl: null,
        },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("rejects item missing id", () => {
    const r = archivePatchSchema.safeParse({
      rankedItems: [{ sourceType: "hn" }],
    });
    expect(r.success).toBe(false);
  });
});

describe("addPostSchema (REQ-024, REQ-144)", () => {
  it("accepts a valid URL payload", () => {
    const r = addPostSchema.safeParse({
      url: "https://example.com/post",
    });
    expect(r.success).toBe(true);
  });

  it("accepts HN URL", () => {
    const r = addPostSchema.safeParse({
      url: "https://news.ycombinator.com/item?id=12345",
    });
    expect(r.success).toBe(true);
  });

  it("REQ-024: rejects empty body {}", () => {
    const r = addPostSchema.safeParse({});
    expect(r.success).toBe(false);
  });

  it("REQ-024: rejects empty string url", () => {
    const r = addPostSchema.safeParse({ url: "" });
    expect(r.success).toBe(false);
  });

  it("REQ-144: rejects malformed url", () => {
    const r = addPostSchema.safeParse({ url: "not-a-url" });
    expect(r.success).toBe(false);
  });

  it("EDGE-022: ignores extra sourceType field (zod strips unknowns)", () => {
    const r = addPostSchema.safeParse({
      url: "https://example.com",
      sourceType: "hn",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).not.toHaveProperty("sourceType");
    }
  });
});
