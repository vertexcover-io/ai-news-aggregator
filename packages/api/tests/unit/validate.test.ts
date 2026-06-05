import { describe, it, expect } from "vitest";
import { z } from "zod";
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

/** Assert that a schema accepts/rejects a payload via safeParse. */
function expectParse(
  schema: z.ZodType,
  payload: unknown,
  shouldSucceed: boolean,
): void {
  expect(schema.safeParse(payload).success).toBe(shouldSucceed);
}

describe("userSettingsUpsertSchema (REQ-012/REQ-013/EDGE-004)", () => {
  it("accepts a valid payload", () => {
    expectParse(userSettingsUpsertSchema, validSettings, true);
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
    expectParse(
      userSettingsUpsertSchema,
      {
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
      },
      true,
    );
  });

  it.each<{ name: string; payload: Record<string, unknown> }>([
    {
      name: "REQ-013: scheduleEnabled=true with all sources null",
      payload: {
        hnEnabled: false,
        hnConfig: null,
        redditEnabled: false,
        redditConfig: null,
        webEnabled: false,
        webConfig: null,
        twitterEnabled: false,
        twitterConfig: null,
      },
    },
    {
      name: "scheduleEnabled=true when configs exist but all sources are disabled",
      payload: {
        hnEnabled: false,
        redditEnabled: false,
        redditConfig: { subreddits: ["LocalLLaMA"], sinceDays: 1 },
        webEnabled: false,
        twitterEnabled: false,
      },
    },
    {
      name: "an enabled source whose config is null",
      payload: { hnEnabled: true, hnConfig: null },
    },
    {
      name: "scheduleTime that is not HH:MM",
      payload: { scheduleTime: "9:30" },
    },
    { name: "scheduleTime hours out of range", payload: { scheduleTime: "24:00" } },
    { name: "scheduleTime minutes out of range", payload: { scheduleTime: "12:60" } },
    {
      name: "EDGE-004: invalid IANA timezone 'GMT+5'",
      payload: { scheduleTimezone: "GMT+5" },
    },
    { name: "topN below range", payload: { topN: 0 } },
    { name: "topN above range", payload: { topN: 51 } },
    { name: "halfLifeHours = 0", payload: { halfLifeHours: 0 } },
    { name: "halfLifeHours negative", payload: { halfLifeHours: -1 } },
  ])("rejects $name", ({ payload }) => {
    expectParse(userSettingsUpsertSchema, { ...validSettings, ...payload }, false);
  });
});

describe("userSettingsUpsertSchema twitterConfig (REQ-022)", () => {
  const baseTwitter = {
    listIds: ["123456789"],
    users: [{ handle: "jack", userId: "12" }],
  };

  it.each<{ name: string; twitterConfig: Record<string, unknown> }>([
    {
      name: "valid twitterConfig with listIds and users",
      twitterConfig: baseTwitter,
    },
    {
      name: "users without userId on input (resolved server-side)",
      twitterConfig: { listIds: [], users: [{ handle: "jack" }] },
    },
    {
      name: "users with both handle and userId",
      twitterConfig: { listIds: [], users: [{ handle: "jack", userId: "12" }] },
    },
  ])("accepts $name", ({ twitterConfig }) => {
    expectParse(userSettingsUpsertSchema, { ...validSettings, twitterConfig }, true);
  });

  it.each<{ name: string; twitterConfig: Record<string, unknown> }>([
    { name: "empty list ID", twitterConfig: { listIds: [""], users: [] } },
    { name: "non-digit list ID", twitterConfig: { listIds: ["abc"], users: [] } },
    {
      name: "negative maxTweetsPerSource",
      twitterConfig: { ...baseTwitter, maxTweetsPerSource: -1 },
    },
    {
      name: "maxTweetsPerSource over 500",
      twitterConfig: { ...baseTwitter, maxTweetsPerSource: 501 },
    },
    {
      name: "sinceHours over 168",
      twitterConfig: { ...baseTwitter, sinceHours: 200 },
    },
    {
      name: "sinceHours below 1",
      twitterConfig: { ...baseTwitter, sinceHours: 0 },
    },
    {
      name: "malformed handle (with @ prefix)",
      twitterConfig: { listIds: [], users: [{ handle: "@jack" }] },
    },
    {
      name: "malformed handle (over 15 chars)",
      twitterConfig: { listIds: [], users: [{ handle: "abcdefghijklmnopqrstu" }] },
    },
    {
      name: "malformed handle (contains space)",
      twitterConfig: { listIds: [], users: [{ handle: "jack dorsey" }] },
    },
    {
      name: "userId that isn't all digits",
      twitterConfig: { listIds: [], users: [{ handle: "jack", userId: "12a" }] },
    },
  ])("rejects $name", ({ twitterConfig }) => {
    expectParse(userSettingsUpsertSchema, { ...validSettings, twitterConfig }, false);
  });
});

describe("runSubmitSchema (REQ-002)", () => {
  it.each<{ name: string; payload: Record<string, unknown> }>([
    { name: "hn only", payload: { topN: 10, hn: { sinceDays: 1 } } },
    {
      name: "reddit only",
      payload: { topN: 10, reddit: { subreddits: ["LocalLLaMA"], sinceDays: 1 } },
    },
    {
      name: "hn feeds, count, and commentsPerItem",
      payload: {
        topN: 10,
        hn: { sinceDays: 3, feeds: ["newest", "best"], count: 50, commentsPerItem: 10 },
      },
    },
    {
      name: "hn commentsPerItem = 0 (disabled)",
      payload: { topN: 10, hn: { sinceDays: 3, commentsPerItem: 0 } },
    },
    {
      name: "web only",
      payload: {
        topN: 10,
        web: {
          sources: [
            { name: "Anthropic", listingUrl: "https://www.anthropic.com/research" },
          ],
          maxItems: 5,
        },
      },
    },
    {
      name: "web with optional sinceDays",
      payload: {
        topN: 10,
        web: {
          sources: [{ name: "OpenAI", listingUrl: "https://openai.com/blog" }],
          maxItems: 5,
          sinceDays: 14,
        },
      },
    },
  ])("accepts a payload with $name", ({ payload }) => {
    expectParse(runSubmitSchema, payload, true);
  });

  it.each<{ name: string; payload: Record<string, unknown> }>([
    { name: "topN: 0", payload: { topN: 0, hn: { sinceDays: 1 } } },
    { name: "topN: 51", payload: { topN: 51, hn: { sinceDays: 1 } } },
    { name: "no source group", payload: { topN: 10 } },
    {
      name: "reddit with empty subreddits array",
      payload: { topN: 10, reddit: { subreddits: [], sinceDays: 1 } },
    },
    { name: "sinceDays > 30", payload: { topN: 10, hn: { sinceDays: 31 } } },
    {
      name: "hn feeds with an unknown value",
      payload: { topN: 10, hn: { sinceDays: 3, feeds: ["trending"] } },
    },
    {
      name: "hn feeds as an empty array",
      payload: { topN: 10, hn: { sinceDays: 3, feeds: [] } },
    },
    { name: "hn count > 1000", payload: { topN: 10, hn: { sinceDays: 3, count: 1001 } } },
    {
      name: "hn commentsPerItem > 100",
      payload: { topN: 10, hn: { sinceDays: 3, commentsPerItem: 101 } },
    },
    {
      name: "web with empty sources array",
      payload: { topN: 10, web: { sources: [], maxItems: 5 } },
    },
    {
      name: "web source with invalid listingUrl",
      payload: {
        topN: 10,
        web: { sources: [{ name: "Anthropic", listingUrl: "not-a-url" }], maxItems: 5 },
      },
    },
    {
      name: "web source with empty name",
      payload: {
        topN: 10,
        web: { sources: [{ name: "", listingUrl: "https://example.com" }], maxItems: 5 },
      },
    },
    {
      name: "web maxItems > 100",
      payload: {
        topN: 10,
        web: { sources: [{ name: "X", listingUrl: "https://example.com" }], maxItems: 101 },
      },
    },
  ])("rejects $name", ({ payload }) => {
    expectParse(runSubmitSchema, payload, false);
  });
});

describe("archivePatchSchema (REQ-160 – REQ-162, EDGE-110)", () => {
  it.each<{ name: string; payload: Record<string, unknown> }>([
    {
      name: "a non-empty rankedItems list",
      payload: {
        rankedItems: [
          { id: 1, sourceType: "hn" },
          { id: 2, sourceType: "reddit" },
        ],
      },
    },
    {
      name: "item with only id + sourceType (no optional fields)",
      payload: { rankedItems: [{ id: 1, sourceType: "hn" }] },
    },
    {
      name: "item with all new optional fields",
      payload: {
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
      },
    },
    {
      name: "item with imageUrl = null",
      payload: { rankedItems: [{ id: 1, sourceType: "hn", imageUrl: null }] },
    },
    {
      name: "a valid title",
      payload: { rankedItems: [{ id: 1, sourceType: "hn", title: "OpenAI ships GPT-5" }] },
    },
    {
      name: "REQ-012: the four digest fields as strings",
      payload: {
        rankedItems: [{ id: 1, sourceType: "hn" }],
        digestHeadline: "A headline",
        digestSummary: "A summary",
        hook: "A hook",
        twitterSummary: "A tweet",
      },
    },
    {
      name: "EDGE-009: the four digest fields as null",
      payload: {
        rankedItems: [{ id: 1, sourceType: "hn" }],
        digestHeadline: null,
        digestSummary: null,
        hook: null,
        twitterSummary: null,
      },
    },
    {
      name: "EDGE-004: an empty-string digest field",
      payload: { rankedItems: [{ id: 1, sourceType: "hn" }], hook: "" },
    },
    {
      name: "a body that omits all digest fields",
      payload: { rankedItems: [{ id: 1, sourceType: "hn" }] },
    },
  ])("accepts $name", ({ payload }) => {
    expectParse(archivePatchSchema, payload, true);
  });

  it.each<{ name: string; payload: Record<string, unknown> }>([
    { name: "REQ-162: an empty list", payload: { rankedItems: [] } },
    {
      name: "EDGE-110: duplicate ids",
      payload: {
        rankedItems: [
          { id: 1, sourceType: "hn" },
          { id: 1, sourceType: "hn" },
        ],
      },
    },
    { name: "items missing required fields", payload: { rankedItems: [{ id: 1 }] } },
    {
      name: "non-integer ids",
      payload: { rankedItems: [{ id: 1.5, sourceType: "hn" }] },
    },
    { name: "item missing id", payload: { rankedItems: [{ sourceType: "hn" }] } },
    {
      name: "empty title (min length 1)",
      payload: { rankedItems: [{ id: 1, sourceType: "hn", title: "" }] },
    },
    {
      name: "title longer than 160 chars",
      payload: { rankedItems: [{ id: 1, sourceType: "hn", title: "x".repeat(161) }] },
    },
    {
      name: "REQ-012: a numeric digestHeadline",
      payload: { rankedItems: [{ id: 1, sourceType: "hn" }], digestHeadline: 42 },
    },
  ])("rejects $name", ({ payload }) => {
    expectParse(archivePatchSchema, payload, false);
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
    expectParse(userSettingsUpsertSchema, validWebSearchSettings, true);
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
    expectParse(
      userSettingsUpsertSchema,
      {
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
      },
      true,
    );
  });

  it.each<{ name: string; webSearchConfig: Record<string, unknown> }>([
    {
      name: "a query with an empty string",
      webSearchConfig: {
        provider: "tavily",
        queries: [{ query: "", sinceDays: 7, maxItems: 5 }],
      },
    },
    {
      name: "a query string longer than 400 chars",
      webSearchConfig: {
        provider: "tavily",
        queries: [{ query: "x".repeat(401), sinceDays: 7, maxItems: 5 }],
      },
    },
    {
      name: "sinceDays: 0 (below minimum of 1)",
      webSearchConfig: {
        provider: "tavily",
        queries: [{ query: "AI safety", sinceDays: 0, maxItems: 5 }],
      },
    },
    {
      name: "sinceDays: 31 (above maximum of 30)",
      webSearchConfig: {
        provider: "tavily",
        queries: [{ query: "AI safety", sinceDays: 31, maxItems: 5 }],
      },
    },
    {
      name: "maxItems: 0 (below minimum of 1)",
      webSearchConfig: {
        provider: "tavily",
        queries: [{ query: "AI safety", sinceDays: 7, maxItems: 0 }],
      },
    },
    {
      name: "maxItems: 21 (above maximum of 20)",
      webSearchConfig: {
        provider: "tavily",
        queries: [{ query: "AI safety", sinceDays: 7, maxItems: 21 }],
      },
    },
    {
      name: "26 queries (max is 25)",
      webSearchConfig: {
        provider: "tavily",
        queries: Array.from({ length: 26 }, (_, i) => ({
          query: `query ${String(i)}`,
          sinceDays: 7,
          maxItems: 5,
        })),
      },
    },
    {
      name: "webSearchEnabled: true with empty queries array",
      webSearchConfig: { provider: "tavily", queries: [] },
    },
  ])("rejects $name", ({ webSearchConfig }) => {
    expectParse(
      userSettingsUpsertSchema,
      { ...validWebSearchSettings, webSearchEnabled: true, webSearchConfig },
      false,
    );
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

  it("accepts exactly 20000 chars", () => {
    expectParse(
      userSettingsUpsertSchema,
      { ...validSettings, rankingPrompt: "x".repeat(20000) },
      true,
    );
  });

  it.each<{ name: string; rankingPrompt?: string; omit?: true }>([
    { name: "EDGE-002: empty string", rankingPrompt: "" },
    { name: "EDGE-003: whitespace-only string", rankingPrompt: "   \n\t  " },
    { name: "EDGE-004: > 20000 chars", rankingPrompt: "x".repeat(20001) },
    { name: "EDGE-005: missing rankingPrompt", omit: true },
  ])("rejects $name with a rankingPrompt issue", ({ rankingPrompt, omit }) => {
    const { rankingPrompt: _omit, ...withoutPrompt } = validSettings;
    void _omit;
    const payload = omit
      ? withoutPrompt
      : { ...validSettings, rankingPrompt };
    const r = userSettingsUpsertSchema.safeParse(payload);
    expect(r.success).toBe(false);
    if (!r.success) {
      const issue = r.error.issues.find((i) => i.path.includes("rankingPrompt"));
      expect(issue).toBeDefined();
    }
  });
});

describe("addPostSchema (REQ-024, REQ-144)", () => {
  it.each<{ name: string; payload: Record<string, unknown> }>([
    { name: "a valid URL payload", payload: { url: "https://example.com/post" } },
    {
      name: "an HN URL",
      payload: { url: "https://news.ycombinator.com/item?id=12345" },
    },
  ])("accepts $name", ({ payload }) => {
    expectParse(addPostSchema, payload, true);
  });

  it.each<{ name: string; payload: Record<string, unknown> }>([
    { name: "REQ-024: empty body {}", payload: {} },
    { name: "REQ-024: empty string url", payload: { url: "" } },
    { name: "REQ-144: malformed url", payload: { url: "not-a-url" } },
  ])("rejects $name", ({ payload }) => {
    expectParse(addPostSchema, payload, false);
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
    expectParse(regenerateDigestMetaSchema, { items: [validItem] }, true);
  });

  it("accepts empty-string summary and bottomLine", () => {
    expectParse(
      regenerateDigestMetaSchema,
      { items: [{ id: 1, title: "t", summary: "", bottomLine: "" }] },
      true,
    );
  });

  it("rejects an empty items array with the expected message", () => {
    const r = regenerateDigestMetaSchema.safeParse({ items: [] });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0].message).toBe("items cannot be empty");
    }
  });

  it.each<{ name: string; item: Record<string, unknown> }>([
    { name: "an item with a non-integer id", item: { ...validItem, id: 1.5 } },
    { name: "an item with an empty title", item: { ...validItem, title: "" } },
  ])("rejects $name", ({ item }) => {
    expectParse(regenerateDigestMetaSchema, { items: [item] }, false);
  });
});
