import { describe, it, expect } from "vitest";
import {
  runSubmitSchema,
  userSettingsUpsertSchema,
  archivePatchSchema,
  addPostSchema,
  regenerateDigestMetaSchema,
} from "@api/lib/validate.js";

const validSettings = {
  topN: 10,
  halfLifeHours: null,
  hnEnabled: true,
  hnConfig: { sinceDays: 1 },
  redditEnabled: false,
  redditConfig: null,
  webEnabled: false,
  webConfig: null,
  twitterEnabled: false,
  twitterConfig: null,
  scheduleTime: "09:30",
  scheduleTimezone: "America/New_York",
  scheduleEnabled: true,
  rankingPrompt: "Default ranking prompt for tests",
  shortlistPrompt: "Default shortlist prompt for tests",
  shortlistSize: 30,
};

describe("userSettingsUpsertSchema (REQ-012/REQ-013/EDGE-004)", () => {
  it("accepts a valid payload", () => {
    const r = userSettingsUpsertSchema.safeParse(validSettings);
    expect(r.success).toBe(true);
  });

  it("REQ-013: rejects scheduleEnabled=true with all sources null", () => {
    const r = userSettingsUpsertSchema.safeParse({
      ...validSettings,
      hnEnabled: false,
      hnConfig: null,
      redditEnabled: false,
      redditConfig: null,
      webEnabled: false,
      webConfig: null,
      twitterEnabled: false,
      twitterConfig: null,
      });
    expect(r.success).toBe(false);
  });

  it("rejects scheduleEnabled=true when configs exist but all sources are disabled", () => {
    const r = userSettingsUpsertSchema.safeParse({
      ...validSettings,
      hnEnabled: false,
      redditEnabled: false,
      redditConfig: { subreddits: ["LocalLLaMA"], sinceDays: 1 },
      webEnabled: false,
      twitterEnabled: false,
    });
    expect(r.success).toBe(false);
  });

  it("rejects an enabled source when its config is null", () => {
    const r = userSettingsUpsertSchema.safeParse({
      ...validSettings,
      hnEnabled: true,
      hnConfig: null,
    });
    expect(r.success).toBe(false);
  });

  it("derives enabled flags from config presence when older clients omit them", () => {
    const r = userSettingsUpsertSchema.safeParse({
      topN: 10,
      halfLifeHours: null,
      hnConfig: { sinceDays: 1 },
      redditConfig: null,
      webConfig: null,
      twitterConfig: null,
      scheduleTime: "09:30",
      scheduleTimezone: "America/New_York",
      scheduleEnabled: true,
      rankingPrompt: "Default ranking prompt for tests",
      shortlistPrompt: "Default shortlist prompt for tests",
      shortlistSize: 30,
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.hnEnabled).toBe(true);
    expect(r.data.redditEnabled).toBe(false);
  });

  it("accepts scheduleEnabled=false with all sources null", () => {
    const r = userSettingsUpsertSchema.safeParse({
      ...validSettings,
      hnEnabled: false,
      hnConfig: null,
      redditEnabled: false,
      redditConfig: null,
      webEnabled: false,
      webConfig: null,
      twitterEnabled: false,
      twitterConfig: null,
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

describe("userSettingsUpsertSchema twitterConfig (REQ-022)", () => {
  const baseTwitter = {
    listIds: ["123456789"],
    users: [{ handle: "jack", userId: "12" }],
  };

  it("accepts a valid twitterConfig with listIds and users", () => {
    const r = userSettingsUpsertSchema.safeParse({
      ...validSettings,
      twitterConfig: baseTwitter,
    });
    expect(r.success).toBe(true);
  });

  it("accepts users without userId on input (resolved server-side)", () => {
    const r = userSettingsUpsertSchema.safeParse({
      ...validSettings,
      twitterConfig: { listIds: [], users: [{ handle: "jack" }] },
    });
    expect(r.success).toBe(true);
  });

  it("accepts users with both handle and userId", () => {
    const r = userSettingsUpsertSchema.safeParse({
      ...validSettings,
      twitterConfig: {
        listIds: [],
        users: [{ handle: "jack", userId: "12" }],
      },
    });
    expect(r.success).toBe(true);
  });

  it("rejects empty list ID", () => {
    const r = userSettingsUpsertSchema.safeParse({
      ...validSettings,
      twitterConfig: { listIds: [""], users: [] },
    });
    expect(r.success).toBe(false);
  });

  it("rejects non-digit list ID", () => {
    const r = userSettingsUpsertSchema.safeParse({
      ...validSettings,
      twitterConfig: { listIds: ["abc"], users: [] },
    });
    expect(r.success).toBe(false);
  });

  it("rejects negative maxTweetsPerSource", () => {
    const r = userSettingsUpsertSchema.safeParse({
      ...validSettings,
      twitterConfig: { ...baseTwitter, maxTweetsPerSource: -1 },
    });
    expect(r.success).toBe(false);
  });

  it("rejects maxTweetsPerSource over 500", () => {
    const r = userSettingsUpsertSchema.safeParse({
      ...validSettings,
      twitterConfig: { ...baseTwitter, maxTweetsPerSource: 501 },
    });
    expect(r.success).toBe(false);
  });

  it("rejects sinceHours over 168", () => {
    const r = userSettingsUpsertSchema.safeParse({
      ...validSettings,
      twitterConfig: { ...baseTwitter, sinceHours: 200 },
    });
    expect(r.success).toBe(false);
  });

  it("rejects sinceHours below 1", () => {
    const r = userSettingsUpsertSchema.safeParse({
      ...validSettings,
      twitterConfig: { ...baseTwitter, sinceHours: 0 },
    });
    expect(r.success).toBe(false);
  });

  it("rejects malformed handle (with @ prefix)", () => {
    const r = userSettingsUpsertSchema.safeParse({
      ...validSettings,
      twitterConfig: { listIds: [], users: [{ handle: "@jack" }] },
    });
    expect(r.success).toBe(false);
  });

  it("rejects malformed handle (over 15 chars)", () => {
    const r = userSettingsUpsertSchema.safeParse({
      ...validSettings,
      twitterConfig: {
        listIds: [],
        users: [{ handle: "abcdefghijklmnopqrstu" }],
      },
    });
    expect(r.success).toBe(false);
  });

  it("rejects malformed handle (contains space)", () => {
    const r = userSettingsUpsertSchema.safeParse({
      ...validSettings,
      twitterConfig: { listIds: [], users: [{ handle: "jack dorsey" }] },
    });
    expect(r.success).toBe(false);
  });

  it("rejects userId that isn't all digits", () => {
    const r = userSettingsUpsertSchema.safeParse({
      ...validSettings,
      twitterConfig: {
        listIds: [],
        users: [{ handle: "jack", userId: "12a" }],
      },
    });
    expect(r.success).toBe(false);
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

  it("accepts a valid title", () => {
    const r = archivePatchSchema.safeParse({
      rankedItems: [
        { id: 1, sourceType: "hn", title: "OpenAI ships GPT-5" },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("rejects empty title (min length 1)", () => {
    const r = archivePatchSchema.safeParse({
      rankedItems: [{ id: 1, sourceType: "hn", title: "" }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects title longer than 160 chars", () => {
    const r = archivePatchSchema.safeParse({
      rankedItems: [{ id: 1, sourceType: "hn", title: "x".repeat(161) }],
    });
    expect(r.success).toBe(false);
  });

  it("REQ-012: accepts the four digest fields as strings", () => {
    const r = archivePatchSchema.safeParse({
      rankedItems: [{ id: 1, sourceType: "hn" }],
      digestHeadline: "A headline",
      digestSummary: "A summary",
      hook: "A hook",
      twitterSummary: "A tweet",
    });
    expect(r.success).toBe(true);
  });

  it("EDGE-009: accepts the four digest fields as null", () => {
    const r = archivePatchSchema.safeParse({
      rankedItems: [{ id: 1, sourceType: "hn" }],
      digestHeadline: null,
      digestSummary: null,
      hook: null,
      twitterSummary: null,
    });
    expect(r.success).toBe(true);
  });

  it("EDGE-004: accepts an empty-string digest field", () => {
    const r = archivePatchSchema.safeParse({
      rankedItems: [{ id: 1, sourceType: "hn" }],
      hook: "",
    });
    expect(r.success).toBe(true);
  });

  it("accepts a body that omits all digest fields", () => {
    const r = archivePatchSchema.safeParse({
      rankedItems: [{ id: 1, sourceType: "hn" }],
    });
    expect(r.success).toBe(true);
  });

  it("REQ-012: rejects a numeric digestHeadline", () => {
    const r = archivePatchSchema.safeParse({
      rankedItems: [{ id: 1, sourceType: "hn" }],
      digestHeadline: 42,
    });
    expect(r.success).toBe(false);
  });
});

describe("userSettingsUpsertSchema webSearchConfig (REQ-005/REQ-006)", () => {
  const validWebSearchSettings = {
    ...validSettings,
    hnEnabled: false,
    hnConfig: null,
    webSearchEnabled: true,
    webSearchConfig: {
      provider: "tavily",
      queries: [{ query: "AI safety", sinceDays: 7, maxItems: 5 }],
    },
  };

  it("accepts valid webSearchConfig with provider=tavily and one query", () => {
    const r = userSettingsUpsertSchema.safeParse(validWebSearchSettings);
    expect(r.success).toBe(true);
  });

  it("rejects a query with an empty string", () => {
    const r = userSettingsUpsertSchema.safeParse({
      ...validWebSearchSettings,
      webSearchConfig: {
        provider: "tavily",
        queries: [{ query: "", sinceDays: 7, maxItems: 5 }],
      },
    });
    expect(r.success).toBe(false);
  });

  it("rejects a query string longer than 400 chars", () => {
    const r = userSettingsUpsertSchema.safeParse({
      ...validWebSearchSettings,
      webSearchConfig: {
        provider: "tavily",
        queries: [{ query: "x".repeat(401), sinceDays: 7, maxItems: 5 }],
      },
    });
    expect(r.success).toBe(false);
  });

  it("rejects sinceDays: 0 (below minimum of 1)", () => {
    const r = userSettingsUpsertSchema.safeParse({
      ...validWebSearchSettings,
      webSearchConfig: {
        provider: "tavily",
        queries: [{ query: "AI safety", sinceDays: 0, maxItems: 5 }],
      },
    });
    expect(r.success).toBe(false);
  });

  it("rejects sinceDays: 31 (above maximum of 30)", () => {
    const r = userSettingsUpsertSchema.safeParse({
      ...validWebSearchSettings,
      webSearchConfig: {
        provider: "tavily",
        queries: [{ query: "AI safety", sinceDays: 31, maxItems: 5 }],
      },
    });
    expect(r.success).toBe(false);
  });

  it("rejects maxItems: 0 (below minimum of 1)", () => {
    const r = userSettingsUpsertSchema.safeParse({
      ...validWebSearchSettings,
      webSearchConfig: {
        provider: "tavily",
        queries: [{ query: "AI safety", sinceDays: 7, maxItems: 0 }],
      },
    });
    expect(r.success).toBe(false);
  });

  it("rejects maxItems: 21 (above maximum of 20)", () => {
    const r = userSettingsUpsertSchema.safeParse({
      ...validWebSearchSettings,
      webSearchConfig: {
        provider: "tavily",
        queries: [{ query: "AI safety", sinceDays: 7, maxItems: 21 }],
      },
    });
    expect(r.success).toBe(false);
  });

  it("rejects 26 queries (max is 25)", () => {
    const r = userSettingsUpsertSchema.safeParse({
      ...validWebSearchSettings,
      webSearchConfig: {
        provider: "tavily",
        queries: Array.from({ length: 26 }, (_, i) => ({
          query: `query ${i}`,
          sinceDays: 7,
          maxItems: 5,
        })),
      },
    });
    expect(r.success).toBe(false);
  });

  it("rejects webSearchEnabled: true with empty queries array", () => {
    const r = userSettingsUpsertSchema.safeParse({
      ...validWebSearchSettings,
      webSearchEnabled: true,
      webSearchConfig: {
        provider: "tavily",
        queries: [],
      },
    });
    expect(r.success).toBe(false);
  });

  it("auto-derives webSearchEnabled: true when webSearchConfig is provided and webSearchEnabled is omitted", () => {
    const r = userSettingsUpsertSchema.safeParse({
      ...validSettings,
      hnEnabled: false,
      hnConfig: null,
      webSearchConfig: {
        provider: "tavily",
        queries: [{ query: "AI safety", sinceDays: 7, maxItems: 5 }],
      },
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.webSearchEnabled).toBe(true);
  });

  it("webSearchEnabled: true with valid query satisfies the at-least-one-source refinement (all other sources disabled)", () => {
    const r = userSettingsUpsertSchema.safeParse({
      topN: 10,
      halfLifeHours: null,
      hnEnabled: false,
      hnConfig: null,
      redditEnabled: false,
      redditConfig: null,
      webEnabled: false,
      webConfig: null,
      twitterEnabled: false,
      twitterConfig: null,
      webSearchEnabled: true,
      webSearchConfig: {
        provider: "tavily",
        queries: [{ query: "agentic AI", sinceDays: 7, maxItems: 10 }],
      },
      scheduleTime: "09:30",
      scheduleTimezone: "America/New_York",
      scheduleEnabled: true,
      rankingPrompt: "Default ranking prompt for tests",
      shortlistPrompt: "Default shortlist prompt for tests",
      shortlistSize: 30,
    });
    expect(r.success).toBe(true);
  });
});

describe("userSettingsUpsertSchema rankingPrompt (PHASE2-C1)", () => {
  it("accepts a multi-line prompt with backticks and $ characters", () => {
    const prompt =
      "Line one with backticks `code` and $variable\nLine two\nLine three";
    const r = userSettingsUpsertSchema.safeParse({
      ...validSettings,
      rankingPrompt: prompt,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.rankingPrompt).toBe(prompt);
    }
  });

  it("EDGE-002: rejects empty string", () => {
    const r = userSettingsUpsertSchema.safeParse({
      ...validSettings,
      rankingPrompt: "",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const issue = r.error.issues.find((i) => i.path.includes("rankingPrompt"));
      expect(issue).toBeDefined();
    }
  });

  it("EDGE-003: rejects whitespace-only string", () => {
    const r = userSettingsUpsertSchema.safeParse({
      ...validSettings,
      rankingPrompt: "   \n\t  ",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const issue = r.error.issues.find((i) => i.path.includes("rankingPrompt"));
      expect(issue).toBeDefined();
    }
  });

  it("EDGE-004: rejects > 20000 chars", () => {
    const r = userSettingsUpsertSchema.safeParse({
      ...validSettings,
      rankingPrompt: "x".repeat(20001),
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const issue = r.error.issues.find((i) => i.path.includes("rankingPrompt"));
      expect(issue).toBeDefined();
    }
  });

  it("accepts exactly 20000 chars", () => {
    const r = userSettingsUpsertSchema.safeParse({
      ...validSettings,
      rankingPrompt: "x".repeat(20000),
    });
    expect(r.success).toBe(true);
  });

  it("EDGE-005: rejects when rankingPrompt is missing", () => {
    const { rankingPrompt: _omit, ...withoutPrompt } = validSettings;
    void _omit;
    const r = userSettingsUpsertSchema.safeParse(withoutPrompt);
    expect(r.success).toBe(false);
    if (!r.success) {
      const issue = r.error.issues.find((i) => i.path.includes("rankingPrompt"));
      expect(issue).toBeDefined();
    }
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

describe("regenerateDigestMetaSchema", () => {
  const validItem = {
    id: 1,
    title: "A title",
    summary: "A summary",
    bottomLine: "The bottom line",
  };

  it("accepts a body with one or more valid items", () => {
    const r = regenerateDigestMetaSchema.safeParse({ items: [validItem] });
    expect(r.success).toBe(true);
  });

  it("rejects an empty items array", () => {
    const r = regenerateDigestMetaSchema.safeParse({ items: [] });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0].message).toBe("items cannot be empty");
    }
  });

  it("rejects an item with a non-integer id", () => {
    const r = regenerateDigestMetaSchema.safeParse({
      items: [{ ...validItem, id: 1.5 }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects an item with an empty title", () => {
    const r = regenerateDigestMetaSchema.safeParse({
      items: [{ ...validItem, title: "" }],
    });
    expect(r.success).toBe(false);
  });

  it("accepts empty-string summary and bottomLine", () => {
    const r = regenerateDigestMetaSchema.safeParse({
      items: [{ id: 1, title: "t", summary: "", bottomLine: "" }],
    });
    expect(r.success).toBe(true);
  });
});
