import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import type { Candidate, UserProfile, RawItemComment } from "@newsletter/shared";

const { mockLoggerInfo, mockLoggerError, mockLoggerWarn } = vi.hoisted(() => ({
  mockLoggerInfo: vi.fn(),
  mockLoggerError: vi.fn(),
  mockLoggerWarn: vi.fn(),
}));

vi.mock("@newsletter/shared", async () => {
  const actual =
    await vi.importActual<typeof import("@newsletter/shared")>(
      "@newsletter/shared",
    );
  return {
    ...actual,
    createLogger: vi.fn(() => ({
      info: mockLoggerInfo,
      warn: mockLoggerWarn,
      error: mockLoggerError,
    })),
  };
});

import {
  rankCandidates,
  AUTHORITY_WEIGHTS,
  ENGAGEMENT_SOURCE_MAX,
  normalizeEngagement,
} from "@pipeline/processors/rank.js";

interface GenerateArgs {
  model: unknown;
  system: string;
  prompt: string;
  schema: z.ZodType;
  temperature?: number;
}

// Profiled LLM response — 4 axes each 1-5
interface ProfiledEntry {
  id: number;
  relevance: number;
  novelty: number;
  signalVsHype: number;
  actionability: number;
  rationale: string;
}

// No-profile LLM response — 3 axes each 1-5
interface NoProfileEntry {
  id: number;
  novelty: number;
  signalVsHype: number;
  actionability: number;
  rationale: string;
}

type LLMEntry = ProfiledEntry | NoProfileEntry;

function makeGenerate(
  response: { ranked: LLMEntry[] } | Error,
): ReturnType<typeof vi.fn> {
  return vi.fn((args: GenerateArgs) => {
    void args;
    if (response instanceof Error) return Promise.reject(response);
    return Promise.resolve({ object: response });
  });
}

function makeProfiledEntry(
  id: number,
  axes: { relevance: number; novelty: number; signalVsHype: number; actionability: number },
  rationale = "strong relevance — matches profile",
): ProfiledEntry {
  return { id, ...axes, rationale };
}

function makeNoProfileEntry(
  id: number,
  axes: { novelty: number; signalVsHype: number; actionability: number },
  rationale = "strong novelty — new angle",
): NoProfileEntry {
  return { id, ...axes, rationale };
}

function makeCandidate(
  id: number,
  overrides: Partial<Candidate> = {},
): Candidate {
  return {
    id,
    title: `title-${id}`,
    url: `https://example.com/${id}`,
    sourceType: "hn",
    author: null,
    publishedAt: new Date("2026-04-07T00:00:00Z"),
    engagement: { points: 0, commentCount: 0 },
    content: "body content",
    comments: [],
    ...overrides,
  };
}

function makeComment(id: string, content: string): RawItemComment {
  return { id, author: "anon", content, publishedAt: "2026-04-07T00:00:00Z" };
}

const profile: UserProfile = {
  name: "aman",
  topics: ["agent frameworks", "evals"],
  antiTopics: ["crypto"],
};

const stubLoadBodies = (
  candidates: Candidate[],
): Promise<Map<number, string | null>> => {
  const map = new Map<number, string | null>();
  for (const c of candidates) map.set(c.id, c.content);
  return Promise.resolve(map);
};

describe("rankCandidates", () => {
  const originalModel = process.env.RANKING_MODEL;
  const originalKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    delete process.env.RANKING_MODEL;
    process.env.ANTHROPIC_API_KEY = "test-key";
    mockLoggerInfo.mockClear();
    mockLoggerError.mockClear();
    mockLoggerWarn.mockClear();
  });

  afterEach(() => {
    if (originalModel === undefined) delete process.env.RANKING_MODEL;
    else process.env.RANKING_MODEL = originalModel;
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
  });

  it("returns empty result for empty shortlist without calling generate", async () => {
    const generateObject = makeGenerate({ ranked: [] });

    const result = await rankCandidates([], {
      profile,
      topN: 5,
      generateObject,
      loadBodies: stubLoadBodies,
    });

    expect(generateObject).not.toHaveBeenCalled();
    expect(result).toEqual({
      rankedItems: [],
      candidateCount: 0,
      rankedCount: 0,
    });
  });

  it("presents all 9 fields per item in the prompt (REQ-060)", async () => {
    const candidate = makeCandidate(1, {
      title: "An article",
      url: "https://x.test/1",
      sourceType: "hn",
      publishedAt: new Date("2026-04-07T00:00:00Z"),
      content: "interesting body text",
      comments: [makeComment("c1", "first comment")],
    });
    const generateObject = makeGenerate({
      ranked: [makeProfiledEntry(1, { relevance: 4, novelty: 3, signalVsHype: 4, actionability: 3 })],
    });
    const now = new Date("2026-04-07T04:00:00Z");

    await rankCandidates([candidate], {
      profile,
      topN: 5,
      generateObject,
      loadBodies: stubLoadBodies,
      now,
    });

    const call = generateObject.mock.calls[0]?.[0] as GenerateArgs;
    expect(call.prompt).toContain('"id": 1');
    expect(call.prompt).toContain("An article");
    expect(call.prompt).toContain("https://x.test/1");
    expect(call.prompt).toContain("hn");
    expect(call.prompt).toContain("2026-04-07T00:00:00");
    expect(call.prompt).toContain("ago");
    expect(call.prompt).toContain("interesting body text");
    expect(call.prompt).toContain("first comment");
  });

  it("uses profiled system prompt when profile is non-null (REQ-061)", async () => {
    const generateObject = makeGenerate({
      ranked: [makeProfiledEntry(1, { relevance: 4, novelty: 3, signalVsHype: 4, actionability: 3 }, "strong relevance axis")],
    });

    await rankCandidates([makeCandidate(1)], {
      profile,
      topN: 5,
      generateObject,
      loadBodies: stubLoadBodies,
    });

    const call = generateObject.mock.calls[0]?.[0] as GenerateArgs;
    expect(call.system).toContain("Relevance");
    expect(call.system).toContain("Novelty");
    expect(call.system).toContain("Signal-vs-hype");
    expect(call.system).toContain("Actionability");
    expect(call.system).toContain("agent frameworks");
  });

  it("calls generateObject with temperature 0 (REQ-064)", async () => {
    const generateObject = makeGenerate({
      ranked: [makeProfiledEntry(1, { relevance: 4, novelty: 3, signalVsHype: 4, actionability: 3 })],
    });

    await rankCandidates([makeCandidate(1)], {
      profile,
      topN: 5,
      generateObject,
      loadBodies: stubLoadBodies,
    });

    const call = generateObject.mock.calls[0]?.[0] as GenerateArgs;
    expect(call.temperature).toBe(0);
  });

  it("throws if a rationale does not name any scoring axis (REQ-065)", async () => {
    const generateObject = makeGenerate({
      ranked: [makeProfiledEntry(1, { relevance: 4, novelty: 3, signalVsHype: 4, actionability: 3 }, "just because")],
    });

    await expect(
      rankCandidates([makeCandidate(1)], {
        profile,
        topN: 5,
        generateObject,
        loadBodies: stubLoadBodies,
      }),
    ).rejects.toThrow(/axis/i);
  });

  it("accepts lowercase axis names in rationales (REQ-065 case-insensitive)", async () => {
    const generateObject = makeGenerate({
      ranked: [
        makeProfiledEntry(1, { relevance: 4, novelty: 3, signalVsHype: 4, actionability: 3 },
          "Strong relevance — matches the profile topics well. Good signal-vs-hype, real actionability, moderate novelty.",
        ),
      ],
    });

    const result = await rankCandidates([makeCandidate(1)], {
      profile,
      topN: 5,
      generateObject,
      loadBodies: stubLoadBodies,
    });

    expect(result.rankedItems).toHaveLength(1);
    expect(result.rankedItems[0]?.rawItemId).toBe(1);
  });

  it("validates output shape with zod (REQ-067)", async () => {
    const generateObject = vi.fn((args: GenerateArgs) => {
      // Bad shape: missing axes (old-style schema with just score)
      const bad = { ranked: [{ id: 1, score: 50 }] };
      const parsed = args.schema.safeParse(bad);
      expect(parsed.success).toBe(false);
      return Promise.resolve({
        object: {
          ranked: [makeProfiledEntry(1, { relevance: 4, novelty: 3, signalVsHype: 4, actionability: 3 })],
        },
      });
    });

    await rankCandidates([makeCandidate(1)], {
      profile,
      topN: 5,
      generateObject,
      loadBodies: stubLoadBodies,
    });
  });

  it("uses no-profile prompt when profile is null (REQ-070)", async () => {
    const generateObject = makeGenerate({
      ranked: [makeNoProfileEntry(1, { novelty: 4, signalVsHype: 3, actionability: 3 })],
    });

    await rankCandidates([makeCandidate(1)], {
      profile: null,
      topN: 5,
      generateObject,
      loadBodies: stubLoadBodies,
    });

    const call = generateObject.mock.calls[0]?.[0] as GenerateArgs;
    expect(call.system).not.toContain("Relevance");
    expect(call.system).toContain("Novelty");
    expect(call.system).toContain("Signal-vs-hype");
    expect(call.system).toContain("Actionability");
  });

  it("rethrows generateObject failures with informative error (EDGE-011)", async () => {
    const generateObject = makeGenerate(new Error("boom"));

    await expect(
      rankCandidates([makeCandidate(1)], {
        profile,
        topN: 5,
        generateObject,
        loadBodies: stubLoadBodies,
      }),
    ).rejects.toThrow(/ranking failed: boom/);
  });

  it("truncates a 50k-char body in the prompt (EDGE-018)", async () => {
    const hugeBody = "x".repeat(50_000);
    const candidate = makeCandidate(1, { content: hugeBody });

    const generateObject = makeGenerate({
      ranked: [makeProfiledEntry(1, { relevance: 4, novelty: 3, signalVsHype: 4, actionability: 3 })],
    });

    await rankCandidates([candidate], {
      profile,
      topN: 5,
      bodyTokenBudget: 100,
      generateObject,
      loadBodies: stubLoadBodies,
    });

    const call = generateObject.mock.calls[0]?.[0] as GenerateArgs;
    // token budget 100 ≈ 400 chars; allow a little JSON overhead slack.
    expect(call.prompt.length).toBeLessThan(5_000);
    expect(call.prompt).not.toContain(hugeBody);
  });

  it("omits the comments section for candidates with zero comments (REQ-053, EDGE-016)", async () => {
    const candidate = makeCandidate(1, { comments: [] });
    const generateObject = makeGenerate({
      ranked: [makeProfiledEntry(1, { relevance: 4, novelty: 3, signalVsHype: 4, actionability: 3 })],
    });

    await rankCandidates([candidate], {
      profile,
      topN: 5,
      generateObject,
      loadBodies: stubLoadBodies,
    });

    const call = generateObject.mock.calls[0]?.[0] as GenerateArgs;
    expect(call.prompt.toLowerCase()).not.toContain("no comments");
    expect(call.prompt.toLowerCase()).not.toContain("none");
  });

  it("limits comments to commentsPerItem (REQ-051)", async () => {
    const comments = Array.from({ length: 10 }, (_, i) =>
      makeComment(`c${i}`, `comment body ${i}`),
    );
    const candidate = makeCandidate(1, { comments });
    const generateObject = makeGenerate({
      ranked: [makeProfiledEntry(1, { relevance: 4, novelty: 3, signalVsHype: 4, actionability: 3 })],
    });

    await rankCandidates([candidate], {
      profile,
      topN: 5,
      commentsPerItem: 3,
      generateObject,
      loadBodies: stubLoadBodies,
    });

    const call = generateObject.mock.calls[0]?.[0] as GenerateArgs;
    expect(call.prompt).toContain("comment body 0");
    expect(call.prompt).toContain("comment body 1");
    expect(call.prompt).toContain("comment body 2");
    expect(call.prompt).not.toContain("comment body 5");
  });

  it("sorts by fusion score desc and truncates to topN", async () => {
    // All same publishedAt to control recency; all hn for same authority
    // Scores depend on mean axis scores
    const candidates = [
      makeCandidate(1),
      makeCandidate(2),
      makeCandidate(3),
      makeCandidate(4),
    ];
    const generateObject = makeGenerate({
      ranked: [
        makeProfiledEntry(1, { relevance: 1, novelty: 1, signalVsHype: 2, actionability: 2 }), // mean 1.5
        makeProfiledEntry(2, { relevance: 5, novelty: 5, signalVsHype: 5, actionability: 5 }), // mean 5
        makeProfiledEntry(3, { relevance: 3, novelty: 3, signalVsHype: 3, actionability: 3 }), // mean 3
        makeProfiledEntry(4, { relevance: 4, novelty: 4, signalVsHype: 4, actionability: 4 }), // mean 4
      ],
    });

    const now = new Date("2026-04-07T00:00:00Z");
    const result = await rankCandidates(candidates, {
      profile,
      topN: 2,
      generateObject,
      loadBodies: stubLoadBodies,
      now,
    });

    // Item 1 has mean 1.5 < 2.0, so gets dropped by quality gate
    // Order: id=2 (mean 5) > id=4 (mean 4)
    expect(result.rankedItems).toHaveLength(2);
    expect(result.rankedItems.map((r) => r.rawItemId)).toEqual([2, 4]);
  });

  it("emits run.rank INFO log with runId and counts (REQ-103)", async () => {
    const generateObject = makeGenerate({
      ranked: [
        makeProfiledEntry(1, { relevance: 3, novelty: 3, signalVsHype: 3, actionability: 3 }),
        makeProfiledEntry(2, { relevance: 4, novelty: 4, signalVsHype: 4, actionability: 4 }),
      ],
    });

    await rankCandidates([makeCandidate(1), makeCandidate(2)], {
      profile,
      topN: 5,
      runId: "run-xyz",
      generateObject,
      loadBodies: stubLoadBodies,
    });

    const rankLog = mockLoggerInfo.mock.calls.find(
      (c) => (c[0] as { event?: string }).event === "run.rank",
    );
    expect(rankLog).toBeDefined();
    const payload = rankLog?.[0] as {
      runId: string;
      inputCount: number;
      outputCount: number;
    };
    expect(payload.runId).toBe("run-xyz");
    expect(payload.inputCount).toBe(2);
    expect(payload.outputCount).toBe(2);
  });

  // ---- Phase 5 new tests ----

  it("REQ-012: profiled schema has all 4 axes in [1,5]", async () => {
    let capturedSchema: z.ZodType | undefined;
    const generateObject = vi.fn((args: GenerateArgs) => {
      capturedSchema = args.schema;
      return Promise.resolve({
        object: {
          ranked: [makeProfiledEntry(1, { relevance: 3, novelty: 4, signalVsHype: 5, actionability: 2 })],
        },
      });
    });

    await rankCandidates([makeCandidate(1)], {
      profile,
      topN: 5,
      generateObject,
      loadBodies: stubLoadBodies,
    });

    if (!capturedSchema) throw new Error("capturedSchema not set");
    // Valid profiled entry should parse
    const valid = capturedSchema.safeParse({
      ranked: [{ id: 1, relevance: 3, novelty: 4, signalVsHype: 5, actionability: 2, rationale: "strong relevance" }],
    });
    expect(valid.success).toBe(true);

    // Out-of-range axis should fail
    const outOfRange = capturedSchema.safeParse({
      ranked: [{ id: 1, relevance: 6, novelty: 4, signalVsHype: 5, actionability: 2, rationale: "strong relevance" }],
    });
    expect(outOfRange.success).toBe(false);

    // Below range axis should fail
    const belowRange = capturedSchema.safeParse({
      ranked: [{ id: 1, relevance: 0, novelty: 4, signalVsHype: 5, actionability: 2, rationale: "strong relevance" }],
    });
    expect(belowRange.success).toBe(false);

    // Missing relevance (no-profile shape) should fail in profiled schema
    const missingRelevance = capturedSchema.safeParse({
      ranked: [{ id: 1, novelty: 4, signalVsHype: 5, actionability: 2, rationale: "strong novelty" }],
    });
    expect(missingRelevance.success).toBe(false);
  });

  it("REQ-013: no-profile schema has 3 axes in [1,5], no relevance (EDGE-017)", async () => {
    let capturedSchema: z.ZodType | undefined;
    const generateObject = vi.fn((args: GenerateArgs) => {
      capturedSchema = args.schema;
      return Promise.resolve({
        object: {
          ranked: [makeNoProfileEntry(1, { novelty: 4, signalVsHype: 3, actionability: 3 })],
        },
      });
    });

    await rankCandidates([makeCandidate(1)], {
      profile: null,
      topN: 5,
      generateObject,
      loadBodies: stubLoadBodies,
    });

    if (!capturedSchema) throw new Error("capturedSchema not set");
    // Valid no-profile entry should parse
    const valid = capturedSchema.safeParse({
      ranked: [{ id: 1, novelty: 4, signalVsHype: 3, actionability: 3, rationale: "strong novelty" }],
    });
    expect(valid.success).toBe(true);

    // Entry with relevance field should still parse (extra fields are fine in zod)
    // but out-of-range should fail
    const outOfRange = capturedSchema.safeParse({
      ranked: [{ id: 1, novelty: 6, signalVsHype: 3, actionability: 3, rationale: "strong novelty" }],
    });
    expect(outOfRange.success).toBe(false);
  });

  it("REQ-014: llmSignal = mean(axes)/5 — axes [3,4,5,2] → 3.5/5=0.70", async () => {
    // Verify via fusion score: with known engagement=0, recency, authority we can back-calculate llmSignal
    // Use blog source (authority=1.0), publishedAt = now (age=0 → recencyGravity(0)=1/(0+2)^1.5≈0.3536)
    // With profiled weights: 0.40*llm + 0.25*eng + 0.20*rec + 0.15*auth
    // eng=0 (blog, no engagement), rec=recencyGravity(0), auth=1.0
    // score = 0.40*(3.5/5) + 0.25*0 + 0.20*recencyGravity(0) + 0.15*1.0
    const now = new Date("2026-04-07T00:00:00Z");
    const candidate = makeCandidate(1, {
      sourceType: "blog",
      publishedAt: now,
      engagement: { points: 0, commentCount: 0 },
    });
    const generateObject = makeGenerate({
      ranked: [makeProfiledEntry(1, { relevance: 3, novelty: 4, signalVsHype: 5, actionability: 2 }, "strong relevance")],
    });

    const result = await rankCandidates([candidate], {
      profile,
      topN: 5,
      generateObject,
      loadBodies: stubLoadBodies,
      now,
    });

    expect(result.rankedItems).toHaveLength(1);
    // Mean = (3+4+5+2)/4 = 3.5, llmSignal = 3.5/5 = 0.70
    // recencyGravity(0) = 1/(2^1.5) ≈ 0.35355
    // score = 0.40*0.70 + 0.25*0 + 0.20*0.35355 + 0.15*1.0
    //       = 0.28 + 0 + 0.07071 + 0.15 = 0.50071
    const recency = 1 / Math.pow(2, 1.5);
    const expected = 0.40 * 0.70 + 0.25 * 0 + 0.20 * recency + 0.15 * 1.0;
    expect(result.rankedItems[0]?.score).toBeCloseTo(expected, 5);
  });

  it("REQ-015: rationale non-empty and contains at least one axis name", async () => {
    const generateObject = makeGenerate({
      ranked: [makeProfiledEntry(1, { relevance: 4, novelty: 3, signalVsHype: 4, actionability: 3 }, "")],
    });

    await expect(
      rankCandidates([makeCandidate(1)], {
        profile,
        topN: 5,
        generateObject,
        loadBodies: stubLoadBodies,
      }),
    ).rejects.toThrow(); // empty rationale fails zod min(1) or axis check
  });

  it("REQ-016: items with mean axis score < 2.0 are dropped", async () => {
    const candidates = [makeCandidate(1), makeCandidate(2)];
    const generateObject = makeGenerate({
      ranked: [
        // mean = (1+1+1+1)/4 = 1.0 → dropped
        makeProfiledEntry(1, { relevance: 1, novelty: 1, signalVsHype: 1, actionability: 1 }),
        // mean = (3+3+3+3)/4 = 3.0 → passes
        makeProfiledEntry(2, { relevance: 3, novelty: 3, signalVsHype: 3, actionability: 3 }),
      ],
    });

    const result = await rankCandidates(candidates, {
      profile,
      topN: 5,
      generateObject,
      loadBodies: stubLoadBodies,
      now: new Date("2026-04-07T00:00:00Z"),
    });

    expect(result.rankedItems.map((r) => r.rawItemId)).toEqual([2]);
  });

  it("EDGE-011: item with mean = 2.0 is retained (strictly < 2.0 to drop)", async () => {
    const candidate = makeCandidate(1);
    const generateObject = makeGenerate({
      ranked: [
        // mean = (2+2+2+2)/4 = 2.0 → exactly 2.0, must NOT be dropped
        makeProfiledEntry(1, { relevance: 2, novelty: 2, signalVsHype: 2, actionability: 2 }),
      ],
    });

    const result = await rankCandidates([candidate], {
      profile,
      topN: 5,
      generateObject,
      loadBodies: stubLoadBodies,
      now: new Date("2026-04-07T00:00:00Z"),
    });

    expect(result.rankedItems).toHaveLength(1);
    expect(result.rankedItems[0]?.rawItemId).toBe(1);
  });

  it("REQ-017: if all items have mean < 2.0, highest-mean item is retained (EDGE-012)", async () => {
    const candidates = [makeCandidate(1), makeCandidate(2), makeCandidate(3)];
    const generateObject = makeGenerate({
      ranked: [
        makeProfiledEntry(1, { relevance: 1, novelty: 1, signalVsHype: 1, actionability: 1 }), // mean 1.0
        makeProfiledEntry(2, { relevance: 1, novelty: 1, signalVsHype: 2, actionability: 1 }), // mean 1.25
        makeProfiledEntry(3, { relevance: 1, novelty: 1, signalVsHype: 1, actionability: 2 }), // mean 1.25 (same, first wins)
      ],
    });

    const result = await rankCandidates(candidates, {
      profile,
      topN: 5,
      generateObject,
      loadBodies: stubLoadBodies,
      now: new Date("2026-04-07T00:00:00Z"),
    });

    // All below 2.0 — keep the highest mean item
    expect(result.rankedItems).toHaveLength(1);
    // id=2 and id=3 tie at 1.25; reduce takes first encountered max → id=2
    expect(result.rankedItems[0]?.rawItemId).toBe(2);
  });

  it("REQ-018: engagement normalization formula — log(1+merged)/log(1+max)", () => {
    // HN: max=2000, points=200, commentCount=30 → merged=230
    // norm = log(1+230)/log(1+2000)
    const hnCandidate = makeCandidate(1, {
      sourceType: "hn",
      engagement: { points: 200, commentCount: 30 },
    });
    const engNorm = normalizeEngagement(hnCandidate);
    const expected = Math.log(1 + 230) / Math.log(1 + 2000);
    expect(engNorm).toBeCloseTo(expected, 5);

    // Reddit: max=10000, points=500, commentCount=100 → merged=600
    const redditCandidate = makeCandidate(2, {
      sourceType: "reddit",
      engagement: { points: 500, commentCount: 100 },
    });
    const redditNorm = normalizeEngagement(redditCandidate);
    const redditExpected = Math.log(1 + 600) / Math.log(1 + 10000);
    expect(redditNorm).toBeCloseTo(redditExpected, 5);

    // Blog: always 0 regardless of engagement
    const blogCandidate = makeCandidate(3, {
      sourceType: "blog",
      engagement: { points: 999, commentCount: 999 },
    });
    expect(normalizeEngagement(blogCandidate)).toBe(0);
  });

  it("EDGE-007: points 2500 with HN max=2000 → clamped to 1.0", () => {
    const hnCandidate = makeCandidate(1, {
      sourceType: "hn",
      engagement: { points: 2500, commentCount: 0 },
    });
    expect(normalizeEngagement(hnCandidate)).toBe(1);
  });

  it("REQ-019: authority weights — blog=1.0, reddit=0.85, hn=0.75", () => {
    expect(AUTHORITY_WEIGHTS.blog).toBe(1.0);
    expect(AUTHORITY_WEIGHTS.reddit).toBe(0.85);
    expect(AUTHORITY_WEIGHTS.hn).toBe(0.75);
  });

  it("REQ-020: profiled fusion: 0.40*llm + 0.25*eng + 0.20*rec + 0.15*auth", async () => {
    // We want: llm=0.8, eng=0.5, rec=0.3, auth=1.0 → 0.32+0.125+0.06+0.15 = 0.655
    // llmSignal = mean(axes)/5 = 0.8 → mean = 4.0, so axes: [4,4,4,4]
    // auth=1.0 → blog source
    // eng=0.5 → blog max=0, so we can't get 0.5 from blog
    // Use hn: eng = log(1+merged)/log(1+2000) = 0.5
    //   → log(1+merged) = 0.5 * log(2001) ≈ 0.5 * 7.6017 = 3.8009
    //   → merged = exp(3.8009) - 1 ≈ 44.7
    // Let's instead directly test the formula with a known setup and check close enough.
    //
    // Better approach: use hn candidate with specific engagement to get eng≈0.5
    // and check the fusion score matches formula.
    //
    // Actually: test the formula is correct by testing with specific inputs we control:
    // Use hn source (auth=0.75), eng=0 (no engagement), now=publishedAt (age=0)
    // recencyGravity(0) = 1/(2^1.5) ≈ 0.35355
    // axes = [4,4,4,4] → mean=4, llmSignal=0.8
    // score = 0.40*0.8 + 0.25*0 + 0.20*0.35355 + 0.15*0.75
    //       = 0.32 + 0 + 0.07071 + 0.1125 = 0.50321

    const now = new Date("2026-04-07T00:00:00Z");
    const candidate = makeCandidate(1, {
      sourceType: "hn",
      publishedAt: now,
      engagement: { points: 0, commentCount: 0 },
    });
    const generateObject = makeGenerate({
      ranked: [makeProfiledEntry(1, { relevance: 4, novelty: 4, signalVsHype: 4, actionability: 4 }, "strong relevance")],
    });

    const result = await rankCandidates([candidate], {
      profile,
      topN: 5,
      generateObject,
      loadBodies: stubLoadBodies,
      now,
    });

    const recency = 1 / Math.pow(2, 1.5); // recencyGravity(0)
    const expected = 0.40 * 0.8 + 0.25 * 0 + 0.20 * recency + 0.15 * 0.75;
    expect(result.rankedItems[0]?.score).toBeCloseTo(expected, 5);
  });

  it("REQ-021: no-profile fusion: 0.50*llm + 0.30*eng + 0.20*rec", async () => {
    // axes [4,4,4] → mean=4, llmSignal=0.8; hn, no engagement, age=0
    // rec = recencyGravity(0), eng=0
    // score = 0.50*0.8 + 0.30*0 + 0.20*recencyGravity(0)
    const now = new Date("2026-04-07T00:00:00Z");
    const candidate = makeCandidate(1, {
      sourceType: "hn",
      publishedAt: now,
      engagement: { points: 0, commentCount: 0 },
    });
    const generateObject = makeGenerate({
      ranked: [makeNoProfileEntry(1, { novelty: 4, signalVsHype: 4, actionability: 4 })],
    });

    const result = await rankCandidates([candidate], {
      profile: null,
      topN: 5,
      generateObject,
      loadBodies: stubLoadBodies,
      now,
    });

    const recency = 1 / Math.pow(2, 1.5);
    const expected = 0.50 * 0.8 + 0.30 * 0 + 0.20 * recency;
    expect(result.rankedItems[0]?.score).toBeCloseTo(expected, 5);
  });

  it("EDGE-010: LLM returns axis score outside [1,5] → zod rejects → rank throws", async () => {
    // The real AI SDK validates via the schema before returning.
    // Our mock captures the schema and simulates rejection for out-of-range values.
    let capturedSchema: z.ZodType | undefined;
    const capturingGenerate = vi.fn((args: GenerateArgs) => {
      capturedSchema = args.schema;
      // Simulate AI SDK rejecting invalid output by checking schema
      const bad = { ranked: [{ id: 1, relevance: 6, novelty: 3, signalVsHype: 4, actionability: 3, rationale: "strong relevance" }] };
      const parsed = capturedSchema ? capturedSchema.safeParse(bad) : { success: false, error: new Error("no schema") };
      if (!parsed.success) {
        return Promise.reject(new Error(`validation failed: ${parsed.error.message}`));
      }
      return Promise.resolve({ object: bad });
    });

    await expect(
      rankCandidates([makeCandidate(1)], {
        profile,
        topN: 5,
        generateObject: capturingGenerate,
        loadBodies: stubLoadBodies,
      }),
    ).rejects.toThrow(/ranking failed/);
  });

  it("REQ-026: RankedItemRef.score is in [0,1]", async () => {
    // Use max possible inputs: axes all 5, engagement maxed, age=0 (max recency), auth=1.0 (blog)
    const now = new Date("2026-04-07T00:00:00Z");
    const candidate = makeCandidate(1, {
      sourceType: "blog",
      publishedAt: now,
      engagement: { points: 0, commentCount: 0 },
    });
    const generateObject = makeGenerate({
      ranked: [makeProfiledEntry(1, { relevance: 5, novelty: 5, signalVsHype: 5, actionability: 5 }, "strong relevance actionability novelty signal-vs-hype")],
    });

    const result = await rankCandidates([candidate], {
      profile,
      topN: 5,
      generateObject,
      loadBodies: stubLoadBodies,
      now,
    });

    expect(result.rankedItems).toHaveLength(1);
    const score = result.rankedItems[0]?.score ?? -1;
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("ENGAGEMENT_SOURCE_MAX exports correct values", () => {
    expect(ENGAGEMENT_SOURCE_MAX.hn).toBe(2000);
    expect(ENGAGEMENT_SOURCE_MAX.reddit).toBe(10000);
    expect(ENGAGEMENT_SOURCE_MAX.blog).toBe(0);
  });
});
