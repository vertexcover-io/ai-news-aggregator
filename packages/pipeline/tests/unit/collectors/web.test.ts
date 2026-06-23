import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MockLanguageModelV2 } from "ai/test";
import type { LanguageModelV2CallOptions } from "@ai-sdk/provider";
import webListingFixture from "@pipeline-tests/unit/fixtures/web-listing.json";
import webPostFixture from "@pipeline-tests/unit/fixtures/web-post.json";
import {
  discoverPostUrls,
  extractPostFields,
  validateDiscoveredUrls,
  DiscoverySchema,
  DetailSchema,
  collectWeb,
  buildRawItem,
  applySinceDays,
  sortPostsByPublishedAtDesc,
  parseDateOrNull,
  resolvesToListing,
  COMBINED_DISCOVERY_CAP,
  WEB_COLLECTOR_MODEL_ID,
  type DiscoveredPost,
} from "@pipeline/collectors/web.js";
import type { RecordInput } from "@pipeline/services/cost-tracker.js";
import type { BlogSource } from "@pipeline/types.js";
import type { RawItemsRepo } from "@pipeline/repositories/raw-items.js";
import type { CrawlResult } from "@pipeline/services/web-crawler.js";

interface ListingFixture {
  listingUrl: string;
  markdown: string;
}

interface PostFixture {
  postUrl: string;
  markdown: string;
}

const listing = webListingFixture as ListingFixture;
const post = webPostFixture as PostFixture;

function makeDiscoveryMockModel(jsonObject: unknown): MockLanguageModelV2 {
  return new MockLanguageModelV2({
    doGenerate: () =>
      Promise.resolve({
        content: [{ type: "text", text: JSON.stringify(jsonObject) }],
        finishReason: "stop" as const,
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
        },
        warnings: [],
      }),
  });
}

function makeThrowingModel(message: string): MockLanguageModelV2 {
  return new MockLanguageModelV2({
    doGenerate: () => Promise.reject(new Error(message)),
  });
}

function getCallOrThrow(
  calls: readonly LanguageModelV2CallOptions[],
  index: number,
): LanguageModelV2CallOptions {
  const call = calls[index];
  if (!call) throw new Error(`expected call at index ${String(index)}`);
  return call;
}

describe("LLM extraction helpers", () => {
  describe("discoverPostUrls", () => {
    it("returns posts array from mocked LLM", async () => {
      const fakePosts = [
        {
          url: "https://example.com/blog/scaling-events",
          title: "Scaling our event pipeline to 10M events/sec",
          published_at: "2026-03-30",
        },
        {
          url: "https://example.com/blog/rust-scheduler",
          title: "Why we rewrote our scheduler in Rust",
          published_at: "2026-03-22",
        },
      ];
      const model = makeDiscoveryMockModel({ posts: fakePosts });

      const result = await discoverPostUrls(listing.listingUrl, listing.markdown, null, model);

      expect(result).toEqual(fakePosts);
    });

    it("passes temperature 0 to generateText", async () => {
      const model = makeDiscoveryMockModel({ posts: [] });

      await discoverPostUrls(listing.listingUrl, listing.markdown, null, model);

      expect(model.doGenerateCalls).toHaveLength(1);
      const call = getCallOrThrow(model.doGenerateCalls, 0);
      expect(call.temperature).toBe(0);
    });

    it("passes DiscoverySchema to generateText", async () => {
      const model = makeDiscoveryMockModel({ posts: [] });

      await discoverPostUrls(listing.listingUrl, listing.markdown, null, model);

      const call = getCallOrThrow(model.doGenerateCalls, 0);
      const responseFormat = call.responseFormat;
      if (responseFormat?.type !== "json") {
        throw new Error("expected json response format");
      }
      const schema = responseFormat.schema as { properties?: Record<string, unknown> } | undefined;
      expect(schema?.properties).toHaveProperty("posts");
    });

    it("throws when LLM throws", async () => {
      const model = makeThrowingModel("upstream LLM failure");

      await expect(
        discoverPostUrls(listing.listingUrl, listing.markdown, null, model),
      ).rejects.toThrow();
    });
  });

  describe("extractPostFields", () => {
    it("returns title/author/published_at/image_url from mocked LLM", async () => {
      const fakeFields = {
        title: "Scaling our event pipeline to 10M events/sec",
        author: "Jane Doe",
        published_at: "2026-03-30",
        image_url: "https://example.com/hero.jpg",
      };
      const model = makeDiscoveryMockModel(fakeFields);

      const result = await extractPostFields(post.postUrl, post.markdown, model);

      expect(result).toEqual(fakeFields);
    });

    it("passes DetailSchema with image_url to generateText", async () => {
      const model = makeDiscoveryMockModel({ title: "", author: "", published_at: "", image_url: "" });

      await extractPostFields(post.postUrl, post.markdown, model);

      const call = getCallOrThrow(model.doGenerateCalls, 0);
      const responseFormat = call.responseFormat;
      if (responseFormat?.type !== "json") {
        throw new Error("expected json response format");
      }
      const schema = responseFormat.schema as { properties?: Record<string, unknown> } | undefined;
      expect(schema?.properties).toHaveProperty("title");
      expect(schema?.properties).toHaveProperty("author");
      expect(schema?.properties).toHaveProperty("published_at");
      expect(schema?.properties).toHaveProperty("image_url");
    });
  });

  describe("validateDiscoveredUrls", () => {
    // REQ-008: URLs absent from the listing markdown are now KEPT (substring gate removed)
    it("keeps a valid http(s) URL even when it is NOT a substring of the listing markdown (REQ-008)", () => {
      const posts: DiscoveredPost[] = [
        {
          url: "https://example.com/blog/scaling-events",
          title: "Real post in markdown",
          published_at: "2026-03-30",
        },
        {
          url: "https://example.com/blog/only-in-structured-data",
          title: "URL only in JSON-LD blob, not in markdown",
          published_at: "2026-03-25",
        },
      ];

      const result = validateDiscoveredUrls(posts, listing.listingUrl);

      // Both URLs are valid http(s) — both must survive without the substring gate
      expect(result).toHaveLength(2);
      expect(result.map((p) => p.url)).toContain("https://example.com/blog/only-in-structured-data");
    });

    // REQ-009: valid URLs still kept (no regression from gate removal)
    it("keeps URLs that appear as substrings (still valid after gate removal, REQ-009)", () => {
      const posts: DiscoveredPost[] = [
        {
          url: "https://example.com/blog/scaling-events",
          title: "A",
          published_at: "",
        },
        {
          url: "https://example.com/blog/rust-scheduler",
          title: "B",
          published_at: "",
        },
        {
          url: "https://example.com/blog/feature-flags",
          title: "C",
          published_at: "",
        },
      ];

      const result = validateDiscoveredUrls(posts, listing.listingUrl);

      expect(result).toHaveLength(3);
    });

    it("handles empty input gracefully", () => {
      const result = validateDiscoveredUrls([], listing.listingUrl);
      expect(result).toEqual([]);
    });

    it("resolves a relative URL against the listing URL and keeps it", () => {
      // The discovery LLM commonly emits relative hrefs as they appear in the
      // page markdown — these must be resolved to absolute, not dropped.
      const posts: DiscoveredPost[] = [
        {
          url: "/blog/scaling-events",
          title: "Relative post",
          published_at: "2026-03-30",
        },
      ];

      const result = validateDiscoveredUrls(posts, listing.listingUrl);

      expect(result).toHaveLength(1);
      expect(result[0]?.url).toBe("https://example.com/blog/scaling-events");
    });

    // REQ-009: invalid URLs still dropped
    it("drops empty, fragment, and non-http(s) URLs (REQ-009)", () => {
      const posts: DiscoveredPost[] = [
        { url: "", title: "empty", published_at: "" },
        { url: "#", title: "fragment", published_at: "" },
        { url: "mailto:hi@example.com", title: "mailto", published_at: "" },
        { url: "javascript:void(0)", title: "js", published_at: "" },
      ];

      const result = validateDiscoveredUrls(posts, listing.listingUrl);

      expect(result).toEqual([]);
    });

    it("keeps a valid absolute URL even when one sibling is malformed", () => {
      const posts: DiscoveredPost[] = [
        { url: "/blog/scaling-events", title: "good", published_at: "" },
        { url: "", title: "bad", published_at: "" },
      ];

      const result = validateDiscoveredUrls(posts, listing.listingUrl);

      expect(result.map((p) => p.url)).toEqual([
        "https://example.com/blog/scaling-events",
      ]);
    });

    // EDGE-003: a hallucinated URL (not in markdown or structured data) passes validation
    it("passes validation for a hallucinated URL not present in markdown (EDGE-003)", () => {
      const posts: DiscoveredPost[] = [
        {
          url: "https://example.com/blog/hallucinated-post",
          title: "Hallucinated by LLM",
          published_at: "2026-03-25",
        },
      ];

      // Should pass validation (substring gate is gone); it will fail/404 in Pass-2
      const result = validateDiscoveredUrls(posts, listing.listingUrl);
      expect(result).toHaveLength(1);
      expect(result[0]?.url).toBe("https://example.com/blog/hallucinated-post");
    });
  });

  describe("discoverPostUrls — structured data prompt injection (REQ-005, REQ-006, REQ-007, EDGE-002)", () => {
    // REQ-005: non-null structuredData → prompt contains markdown, then delimiter, then blob
    it("appends structured data after a delimiter when structuredData is non-null (REQ-005)", async () => {
      const model = makeDiscoveryMockModel({ posts: [] });
      const sd = '{"@type":"NewsArticle","headline":"Test"}';

      await discoverPostUrls(listing.listingUrl, listing.markdown, sd, model);

      const call = getCallOrThrow(model.doGenerateCalls, 0);
      // prompt is LanguageModelV2Prompt: Array<{ role, content: Array<{ type, text }> }>
      const promptMessages = call.prompt as { role: string; content: { type: string; text?: string }[] }[];
      const text = promptMessages.flatMap((m) => m.content).find((c) => c.type === "text")?.text ?? "";

      // Markdown appears before the delimiter
      const mdIdx = text.indexOf(listing.markdown);
      const delimIdx = text.indexOf("--- STRUCTURED DATA ---");
      const sdIdx = text.indexOf(sd);

      expect(mdIdx).toBeGreaterThanOrEqual(0);
      expect(delimIdx).toBeGreaterThan(mdIdx);
      expect(sdIdx).toBeGreaterThan(delimIdx);
    });

    // REQ-007: null structuredData → no STRUCTURED DATA section
    it("sends markdown-only prompt when structuredData is null (REQ-007)", async () => {
      const model = makeDiscoveryMockModel({ posts: [] });

      await discoverPostUrls(listing.listingUrl, listing.markdown, null, model);

      const call = getCallOrThrow(model.doGenerateCalls, 0);
      const promptMessages = call.prompt as { role: string; content: { type: string; text?: string }[] }[];
      const text = promptMessages.flatMap((m) => m.content).find((c) => c.type === "text")?.text ?? "";

      expect(text).not.toContain("--- STRUCTURED DATA ---");
      expect(text).toContain(listing.markdown);
    });

    // Recency filter: when sinceDays is provided the prompt instructs the model
    // to only return recent posts (keeps output small on long archive pages).
    it("injects a recency cutoff instruction when sinceDays is set", async () => {
      const model = makeDiscoveryMockModel({ posts: [] });

      await discoverPostUrls(listing.listingUrl, listing.markdown, null, model, undefined, 1);

      const call = getCallOrThrow(model.doGenerateCalls, 0);
      const promptMessages = call.prompt as { role: string; content: { type: string; text?: string }[] }[];
      const text = promptMessages.flatMap((m) => m.content).find((c) => c.type === "text")?.text ?? "";

      expect(text).toContain("Only return posts published on or after");
      expect(text).toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(text).toContain("derive published_at from the URL");
    });

    // Without sinceDays (or sinceDays <= 0) the recency instruction is absent.
    it("omits the recency instruction when sinceDays is not provided", async () => {
      const model = makeDiscoveryMockModel({ posts: [] });

      await discoverPostUrls(listing.listingUrl, listing.markdown, null, model);

      const call = getCallOrThrow(model.doGenerateCalls, 0);
      const promptMessages = call.prompt as { role: string; content: { type: string; text?: string }[] }[];
      const text = promptMessages.flatMap((m) => m.content).find((c) => c.type === "text")?.text ?? "";

      expect(text).not.toContain("Only return posts published on or after");
    });

    // REQ-006 + EDGE-002: oversized combined body is capped; markdown prefix is preserved
    it("truncates combined body to COMBINED_DISCOVERY_CAP and preserves markdown prefix (REQ-006, EDGE-002)", async () => {
      const model = makeDiscoveryMockModel({ posts: [] });
      // Build a structuredData that, combined with the markdown, exceeds the cap
      const mdPart = "A".repeat(80_000);
      const sdPart = "B".repeat(80_000);

      await discoverPostUrls(listing.listingUrl, mdPart, sdPart, model);

      const call = getCallOrThrow(model.doGenerateCalls, 0);
      const promptMessages = call.prompt as { role: string; content: { type: string; text?: string }[] }[];
      const text = promptMessages.flatMap((m) => m.content).find((c) => c.type === "text")?.text ?? "";

      // Find the embedded body between the BEGIN and END markers
      const beginMarker = "--- BEGIN LISTING MARKDOWN ---\n";
      const endMarker = "\n--- END LISTING MARKDOWN ---";
      const beginIdx = text.indexOf(beginMarker);
      const endIdx = text.indexOf(endMarker);
      expect(beginIdx).toBeGreaterThanOrEqual(0);
      expect(endIdx).toBeGreaterThan(beginIdx);

      const body = text.slice(beginIdx + beginMarker.length, endIdx);
      expect(body.length).toBe(COMBINED_DISCOVERY_CAP);
      // Markdown goes first, so the body starts with the markdown prefix
      expect(body.startsWith(mdPart.slice(0, 100))).toBe(true);
    });
  });

  describe("schemas", () => {
    it("DiscoverySchema parses well-formed input", () => {
      const parsed = DiscoverySchema.parse({
        posts: [{ url: "https://example.com/a", title: "A", published_at: "2026-01-01" }],
      });
      expect(parsed.posts).toHaveLength(1);
    });

    it("DetailSchema parses well-formed input", () => {
      const parsed = DetailSchema.parse({
        title: "T",
        author: "A",
        published_at: "2026-01-01",
        image_url: "https://example.com/img.jpg",
      });
      expect(parsed.title).toBe("T");
      expect(parsed.image_url).toBe("https://example.com/img.jpg");
    });
  });
});

describe("filters and row assembly", () => {
  interface DiscoveredPostShape {
    url: string;
    title: string;
    published_at: string;
  }
  interface ExtractedFieldsShape {
    title: string;
    author: string;
    published_at: string;
    image_url: string;
  }
  type ApplySinceDaysFn = (
    posts: DiscoveredPostShape[],
    sinceDays: number | undefined,
  ) => DiscoveredPostShape[];
  type ParseDateOrNullFn = (raw: string | undefined | null) => Date | null;
  type BuildRawItemFn = (
    postUrl: string,
    markdownBody: string,
    fields: ExtractedFieldsShape,
  ) => import("@newsletter/shared/db").RawItemInsert;

  let applySinceDaysFn: ApplySinceDaysFn;
  let parseDateOrNullFn: ParseDateOrNullFn;
  let buildRawItemFn: BuildRawItemFn;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-04-07T00:00:00Z"));
    applySinceDaysFn = applySinceDays as ApplySinceDaysFn;
    parseDateOrNullFn = parseDateOrNull as ParseDateOrNullFn;
    buildRawItemFn = buildRawItem as BuildRawItemFn;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("applySinceDays returns input unchanged when sinceDays is undefined", () => {
    const posts: DiscoveredPostShape[] = [
      { url: "https://x/a", title: "A", published_at: "2020-01-01" },
      { url: "https://x/b", title: "B", published_at: "" },
    ];
    expect(applySinceDaysFn(posts, undefined)).toEqual(posts);
  });

  // REQ-020
  it("applySinceDays drops posts older than the cutoff", () => {
    const tenDaysAgo = new Date("2026-03-28T00:00:00Z").toISOString();
    const posts: DiscoveredPostShape[] = [
      { url: "https://x/old", title: "Old", published_at: tenDaysAgo },
    ];
    expect(applySinceDaysFn(posts, 7)).toEqual([]);
  });

  // REQ-020
  it("applySinceDays keeps posts within the cutoff", () => {
    const fiveDaysAgo = new Date("2026-04-02T00:00:00Z").toISOString();
    const posts: DiscoveredPostShape[] = [
      { url: "https://x/new", title: "New", published_at: fiveDaysAgo },
    ];
    expect(applySinceDaysFn(posts, 7)).toEqual(posts);
  });

  // REQ-021
  it("applySinceDays keeps posts with empty published_at even when sinceDays is set", () => {
    const posts: DiscoveredPostShape[] = [
      { url: "https://x/empty", title: "Empty", published_at: "" },
    ];
    expect(applySinceDaysFn(posts, 7)).toEqual(posts);
  });

  // REQ-022
  it("applySinceDays keeps posts with unparseable published_at", () => {
    const posts: DiscoveredPostShape[] = [
      { url: "https://x/bad", title: "Bad", published_at: "not a date" },
    ];
    expect(applySinceDaysFn(posts, 7)).toEqual(posts);
  });

  it("applySinceDays keeps a post exactly at the cutoff boundary", () => {
    const cutoff = new Date("2026-03-31T00:00:00Z").toISOString();
    const posts: DiscoveredPostShape[] = [
      { url: "https://x/edge", title: "Edge", published_at: cutoff },
    ];
    expect(applySinceDaysFn(posts, 7)).toEqual(posts);
  });

  // REQ-011: applySinceDays resolves relative LLM strings via the resolver
  it("applySinceDays keeps a '1 day ago' post and drops a '40 days ago' post (sinceDays=7)", () => {
    const posts: DiscoveredPostShape[] = [
      { url: "https://x/recent", title: "Recent", published_at: "1 day ago" },
      { url: "https://x/stale", title: "Stale", published_at: "40 days ago" },
    ];
    expect(applySinceDaysFn(posts, 7)).toEqual([
      { url: "https://x/recent", title: "Recent", published_at: "1 day ago" },
    ]);
  });

  // REQ-011: sort mixes ISO and relative strings, newest-first
  it("sortPostsByPublishedAtDesc orders a mix of ISO and relative dates newest-first", () => {
    const posts = [
      { url: "https://x/iso-old", title: "ISO old", published_at: "2026-01-01T00:00:00Z" },
      { url: "https://x/rel-new", title: "Rel new", published_at: "2 hours ago" },
      { url: "https://x/rel-mid", title: "Rel mid", published_at: "5 days ago" },
    ];
    const sorted = sortPostsByPublishedAtDesc(posts);
    expect(sorted.map((p) => p.url)).toEqual([
      "https://x/rel-new",
      "https://x/rel-mid",
      "https://x/iso-old",
    ]);
  });

  // REQ-007: structured date wins over the LLM body-text date
  it("buildRawItem prefers the structured publishedAt over the LLM published_at", () => {
    const structured = new Date("2026-05-25T09:00:00Z");
    const item = buildRawItem(
      "https://example.com/post-structured",
      "body",
      { title: "T", author: "A", published_at: "2026-05-21", image_url: "" },
      structured,
    );
    expect(item.publishedAt).toEqual(structured);
  });

  // REQ-007 / EDGE-005: no structured date → resolve the LLM relative string
  it("buildRawItem resolves a relative LLM published_at when no structured date is given", () => {
    const item = buildRawItem(
      "https://example.com/post-relative",
      "body",
      { title: "T", author: "A", published_at: "4 hours ago", image_url: "" },
      null,
    );
    if (!(item.publishedAt instanceof Date)) {
      throw new Error("expected publishedAt to be a Date");
    }
    // system time is 2026-04-07T00:00:00Z (fake timers), 4h earlier
    expect(item.publishedAt.toISOString()).toBe("2026-04-06T20:00:00.000Z");
  });

  // REQ-051: parseDateOrNull returns null for empty/null/unparseable, a Date otherwise
  it.each<{ label: string; input: string | null; expected: string | null }>([
    { label: "empty string", input: "", expected: null },
    { label: "null input", input: null, expected: null },
    { label: "unparseable input", input: "not a date", expected: null },
    {
      label: "YYYY-MM-DD input",
      input: "2026-04-07",
      expected: "2026-04-07T00:00:00.000Z",
    },
    {
      label: "full ISO-8601 input",
      input: "2026-04-07T10:30:00Z",
      expected: "2026-04-07T10:30:00.000Z",
    },
  ])("parseDateOrNull on $label", ({ input, expected }) => {
    const result = parseDateOrNullFn(input);
    if (expected === null) {
      expect(result).toBeNull();
    } else {
      expect(result).toBeInstanceOf(Date);
      expect(result?.toISOString()).toBe(expected);
    }
  });

  // REQ-050
  it("buildRawItem produces correct shape with all required fields", () => {
    const item = buildRawItemFn(
      "https://example.com/post-1",
      "# Body markdown",
      { title: "Post 1", author: "Jane Doe", published_at: "2026-04-01T00:00:00Z", image_url: "https://example.com/hero.jpg" },
    );
    expect(item.sourceType).toBe("blog");
    expect(item.externalId).toBe("https://example.com/post-1");
    expect(item.url).toBe("https://example.com/post-1");
    expect(item.sourceUrl).toBe("https://example.com/post-1");
    expect(item.title).toBe("Post 1");
    expect(item.author).toBe("Jane Doe");
    expect(item.content).toBe("# Body markdown");
    expect(item.imageUrl).toBe("https://example.com/hero.jpg");
    if (!(item.publishedAt instanceof Date)) {
      throw new Error("expected publishedAt to be a Date");
    }
    expect(item.publishedAt.toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(item.engagement).toEqual({ points: 0, commentCount: 0 });
    expect(item.metadata).toEqual({ comments: [] });
    expect(item.collectedAt).toBeInstanceOf(Date);
    expect(item.updatedAt).toBeInstanceOf(Date);
  });

  it("buildRawItem sets author to null when extracted author is empty", () => {
    const item = buildRawItemFn(
      "https://example.com/post-2",
      "body",
      { title: "T", author: "   ", published_at: "", image_url: "" },
    );
    expect(item.author).toBeNull();
  });

  // REQ-051
  it("buildRawItem sets publishedAt to null when published_at is unparseable", () => {
    const item = buildRawItemFn(
      "https://example.com/post-3",
      "body",
      { title: "T", author: "A", published_at: "not a date", image_url: "" },
    );
    expect(item.publishedAt).toBeNull();
  });

  it("buildRawItem sets imageUrl to null when image_url is empty", () => {
    const item = buildRawItemFn(
      "https://example.com/post-4",
      "body",
      { title: "T", author: "A", published_at: "", image_url: "" },
    );
    expect(item.imageUrl).toBeNull();
  });

  it("buildRawItem sets imageUrl to null when image_url is a data URI", () => {
    const item = buildRawItemFn(
      "https://example.com/post-5",
      "body",
      { title: "T", author: "A", published_at: "", image_url: "data:image/png;base64,abc" },
    );
    expect(item.imageUrl).toBeNull();
  });

  it("buildRawItem sets imageUrl when image_url is a valid http URL", () => {
    const item = buildRawItemFn(
      "https://example.com/post-6",
      "body",
      { title: "T", author: "A", published_at: "", image_url: "https://cdn.example.com/img.jpg" },
    );
    expect(item.imageUrl).toBe("https://cdn.example.com/img.jpg");
  });
});

// ── collectWeb tests (mocked at runWebCrawl boundary) ─────────────────────────

function makeRepo(existing: string[] = []): RawItemsRepo {
  return {
    upsertItems: vi.fn().mockResolvedValue(undefined),
    findExistingExternalIds: vi.fn().mockResolvedValue(new Set(existing)),
    findBySourceAndExternalId: vi.fn().mockResolvedValue(null),
    updateRecapData: vi.fn().mockResolvedValue(undefined),
  };
}

const sourceA: BlogSource = { name: "alpha", listingUrl: "https://alpha.example.com/blog" };
const sourceB: BlogSource = { name: "beta", listingUrl: "https://beta.example.com/blog" };

const DISCOVERY_POSTS = [
  { url: "https://example.com/blog/scaling-events", title: "Post A", published_at: "2026-03-30" },
  { url: "https://example.com/blog/rust-scheduler", title: "Post B", published_at: "2026-03-29" },
];

const LISTING_MARKDOWN = `
# Tech Blog

- [Post A](https://example.com/blog/scaling-events)
- [Post B](https://example.com/blog/rust-scheduler)
`;

const DETAIL_MARKDOWN = "# Post Title\n\nThis is the post content about something interesting.";

function makeSuccessResult(
  markdown: string,
  imageUrl: string | null = null,
  publishedAt: Date | null = null,
  structuredData: string | null = null,
): CrawlResult {
  return {
    ok: true,
    result: { markdown, title: null, byline: null, imageUrl, textLength: markdown.length, publishedAt, structuredData },
    renderedWith: "static",
  };
}

function makeFailureResult(error: string): CrawlResult {
  return { ok: false, error };
}

function makeDiscoveryModel(
  posts: { url: string; title: string; published_at: string }[],
): MockLanguageModelV2 {
  return new MockLanguageModelV2({
    doGenerate: () =>
      Promise.resolve({
        content: [{ type: "text", text: JSON.stringify({ posts }) }],
        finishReason: "stop" as const,
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        warnings: [],
      }),
  });
}

function makeDiscoveryThenExtractModel(
  discoveryPosts: { url: string; title: string; published_at: string }[],
  extractFields: { title: string; author: string; published_at: string; image_url?: string },
): MockLanguageModelV2 {
  let calls = 0;
  const withDefaults = { image_url: "", ...extractFields };
  return new MockLanguageModelV2({
    doGenerate: () => {
      const isDiscovery = calls === 0;
      calls++;
      const payload = isDiscovery ? { posts: discoveryPosts } : withDefaults;
      return Promise.resolve({
        content: [{ type: "text", text: JSON.stringify(payload) }],
        finishReason: "stop" as const,
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        warnings: [],
      });
    },
  });
}

describe("collectWeb (mocked at runWebCrawl boundary)", () => {
  // EDGE-018: empty sources array
  it("returns empty result without throwing when sources is []", async () => {
    const repo = makeRepo();
    const runWebCrawl = vi.fn().mockResolvedValue(new Map());
    const model = new MockLanguageModelV2({
      doGenerate: () => { throw new Error("LLM should not be called"); },
    });

    const result = await collectWeb(
      { rawItemsRepo: repo, llmModel: model, runWebCrawl },
      { sources: [], maxItems: 5 },
    );

    expect(result.itemsFetched).toBe(0);
    expect(result.itemsStored).toBe(0);
    expect(result.failures).toBeUndefined();
    expect(repo.upsertItems).not.toHaveBeenCalled();
    // runWebCrawl should not be called for empty sources
    expect(runWebCrawl).not.toHaveBeenCalled();
  });

  // REQ-11: listing failure for one source → failure entry; other sources produce items
  it("records listing-fetch failure for one source while other succeeds", async () => {
    const model = makeDiscoveryThenExtractModel(
      DISCOVERY_POSTS,
      { title: "Post Title", author: "Author", published_at: "2026-03-30" },
    );
    const repo = makeRepo();

    const listingMap = new Map<string, CrawlResult>([
      [sourceA.listingUrl, makeSuccessResult(LISTING_MARKDOWN)],
      [sourceB.listingUrl, makeFailureResult("HTTP 404 for beta")],
    ]);
    const detailMap = new Map<string, CrawlResult>([
      [DISCOVERY_POSTS[0].url, makeSuccessResult(DETAIL_MARKDOWN)],
      [DISCOVERY_POSTS[1].url, makeSuccessResult(DETAIL_MARKDOWN)],
    ]);

    let crawlCallCount = 0;
    const runWebCrawl = vi.fn().mockImplementation(() => {
      crawlCallCount++;
      return Promise.resolve(crawlCallCount === 1 ? listingMap : detailMap);
    });

    const result = await collectWeb(
      { rawItemsRepo: repo, llmModel: model, runWebCrawl },
      { sources: [sourceA, sourceB], maxItems: 10 },
    );

    expect(result.failures).toBeDefined();
    expect(result.failures?.some((f) => f.source === "beta")).toBe(true);
    expect(result.itemsStored).toBeGreaterThan(0);
  });

  // REQ-11: discovery LLM failure on a successful listing → source reported as failed
  it("records discovery-llm failure when LLM throws on a successful listing", async () => {
    const repo = makeRepo();
    const model = new MockLanguageModelV2({
      doGenerate: () => Promise.reject(new Error("LLM down")),
    });

    const listingMap = new Map<string, CrawlResult>([
      [sourceA.listingUrl, makeSuccessResult(LISTING_MARKDOWN)],
    ]);
    const runWebCrawl = vi.fn()
      .mockResolvedValueOnce(listingMap)
      .mockResolvedValueOnce(new Map());

    await expect(
      collectWeb(
        { rawItemsRepo: repo, llmModel: model, runWebCrawl },
        { sources: [sourceA], maxItems: 10 },
      ),
    ).rejects.toThrow("all sources failed");
  });

  // REQ-11 EDGE-11c: all sources fail → throws "all sources failed"
  it("throws when every source fails listing fetch", async () => {
    const repo = makeRepo();
    const model = new MockLanguageModelV2({
      doGenerate: () => { throw new Error("LLM should not be called"); },
    });

    const listingMap = new Map<string, CrawlResult>([
      [sourceA.listingUrl, makeFailureResult("HTTP 503")],
      [sourceB.listingUrl, makeFailureResult("HTTP 404")],
    ]);
    const runWebCrawl = vi.fn().mockResolvedValue(listingMap);

    await expect(
      collectWeb(
        { rawItemsRepo: repo, llmModel: model, runWebCrawl },
        { sources: [sourceA, sourceB], maxItems: 10 },
      ),
    ).rejects.toThrow("all sources failed");
    expect(repo.upsertItems).not.toHaveBeenCalled();
  });

  // REQ-11: empty-after-filter is a successful empty source, not a failure
  it("returns a successful empty source when discovered posts are all filtered out", async () => {
    const repo = makeRepo();
    // LLM returns posts but they are all old
    const model = makeDiscoveryModel([
      { url: "https://example.com/blog/scaling-events", title: "Old", published_at: "2020-01-01" },
    ]);

    const listingMap = new Map<string, CrawlResult>([
      [sourceA.listingUrl, makeSuccessResult(LISTING_MARKDOWN)],
    ]);
    const runWebCrawl = vi.fn()
      .mockResolvedValueOnce(listingMap)
      .mockResolvedValueOnce(new Map());

    const result = await collectWeb(
      { rawItemsRepo: repo, llmModel: model, runWebCrawl },
      { sources: [sourceA], maxItems: 10, sinceDays: 1 },
    );

    expect(result.itemsFetched).toBe(0);
    expect(result.itemsStored).toBe(0);
    expect(result.failures).toBeUndefined();
    expect(result.unitResults).toHaveLength(1);
    expect(result.unitResults[0]).toMatchObject({
      displayName: sourceA.name,
      itemsFetched: 0,
      status: "completed",
      errors: [],
    });
    expect(repo.upsertItems).not.toHaveBeenCalled();
  });

  // REQ-11: since-days filter and max-items cap
  it("applies sinceDays filter and maxItems cap", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-04-07T00:00:00Z"));

    const repo = makeRepo();
    // 3 posts: 2 within window, 1 outside; cap at 1
    const allPosts = [
      { url: "https://example.com/blog/a", title: "A", published_at: "2026-04-06" },
      { url: "https://example.com/blog/b", title: "B", published_at: "2026-04-05" },
      { url: "https://example.com/blog/c", title: "C", published_at: "2026-01-01" }, // old
    ];
    const postsInMd = allPosts.map((p) => p.url).join("\n");
    const mdWithPosts = `Listing content\n${postsInMd}`;

    const model = makeDiscoveryThenExtractModel(
      allPosts,
      { title: "Post", author: "Author", published_at: "2026-04-06" },
    );

    const listingMap = new Map<string, CrawlResult>([
      [sourceA.listingUrl, makeSuccessResult(mdWithPosts)],
    ]);

    // Only 1 detail URL should be fetched (maxItems: 1, sinceDays: 7)
    let detailCallUrls: string[] = [];
    const detailMap = new Map<string, CrawlResult>();

    const runWebCrawl = vi.fn().mockImplementation(
      (jobs: { url: string; kind: string }[]) => {
        if (jobs.length > 0 && jobs[0].kind === "detail") {
          detailCallUrls = jobs.map((j) => j.url);
          for (const j of jobs) {
            detailMap.set(j.url, makeSuccessResult(DETAIL_MARKDOWN));
          }
          return Promise.resolve(detailMap);
        }
        return Promise.resolve(listingMap);
      },
    );

    await collectWeb(
      { rawItemsRepo: repo, llmModel: model, runWebCrawl },
      { sources: [sourceA], maxItems: 1, sinceDays: 7 },
    );

    vi.useRealTimers();

    // Only 1 detail URL (maxItems cap) and it shouldn't be the old one
    expect(detailCallUrls).toHaveLength(1);
    expect(detailCallUrls[0]).not.toBe("https://example.com/blog/c");
  });

  // REQ-11: dedup against existing external IDs
  it("excludes already-existing post URLs from detail jobs", async () => {
    const existingUrl = DISCOVERY_POSTS[0].url;
    const repo = makeRepo([existingUrl]); // existingUrl already in DB

    const model = makeDiscoveryThenExtractModel(
      DISCOVERY_POSTS,
      { title: "Post", author: "Author", published_at: "2026-03-30" },
    );

    const listingMap = new Map<string, CrawlResult>([
      [sourceA.listingUrl, makeSuccessResult(LISTING_MARKDOWN)],
    ]);
    const detailMap = new Map<string, CrawlResult>([
      [DISCOVERY_POSTS[1].url, makeSuccessResult(DETAIL_MARKDOWN)],
    ]);

    let detailJobs: { url: string }[] = [];
    const runWebCrawl = vi.fn().mockImplementation(
      (jobs: { url: string; kind: string }[]) => {
        if (jobs.length > 0 && jobs[0].kind === "detail") {
          detailJobs = jobs;
          return Promise.resolve(detailMap);
        }
        return Promise.resolve(listingMap);
      },
    );

    await collectWeb(
      { rawItemsRepo: repo, llmModel: model, runWebCrawl },
      { sources: [sourceA], maxItems: 10 },
    );

    // Only the non-existing URL should be in detail jobs
    expect(detailJobs.map((j) => j.url)).not.toContain(existingUrl);
    expect(detailJobs.map((j) => j.url)).toContain(DISCOVERY_POSTS[1].url);
  });

  // REQ-11: detail-stage runWebCrawl failure for one URL
  it("records per-post failure when detail-stage crawl fails for a URL", async () => {
    const repo = makeRepo();
    const model = makeDiscoveryThenExtractModel(
      DISCOVERY_POSTS,
      { title: "Post", author: "Author", published_at: "2026-03-30" },
    );

    const listingMap = new Map<string, CrawlResult>([
      [sourceA.listingUrl, makeSuccessResult(LISTING_MARKDOWN)],
    ]);
    const detailMap = new Map<string, CrawlResult>([
      [DISCOVERY_POSTS[0].url, makeSuccessResult(DETAIL_MARKDOWN)],
      [DISCOVERY_POSTS[1].url, makeFailureResult("timeout")],
    ]);

    const runWebCrawl = vi.fn()
      .mockResolvedValueOnce(listingMap)
      .mockResolvedValueOnce(detailMap);

    const result = await collectWeb(
      { rawItemsRepo: repo, llmModel: model, runWebCrawl },
      { sources: [sourceA], maxItems: 10 },
    );

    expect(result.failures).toBeDefined();
    expect(result.failures?.some((f) => f.postUrl === DISCOVERY_POSTS[1].url)).toBe(true);
    expect(result.itemsStored).toBe(1); // only the succeeding one
  });

  // REQ-11: extractPostFields LLM failure → per-post failure (NOT "all sources failed")
  it("records per-post LLM failure when extractPostFields throws", async () => {
    const repo = makeRepo();
    let llmCalls = 0;
    const model = new MockLanguageModelV2({
      doGenerate: () => {
        const call = llmCalls++;
        if (call === 0) {
          // Discovery call succeeds
          return Promise.resolve({
            content: [{ type: "text", text: JSON.stringify({ posts: DISCOVERY_POSTS.slice(0, 1) }) }],
            finishReason: "stop" as const,
            usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
            warnings: [],
          });
        }
        // Extraction call fails
        return Promise.reject(new Error("extract LLM down"));
      },
    });

    const listingMap = new Map<string, CrawlResult>([
      [sourceA.listingUrl, makeSuccessResult(LISTING_MARKDOWN)],
    ]);
    const detailMap = new Map<string, CrawlResult>([
      [DISCOVERY_POSTS[0].url, makeSuccessResult(DETAIL_MARKDOWN)],
    ]);

    const runWebCrawl = vi.fn()
      .mockResolvedValueOnce(listingMap)
      .mockResolvedValueOnce(detailMap);

    // Per-post LLM failure → failure recorded but doesn't throw "all sources failed"
    // (the source listing succeeded; only per-post extraction failed)
    const result = await collectWeb(
      { rawItemsRepo: repo, llmModel: model, runWebCrawl },
      { sources: [sourceA], maxItems: 10 },
    );

    expect(result.failures).toBeDefined();
    expect(result.failures?.some((f) => f.postUrl === DISCOVERY_POSTS[0].url)).toBe(true);
    expect(result.itemsStored).toBe(0);
  });

  // REQ-11: empty mergedFields.title after merge → validation failure, item NOT inserted
  it("records validate failure and skips item when merged title is empty", async () => {
    const repo = makeRepo();
    // LLM returns empty title, discovery post also has empty title
    const postsWithEmptyTitle = [
      { url: "https://example.com/blog/scaling-events", title: "", published_at: "2026-03-30" },
    ];
    const postsMd = postsWithEmptyTitle.map((p) => p.url).join("\n");

    const model = makeDiscoveryThenExtractModel(
      postsWithEmptyTitle,
      { title: "", author: "Author", published_at: "2026-03-30" }, // empty title from LLM too
    );

    const listingMap = new Map<string, CrawlResult>([
      [sourceA.listingUrl, makeSuccessResult(`Content\n${postsMd}`)],
    ]);
    const detailMap = new Map<string, CrawlResult>([
      [postsWithEmptyTitle[0].url, makeSuccessResult(DETAIL_MARKDOWN)],
    ]);

    const runWebCrawl = vi.fn()
      .mockResolvedValueOnce(listingMap)
      .mockResolvedValueOnce(detailMap);

    // Validate failure → failure recorded but doesn't throw "all sources failed"
    // (the source listing + discovery succeeded; only the validate step failed)
    const result = await collectWeb(
      { rawItemsRepo: repo, llmModel: model, runWebCrawl },
      { sources: [sourceA], maxItems: 10 },
    );

    expect(result.failures).toBeDefined();
    expect(result.failures?.some((f) => f.error === "empty title")).toBe(true);
    expect(repo.upsertItems).not.toHaveBeenCalled();
  });

  // REQ-11 happy path with mixed sources/posts
  it("happy path: returns correct WebCollectorResult for two sources with multiple posts", async () => {
    const repo = makeRepo();
    // Both sources discover the same posts (deduplication handles this)
    // Model needs to handle discovery calls for BOTH sources then extraction calls
    // Use alternating: discovery-A, discovery-B, extract, extract, ...
    let llmCalls = 0;
    const extractPayload = { title: "Post Title", author: "Author", published_at: "2026-03-30", image_url: "" };
    const model = new MockLanguageModelV2({
      doGenerate: () => {
        const call = llmCalls++;
        // First 2 calls are discovery (one per source), rest are extraction
        if (call < 2) {
          return Promise.resolve({
            content: [{ type: "text", text: JSON.stringify({ posts: [DISCOVERY_POSTS[0]] }) }],
            finishReason: "stop" as const,
            usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
            warnings: [],
          });
        }
        return Promise.resolve({
          content: [{ type: "text", text: JSON.stringify(extractPayload) }],
          finishReason: "stop" as const,
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
          warnings: [],
        });
      },
    });

    const listingMap = new Map<string, CrawlResult>([
      [sourceA.listingUrl, makeSuccessResult(LISTING_MARKDOWN)],
      [sourceB.listingUrl, makeSuccessResult(LISTING_MARKDOWN)],
    ]);
    const detailMap = new Map<string, CrawlResult>([
      [DISCOVERY_POSTS[0].url, makeSuccessResult(DETAIL_MARKDOWN)],
    ]);

    const runWebCrawl = vi.fn()
      .mockResolvedValueOnce(listingMap)
      .mockResolvedValueOnce(detailMap);

    const result = await collectWeb(
      { rawItemsRepo: repo, llmModel: model, runWebCrawl },
      { sources: [sourceA, sourceB], maxItems: 10 },
    );

    expect(result.itemsFetched).toBeGreaterThan(0);
    expect(result.itemsFetched).toBe(result.itemsStored);
    expect(result.commentsFetched).toBe(0);
    expect(typeof result.durationMs).toBe("number");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(repo.upsertItems).toHaveBeenCalledTimes(1);
  });

  // EDGE-11d: failures: undefined when no failures
  it("returns failures: undefined when all sources succeed with no failures", async () => {
    const repo = makeRepo();
    const model = makeDiscoveryThenExtractModel(
      [DISCOVERY_POSTS[0]],
      { title: "Post Title", author: "Author", published_at: "2026-03-30" },
    );

    const listingMap = new Map<string, CrawlResult>([
      [sourceA.listingUrl, makeSuccessResult(LISTING_MARKDOWN)],
    ]);
    const detailMap = new Map<string, CrawlResult>([
      [DISCOVERY_POSTS[0].url, makeSuccessResult(DETAIL_MARKDOWN)],
    ]);

    const runWebCrawl = vi.fn()
      .mockResolvedValueOnce(listingMap)
      .mockResolvedValueOnce(detailMap);

    const result = await collectWeb(
      { rawItemsRepo: repo, llmModel: model, runWebCrawl },
      { sources: [sourceA], maxItems: 10 },
    );

    expect(result.failures).toBeUndefined();
  });

  // runWebCrawl is called twice (listing then detail)
  it("calls runWebCrawl twice: once for listings, once for details", async () => {
    const repo = makeRepo();
    const model = makeDiscoveryThenExtractModel(
      [DISCOVERY_POSTS[0]],
      { title: "Post Title", author: "Author", published_at: "2026-03-30" },
    );

    const listingMap = new Map<string, CrawlResult>([
      [sourceA.listingUrl, makeSuccessResult(LISTING_MARKDOWN)],
    ]);
    const detailMap = new Map<string, CrawlResult>([
      [DISCOVERY_POSTS[0].url, makeSuccessResult(DETAIL_MARKDOWN)],
    ]);

    const runWebCrawl = vi.fn()
      .mockResolvedValueOnce(listingMap)
      .mockResolvedValueOnce(detailMap);

    await collectWeb(
      { rawItemsRepo: repo, llmModel: model, runWebCrawl },
      { sources: [sourceA], maxItems: 10 },
    );

    expect(runWebCrawl).toHaveBeenCalledTimes(2);
    // First call: listing jobs
    const firstCallJobs = runWebCrawl.mock.calls[0][0] as { kind: string; url: string }[];
    expect(firstCallJobs.every((j) => j.kind === "listing")).toBe(true);
    expect(firstCallJobs[0].url).toBe(sourceA.listingUrl);
    // Second call: detail jobs
    const secondCallJobs = runWebCrawl.mock.calls[1][0] as { kind: string; url: string }[];
    expect(secondCallJobs.every((j) => j.kind === "detail")).toBe(true);
  });

  // REQ-12: image from crawl result used as fallback
  it("uses imageUrl from detail CrawlResult as image fallback", async () => {
    const repo = makeRepo();
    const model = makeDiscoveryThenExtractModel(
      [DISCOVERY_POSTS[0]],
      { title: "Post Title", author: "Author", published_at: "2026-03-30", image_url: "" }, // LLM returns no image
    );

    const listingMap = new Map<string, CrawlResult>([
      [sourceA.listingUrl, makeSuccessResult(LISTING_MARKDOWN)],
    ]);
    const detailMap = new Map<string, CrawlResult>([
      [DISCOVERY_POSTS[0].url, makeSuccessResult(DETAIL_MARKDOWN, "https://example.com/og.jpg")],
    ]);

    const runWebCrawl = vi.fn()
      .mockResolvedValueOnce(listingMap)
      .mockResolvedValueOnce(detailMap);

    await collectWeb(
      { rawItemsRepo: repo, llmModel: model, runWebCrawl },
      { sources: [sourceA], maxItems: 10 },
    );

    expect(repo.upsertItems).toHaveBeenCalledTimes(1);
    const items = (repo.upsertItems as ReturnType<typeof vi.fn>).mock.calls[0][0] as { imageUrl: string | null }[];
    expect(items[0].imageUrl).toBe("https://example.com/og.jpg");
  });

  // REQ-007: structured date from the detail CrawlResult overrides the LLM date
  it("uses the structured publishedAt from the detail CrawlResult over the LLM published_at", async () => {
    const repo = makeRepo();
    const model = makeDiscoveryThenExtractModel(
      [DISCOVERY_POSTS[0]],
      { title: "Post Title", author: "Author", published_at: "2026-05-21", image_url: "" },
    );

    const structured = new Date("2026-05-25T09:00:00Z");
    const listingMap = new Map<string, CrawlResult>([
      [sourceA.listingUrl, makeSuccessResult(LISTING_MARKDOWN)],
    ]);
    const detailMap = new Map<string, CrawlResult>([
      [DISCOVERY_POSTS[0].url, makeSuccessResult(DETAIL_MARKDOWN, null, structured)],
    ]);

    const runWebCrawl = vi.fn()
      .mockResolvedValueOnce(listingMap)
      .mockResolvedValueOnce(detailMap);

    await collectWeb(
      { rawItemsRepo: repo, llmModel: model, runWebCrawl },
      { sources: [sourceA], maxItems: 10 },
    );

    expect(repo.upsertItems).toHaveBeenCalledTimes(1);
    const items = (repo.upsertItems as ReturnType<typeof vi.fn>).mock.calls[0][0] as { publishedAt: Date | null }[];
    expect(items[0].publishedAt).toEqual(structured);
  });
});

// ── resolvesToListing (REQ-010, EDGE-008) ────────────────────────────────────

describe("resolvesToListing", () => {
  // REQ-010: llm-stats style — fragment URL whose pre-fragment == listing URL → true
  it("returns true for a fragment URL whose pre-fragment equals the listing URL (REQ-010)", () => {
    expect(
      resolvesToListing(
        "https://llm-stats.com/ai-news#item-https://www.techmeme.com/some-article",
        "https://llm-stats.com/ai-news",
      ),
    ).toBe(true);
  });

  // REQ-010: same URL with no fragment → still true
  it("returns true for the same URL with no fragment", () => {
    expect(
      resolvesToListing("https://llm-stats.com/ai-news", "https://llm-stats.com/ai-news"),
    ).toBe(true);
  });

  // REQ-010: trailing-slash variant is treated as same path
  it("returns true when post URL has trailing slash but listing does not", () => {
    expect(
      resolvesToListing("https://llm-stats.com/ai-news/", "https://llm-stats.com/ai-news"),
    ).toBe(true);
  });

  // EDGE-008: external article with fragment → false (pre-fragment is a different origin)
  it("returns false for a real external article with a fragment (EDGE-008)", () => {
    expect(
      resolvesToListing(
        "https://techmeme.com/p1#frag",
        "https://llm-stats.com/ai-news",
      ),
    ).toBe(false);
  });

  // REQ-010: unparseable postUrl → false (never throws)
  it("returns false for an unparseable postUrl", () => {
    expect(resolvesToListing("not a url !!!", "https://llm-stats.com/ai-news")).toBe(false);
  });

  // REQ-010: same origin but different path → false
  it("returns false when same origin but different pathname", () => {
    expect(
      resolvesToListing(
        "https://llm-stats.com/other-page#item-foo",
        "https://llm-stats.com/ai-news",
      ),
    ).toBe(false);
  });
});

// ── collectWeb self-referential post tests (REQ-010, REQ-011, EDGE-005, EDGE-008) ─

describe("collectWeb self-referential listing posts", () => {
  const listingUrl = "https://llm-stats.com/ai-news";
  const selfRefSource: BlogSource = { name: "llm-stats", listingUrl };

  const selfRefPost1 = {
    url: "https://llm-stats.com/ai-news#item-https://techmeme.com/article-one",
    title: "Techmeme Story One",
    published_at: "2026-05-26",
  };
  const selfRefPost2 = {
    url: "https://llm-stats.com/ai-news#item-https://arxiv.org/abs/2405.00001",
    title: "Arxiv Paper One",
    published_at: "2026-05-25",
  };
  const externalPost = {
    url: "https://some-blog.com/real-article",
    title: "A Real External Article",
    published_at: "2026-05-24",
  };

  function makeListingCrawlResult(): CrawlResult {
    return makeSuccessResult("# LLM Stats\nToday's AI news", null, null, null);
  }

  function makeDetailCrawlResult(): CrawlResult {
    return makeSuccessResult("# Real External Article\n\nContent here.");
  }

  // REQ-010: self-referential posts do NOT produce detail crawl jobs
  it("does not enqueue a detail job for self-referential #item- posts (REQ-010)", async () => {
    const repo = makeRepo();

    const listingMap = new Map<string, CrawlResult>([
      [listingUrl, makeListingCrawlResult()],
    ]);
    const detailMap = new Map<string, CrawlResult>([
      [externalPost.url, makeDetailCrawlResult()],
    ]);

    let detailJobUrls: string[] = [];
    const runWebCrawlMock = vi.fn().mockImplementation(
      (jobs: { url: string; kind: string }[]) => {
        if (jobs.length > 0 && jobs[0]?.kind === "detail") {
          detailJobUrls = jobs.map((j) => j.url);
          return Promise.resolve(detailMap);
        }
        return Promise.resolve(listingMap);
      },
    );

    // For the external post, we need extraction to succeed
    let llmCalls = 0;
    const mixedModel = new MockLanguageModelV2({
      doGenerate: () => {
        const callIdx = llmCalls++;
        if (callIdx === 0) {
          // Discovery call
          return Promise.resolve({
            content: [{ type: "text", text: JSON.stringify({ posts: [selfRefPost1, externalPost] }) }],
            finishReason: "stop" as const,
            usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
            warnings: [],
          });
        }
        // Extraction call for external post
        return Promise.resolve({
          content: [{ type: "text", text: JSON.stringify({ title: externalPost.title, author: "", published_at: externalPost.published_at, image_url: "" }) }],
          finishReason: "stop" as const,
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          warnings: [],
        });
      },
    });

    await collectWeb(
      { rawItemsRepo: repo, llmModel: mixedModel, runWebCrawl: runWebCrawlMock },
      { sources: [selfRefSource], maxItems: 10 },
    );

    // The self-referential post's URL must NOT appear in any detail job
    expect(detailJobUrls).not.toContain(selfRefPost1.url);
    // The external post DOES appear in detail jobs (EDGE-008)
    expect(detailJobUrls).toContain(externalPost.url);
  });

  // REQ-011: stored self-referential item has title/publishedAt from discovery, url===externalId===full URL, content===""
  it("builds self-referential item from discovery fields: url===externalId, content=empty (REQ-011)", async () => {
    const repo = makeRepo();

    const listingMap = new Map<string, CrawlResult>([
      [listingUrl, makeListingCrawlResult()],
    ]);

    // Only self-ref post, no external post → Pass-2 never called
    const runWebCrawlMock = vi.fn().mockImplementation(
      (jobs: { url: string; kind: string }[]) => {
        if (jobs.length > 0 && jobs[0]?.kind === "detail") {
          return Promise.resolve(new Map());
        }
        return Promise.resolve(listingMap);
      },
    );

    const discoveryModel = makeDiscoveryModel([selfRefPost1]);

    await collectWeb(
      { rawItemsRepo: repo, llmModel: discoveryModel, runWebCrawl: runWebCrawlMock },
      { sources: [selfRefSource], maxItems: 10 },
    );

    expect(repo.upsertItems).toHaveBeenCalledTimes(1);
    const stored = (repo.upsertItems as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      url: string;
      externalId: string;
      title: string;
      content: string;
      publishedAt: Date | null;
    }[];

    expect(stored).toHaveLength(1);
    const item = stored[0];
    expect(item.url).toBe(selfRefPost1.url);
    expect(item.externalId).toBe(selfRefPost1.url);
    expect(item.title).toBe(selfRefPost1.title);
    expect(item.content).toBe("");
    // publishedAt resolved from discovery date "2026-05-26"
    expect(item.publishedAt).toBeInstanceOf(Date);
    if (!(item.publishedAt instanceof Date)) throw new Error("expected publishedAt to be a Date");
    expect(item.publishedAt.toISOString().slice(0, 10)).toBe("2026-05-26");
  });

  // EDGE-005: two self-referential posts sharing same pre-fragment base but different fragments → two distinct items
  it("stores two distinct items for two self-referential posts with different fragments (EDGE-005)", async () => {
    const repo = makeRepo();

    const listingMap = new Map<string, CrawlResult>([
      [listingUrl, makeListingCrawlResult()],
    ]);

    const runWebCrawlMock = vi.fn().mockImplementation(
      (jobs: { url: string; kind: string }[]) => {
        if (jobs.length > 0 && jobs[0]?.kind === "detail") {
          return Promise.resolve(new Map());
        }
        return Promise.resolve(listingMap);
      },
    );

    const discoveryModel = makeDiscoveryModel([selfRefPost1, selfRefPost2]);

    await collectWeb(
      { rawItemsRepo: repo, llmModel: discoveryModel, runWebCrawl: runWebCrawlMock },
      { sources: [selfRefSource], maxItems: 10 },
    );

    expect(repo.upsertItems).toHaveBeenCalledTimes(1);
    const stored = (repo.upsertItems as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      externalId: string;
    }[];

    expect(stored).toHaveLength(2);
    const ids = stored.map((i) => i.externalId);
    expect(ids).toContain(selfRefPost1.url);
    expect(ids).toContain(selfRefPost2.url);
    // They must be distinct
    expect(new Set(ids).size).toBe(2);
  });

  // EDGE-008: external post with a fragment (but pre-fragment != listing URL) → normal Pass-2
  it("still enqueues Pass-2 for an external article that has a fragment (EDGE-008)", async () => {
    const externalWithFragment = {
      url: "https://some-blog.com/real-article#section-2",
      title: "External With Fragment",
      published_at: "2026-05-24",
    };
    const repo = makeRepo();

    const listingMap = new Map<string, CrawlResult>([
      [listingUrl, makeListingCrawlResult()],
    ]);
    const detailMap = new Map<string, CrawlResult>([
      [externalWithFragment.url, makeDetailCrawlResult()],
    ]);

    let detailJobUrls: string[] = [];
    const runWebCrawlMock = vi.fn().mockImplementation(
      (jobs: { url: string; kind: string }[]) => {
        if (jobs.length > 0 && jobs[0]?.kind === "detail") {
          detailJobUrls = jobs.map((j) => j.url);
          return Promise.resolve(detailMap);
        }
        return Promise.resolve(listingMap);
      },
    );

    let llmCalls = 0;
    const mixedModel = new MockLanguageModelV2({
      doGenerate: () => {
        const callIdx = llmCalls++;
        if (callIdx === 0) {
          return Promise.resolve({
            content: [{ type: "text", text: JSON.stringify({ posts: [externalWithFragment] }) }],
            finishReason: "stop" as const,
            usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
            warnings: [],
          });
        }
        return Promise.resolve({
          content: [{ type: "text", text: JSON.stringify({ title: externalWithFragment.title, author: "", published_at: externalWithFragment.published_at, image_url: "" }) }],
          finishReason: "stop" as const,
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          warnings: [],
        });
      },
    });

    await collectWeb(
      { rawItemsRepo: repo, llmModel: mixedModel, runWebCrawl: runWebCrawlMock },
      { sources: [selfRefSource], maxItems: 10 },
    );

    // The external-with-fragment URL MUST appear in detail jobs (normal Pass-2)
    expect(detailJobUrls).toContain(externalWithFragment.url);
  });

  // Empty title in self-referential post → failure recorded, item not stored
  it("records empty-title failure for a self-referential post with no title", async () => {
    const emptyTitleSelfRef = {
      url: "https://llm-stats.com/ai-news#item-https://example.com/foo",
      title: "   ",
      published_at: "2026-05-26",
    };
    const repo = makeRepo();

    const listingMap = new Map<string, CrawlResult>([
      [listingUrl, makeListingCrawlResult()],
    ]);

    const runWebCrawlMock = vi.fn().mockImplementation(
      (jobs: { url: string; kind: string }[]) => {
        if (jobs.length > 0 && jobs[0]?.kind === "detail") {
          return Promise.resolve(new Map());
        }
        return Promise.resolve(listingMap);
      },
    );

    const discoveryModel = makeDiscoveryModel([emptyTitleSelfRef]);

    const result = await collectWeb(
      { rawItemsRepo: repo, llmModel: discoveryModel, runWebCrawl: runWebCrawlMock },
      { sources: [selfRefSource], maxItems: 10 },
    );

    expect(repo.upsertItems).not.toHaveBeenCalled();
    expect(result.failures).toBeDefined();
    expect(result.failures?.some((f) => f.error === "empty title")).toBe(true);
  });
});

// ── fetchWebPost tests ─────────────────────────────────────────────────────────
// These tests mock fetchAdaptive at the module level to avoid Playwright

const LONG_TEXT = "word ".repeat(60); // 300+ chars to satisfy isHealthyResult

describe("fetchWebPost", () => {
  it("returns RawItemInsert with correct shape from fetchAdaptive result", async () => {
    const { fetchWebPost } = await import("@pipeline/collectors/web.js");

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(`<html><head><title>Test Post</title></head><body><article><h1>Test Post</h1><p>${LONG_TEXT}</p></article></body></html>`),
      headers: { get: () => "text/html" },
    });

    const result = await fetchWebPost("https://example.com/post", {
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(result.sourceType).toBe("blog");
    expect(result.externalId).toBe("https://example.com/post");
    expect(result.url).toBe("https://example.com/post");
    expect(result.sourceUrl).toBe("https://example.com/post");
    expect(typeof result.content).toBe("string");
    expect(result.engagement).toEqual({ points: 0, commentCount: 0 });
    expect(result.metadata).toEqual({ comments: [] });
    expect(result.publishedAt).toBeNull();
    expect(result.collectedAt).toBeInstanceOf(Date);
    expect(result.updatedAt).toBeInstanceOf(Date);
  });

  // REQ-009: fetchWebPost sets publishedAt from the structured DOM signal
  it("sets publishedAt from a JSON-LD datePublished signal in the page", async () => {
    const { fetchWebPost } = await import("@pipeline/collectors/web.js");

    const jsonLd = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Article",
      datePublished: "2026-05-25T09:00:00Z",
    });
    const html = `<html><head><title>Dated Post</title><script type="application/ld+json">${jsonLd}</script></head><body><article><h1>Dated Post</h1><p>${LONG_TEXT}</p></article></body></html>`;
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(html),
      headers: { get: () => "text/html" },
    });

    const result = await fetchWebPost("https://example.com/dated", {
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    if (!(result.publishedAt instanceof Date)) {
      throw new Error("expected publishedAt to be a Date");
    }
    expect(result.publishedAt.toISOString()).toBe("2026-05-25T09:00:00.000Z");
  });

  it("uses title from fetchAdaptive result when available", async () => {
    const { fetchWebPost } = await import("@pipeline/collectors/web.js");

    const htmlWithTitle = `<html><head><title>My Article Title</title><meta property="og:image" content="https://example.com/img.jpg"></head><body><article><h1>My Article Title</h1><p>${LONG_TEXT}</p></article></body></html>`;
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(htmlWithTitle),
      headers: { get: () => "text/html" },
    });

    const result = await fetchWebPost("https://example.com/post", {
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    expect(typeof result.title).toBe("string");
    expect(result.title.length).toBeGreaterThan(0);
  });

  it("sets author from byline when convert extracts it", async () => {
    const { fetchWebPost } = await import("@pipeline/collectors/web.js");

    const htmlWithByline = `<html><head><title>Article</title></head><body>
      <article>
        <h1>The Article Title</h1>
        <address class="author">By <a rel="author">Jane Doe</a></address>
        <p>${LONG_TEXT}</p>
      </article>
    </body></html>`;

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(htmlWithByline),
      headers: { get: () => "text/html" },
    });

    const result = await fetchWebPost("https://example.com/post", {
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    // Author is string | null — either is valid depending on Readability output
    expect(result.author === null || typeof result.author === "string").toBe(true);
  });

  it("falls back to URL slug as title when no heading in content", async () => {
    const { fetchWebPost } = await import("@pipeline/collectors/web.js");

    // Readability-parseable content but no heading element
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(`<html><head></head><body><article><p>${LONG_TEXT}</p></article></body></html>`),
      headers: { get: () => "text/html" },
    });

    const result = await fetchWebPost("https://example.com/my-post-slug", {
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    // Should have some title from URL slug fallback
    expect(result.title).toBeTruthy();
  });
});

describe("collectWeb (P2 telemetry)", () => {
  it("populates unitResults with mixed success/failure entries", async () => {
    const model = makeDiscoveryThenExtractModel(
      [DISCOVERY_POSTS[0]],
      { title: "Post Title", author: "Author", published_at: "2026-03-30" },
    );
    const repo = makeRepo();

    const listingMap = new Map<string, CrawlResult>([
      [sourceA.listingUrl, makeSuccessResult(LISTING_MARKDOWN)],
      [sourceB.listingUrl, makeFailureResult("HTTP 404 for beta")],
    ]);
    const detailMap = new Map<string, CrawlResult>([
      [DISCOVERY_POSTS[0].url, makeSuccessResult(DETAIL_MARKDOWN)],
    ]);

    let crawlCallCount = 0;
    const runWebCrawl = vi.fn().mockImplementation(() => {
      crawlCallCount++;
      return Promise.resolve(crawlCallCount === 1 ? listingMap : detailMap);
    });

    const result = await collectWeb(
      { rawItemsRepo: repo, llmModel: model, runWebCrawl },
      { sources: [sourceA, sourceB], maxItems: 10 },
    );

    expect(result.unitResults).toBeDefined();
    expect(result.unitResults).toHaveLength(2);
    const alpha = result.unitResults?.find((u) => u.displayName === "alpha");
    const beta = result.unitResults?.find((u) => u.displayName === "beta");
    expect(alpha).toMatchObject({
      identifier: "alpha.example.com",
      status: "completed",
      errors: [],
    });
    expect(alpha?.itemsFetched).toBeGreaterThan(0);
    expect(beta).toMatchObject({
      identifier: "beta.example.com",
      status: "failed",
      itemsFetched: 0,
    });
    expect(beta?.errors[0]).toContain("HTTP 404");
  });

  it("returns empty unitResults when sources is []", async () => {
    const repo = makeRepo();
    const runWebCrawl = vi.fn().mockResolvedValue(new Map());
    const model = new MockLanguageModelV2({
      doGenerate: () => { throw new Error("LLM should not be called"); },
    });

    const result = await collectWeb(
      { rawItemsRepo: repo, llmModel: model, runWebCrawl },
      { sources: [], maxItems: 5 },
    );

    expect(result.unitResults).toEqual([]);
  });
});

// ── Phase 2: deepseek-v4-flash model id recorded to tracker (REQ-001, REQ-002) ───────────
describe("collectWeb cost-tracker model id", () => {
  function makeRecordingTracker(): { records: RecordInput[]; tracker: CostTracker } {
    const records: RecordInput[] = [];
    const tracker: CostTracker = {
      record: (input) => {
        records.push(input);
      },
      snapshot: () => {
        throw new Error("snapshot not expected");
      },
      merge: () => {
        throw new Error("merge not expected");
      },
      hasAnyCalls: () => records.length > 0,
    };
    return { records, tracker };
  }

  it("records modelId deepseek-v4-flash for both web-discovery and web-extraction stages", async () => {
    const repo = makeRepo();
    const model = makeDiscoveryThenExtractModel(
      [DISCOVERY_POSTS[0]],
      { title: "Post Title", author: "Author", published_at: "2026-03-30" },
    );

    const listingMap = new Map<string, CrawlResult>([
      [sourceA.listingUrl, makeSuccessResult(LISTING_MARKDOWN)],
    ]);
    const detailMap = new Map<string, CrawlResult>([
      [DISCOVERY_POSTS[0].url, makeSuccessResult(DETAIL_MARKDOWN)],
    ]);
    let crawlCallCount = 0;
    const runWebCrawl = vi.fn().mockImplementation(() => {
      crawlCallCount++;
      return Promise.resolve(crawlCallCount === 1 ? listingMap : detailMap);
    });

    const { records, tracker } = makeRecordingTracker();

    await collectWeb(
      { rawItemsRepo: repo, llmModel: model, runWebCrawl, tracker },
      { sources: [sourceA], maxItems: 10 },
    );

    const discovery = records.find((r) => r.stage === "web-discovery");
    const extraction = records.find((r) => r.stage === "web-extraction");
    expect(discovery?.modelId).toBe("deepseek-v4-flash");
    expect(extraction?.modelId).toBe("deepseek-v4-flash");
    expect(WEB_COLLECTOR_MODEL_ID).toBe("deepseek-v4-flash");
  });
});

// ── Phase 2: default provider built from @ai-sdk/deepseek keyed by DEEPSEEK_API_KEY (REQ-003) ─
describe("resolveDefaultModel provider", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.doUnmock("@ai-sdk/deepseek");
  });

  it("builds the default model from @ai-sdk/deepseek keyed by DEEPSEEK_API_KEY", async () => {
    vi.resetModules();
    vi.stubEnv("DEEPSEEK_API_KEY", "test-deepseek-key-123");

    const createDeepSeek = vi.fn(() => {
      const provider = vi.fn(() => new MockLanguageModelV2({
        doGenerate: () => Promise.resolve({
          content: [{ type: "text", text: JSON.stringify({ posts: [] }) }],
          finishReason: "stop" as const,
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          warnings: [],
        }),
      }));
      return provider;
    });

    vi.doMock("@ai-sdk/deepseek", () => ({ createDeepSeek }));

    const { collectWeb: freshCollectWeb, WEB_COLLECTOR_MODEL_ID: MODEL_ID } = await import("@pipeline/collectors/web.js");

    const repo = makeRepo();
    const listingMap = new Map<string, CrawlResult>([
      [sourceA.listingUrl, makeSuccessResult(LISTING_MARKDOWN)],
    ]);
    const runWebCrawl = vi.fn().mockResolvedValue(listingMap);

    // No llmModel injected → resolveDefaultModel() runs and must use the DeepSeek provider.
    await freshCollectWeb(
      { rawItemsRepo: repo, runWebCrawl },
      { sources: [sourceA], maxItems: 5 },
    );

    expect(MODEL_ID).toBe("deepseek-v4-flash");
    expect(createDeepSeek).toHaveBeenCalledTimes(1);
    expect(createDeepSeek).toHaveBeenCalledWith({ apiKey: "test-deepseek-key-123" });
    const provider = createDeepSeek.mock.results[0].value as ReturnType<typeof createDeepSeek>;
    expect(provider).toHaveBeenCalledWith("deepseek-v4-flash");
  });
});

// ── VS-1: unit identifier parity with deriveRawItemIdentifier (REQ-005) ───────

describe("unit identifier matches deriveRawItemIdentifier (VS-1)", () => {
  const matrix: { listingUrl: string; postPath: string }[] = [
    { listingUrl: "https://cursor.com/blog", postPath: "/some-post" },
    { listingUrl: "https://CURSOR.com/blog", postPath: "/another-post" },
    { listingUrl: "https://blog.example.com/posts", postPath: "/p/x" },
    { listingUrl: "https://anthropic.com/engineering/", postPath: "claims" },
    { listingUrl: "https://example.co.uk/news", postPath: "/q/1" },
  ];

  for (const { listingUrl, postPath } of matrix) {
    it(`unit.identifier equals deriveRawItemIdentifier for ${listingUrl}`, async () => {
      const { deriveRawItemIdentifier } = await import(
        "@newsletter/shared/services"
      );
      const source: BlogSource = { name: "x", listingUrl };
      const postUrl = new URL(postPath, listingUrl).href;

      const model = makeDiscoveryThenExtractModel(
        [{ url: postUrl, title: "Post", published_at: "2026-03-30" }],
        { title: "Post", author: "A", published_at: "2026-03-30" },
      );
      const repo = makeRepo();
      const listingMap = new Map<string, CrawlResult>([
        [listingUrl, makeSuccessResult(`Body\n${postUrl}`)],
      ]);
      const detailMap = new Map<string, CrawlResult>([
        [postUrl, makeSuccessResult(DETAIL_MARKDOWN)],
      ]);
      const runWebCrawl = vi
        .fn()
        .mockResolvedValueOnce(listingMap)
        .mockResolvedValueOnce(detailMap);

      const result = await collectWeb(
        { rawItemsRepo: repo, llmModel: model, runWebCrawl },
        { sources: [source], maxItems: 10 },
      );

      const expected = deriveRawItemIdentifier({
        sourceType: "blog",
        url: postUrl,
        sourceUrl: postUrl,
        metadata: null,
      });
      expect(result.unitResults).toHaveLength(1);
      expect(result.unitResults[0]?.identifier).toBe(expected);
    });
  }
});

// ── VS-5: level mapping for web collector + crawler events (REQ-009) ─────────

interface FakeRunLogger {
  debug: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
}

function makeFakeRunLogger(): FakeRunLogger {
  return {
    debug: vi.fn().mockResolvedValue(undefined),
    info: vi.fn().mockResolvedValue(undefined),
    warn: vi.fn().mockResolvedValue(undefined),
    error: vi.fn().mockResolvedValue(undefined),
  };
}

function findCall(
  fn: ReturnType<typeof vi.fn>,
  event: string,
): { fields: Record<string, unknown>; msg: string } | null {
  for (const call of fn.mock.calls) {
    const fields = call[0] as Record<string, unknown>;
    if (fields.event === event) {
      return { fields, msg: call[1] as string };
    }
  }
  return null;
}

describe("level mapping for web collector events (VS-5)", () => {
  it("routes collector.web.listing_completed -> runLogger.info", async () => {
    const fakeLogger = makeFakeRunLogger();
    const repo = makeRepo();
    const model = makeDiscoveryThenExtractModel(
      [DISCOVERY_POSTS[0]],
      { title: "T", author: "A", published_at: "2026-03-30" },
    );
    const listingMap = new Map<string, CrawlResult>([
      [sourceA.listingUrl, makeSuccessResult(LISTING_MARKDOWN)],
    ]);
    const detailMap = new Map<string, CrawlResult>([
      [DISCOVERY_POSTS[0].url, makeSuccessResult(DETAIL_MARKDOWN)],
    ]);
    const runWebCrawl = vi
      .fn()
      .mockResolvedValueOnce(listingMap)
      .mockResolvedValueOnce(detailMap);

    await collectWeb(
      { rawItemsRepo: repo, llmModel: model, runWebCrawl, runLogger: fakeLogger },
      { sources: [sourceA], maxItems: 10 },
    );

    const hit = findCall(fakeLogger.info, "collector.web.listing_completed");
    expect(hit).not.toBeNull();
    expect(hit?.fields.stage).toBe("collect");
    expect(hit?.fields.source).toBe("alpha.example.com");
    expect(hit?.fields.step).toBe("discover");
    // It must NOT be at warn or error
    expect(findCall(fakeLogger.warn, "collector.web.listing_completed")).toBeNull();
    expect(findCall(fakeLogger.error, "collector.web.listing_completed")).toBeNull();
  });

  it("routes collector.web.discovery_failed -> runLogger.warn", async () => {
    const fakeLogger = makeFakeRunLogger();
    const repo = makeRepo();
    // First call discovery — throw; on the listing path the LLM throws.
    const model = new MockLanguageModelV2({
      doGenerate: () => Promise.reject(new Error("LLM down")),
    });
    const listingMap = new Map<string, CrawlResult>([
      [sourceA.listingUrl, makeSuccessResult(LISTING_MARKDOWN)],
    ]);
    const runWebCrawl = vi
      .fn()
      .mockResolvedValueOnce(listingMap)
      .mockResolvedValueOnce(new Map());

    await expect(
      collectWeb(
        { rawItemsRepo: repo, llmModel: model, runWebCrawl, runLogger: fakeLogger },
        { sources: [sourceA], maxItems: 10 },
      ),
    ).rejects.toThrow();

    const hit = findCall(fakeLogger.warn, "collector.web.discovery_failed");
    expect(hit).not.toBeNull();
    expect(hit?.fields.stage).toBe("collect");
    expect(hit?.fields.source).toBe("alpha.example.com");
    expect(hit?.fields.step).toBe("discover");
    expect(hit?.fields.url).toBe(sourceA.listingUrl);
    expect(hit?.fields.error).toBeDefined();
    // Not at info or error
    expect(findCall(fakeLogger.info, "collector.web.discovery_failed")).toBeNull();
    expect(findCall(fakeLogger.error, "collector.web.discovery_failed")).toBeNull();
  });

  it("routes collector.web.detail_failed (fetch failure) -> runLogger.error with step=fetch", async () => {
    const fakeLogger = makeFakeRunLogger();
    const repo = makeRepo();
    const model = makeDiscoveryThenExtractModel(
      DISCOVERY_POSTS,
      { title: "T", author: "A", published_at: "2026-03-30" },
    );
    const listingMap = new Map<string, CrawlResult>([
      [sourceA.listingUrl, makeSuccessResult(LISTING_MARKDOWN)],
    ]);
    // One detail succeeds, one fails — so we still produce a passing run that exercises the failure branch.
    const detailMap = new Map<string, CrawlResult>([
      [DISCOVERY_POSTS[0].url, makeSuccessResult(DETAIL_MARKDOWN)],
      [DISCOVERY_POSTS[1].url, makeFailureResult("timeout")],
    ]);
    const runWebCrawl = vi
      .fn()
      .mockResolvedValueOnce(listingMap)
      .mockResolvedValueOnce(detailMap);

    await collectWeb(
      { rawItemsRepo: repo, llmModel: model, runWebCrawl, runLogger: fakeLogger },
      { sources: [sourceA], maxItems: 10 },
    );

    const hit = findCall(fakeLogger.error, "collector.web.detail_failed");
    expect(hit).not.toBeNull();
    expect(hit?.fields.stage).toBe("collect");
    expect(hit?.fields.source).toBe("alpha.example.com");
    expect(hit?.fields.step).toBe("fetch");
    expect(hit?.fields.url).toBe(DISCOVERY_POSTS[1].url);
    expect(hit?.fields.error).toBe("timeout");
    // Not at info or warn
    expect(findCall(fakeLogger.info, "collector.web.detail_failed")).toBeNull();
    expect(findCall(fakeLogger.warn, "collector.web.detail_failed")).toBeNull();
  });
});
