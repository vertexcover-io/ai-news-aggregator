import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import type { Candidate, RawItemComment } from "@newsletter/shared";

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

import { rankCandidates } from "@pipeline/processors/rank.js";

interface GenerateArgs {
  model: unknown;
  system: string;
  prompt: string;
  schema: z.ZodType;
  temperature?: number;
}

interface RankedEntry {
  id: number;
  score: number;
  rationale: string;
  summary: string;
  bullets: string[];
  bottomLine: string;
}

function makeRankedEntry(overrides: { id: number; score: number; rationale: string } & Partial<RankedEntry>): RankedEntry {
  return {
    summary: "This is a test summary for the ranked item.",
    bullets: [
      "First analysis point explaining significance.",
      "Second analysis point about broader impact.",
      "Third analysis point on practical implications.",
    ],
    bottomLine: "This is the strategic takeaway for readers.",
    ...overrides,
  };
}

function makeGenerate(
  response: { ranked: RankedEntry[] } | Error,
): ReturnType<typeof vi.fn> {
  return vi.fn((args: GenerateArgs) => {
    void args;
    if (response instanceof Error) return Promise.reject(response);
    return Promise.resolve({ object: response });
  });
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
      ranked: [makeRankedEntry({ id: 1, score: 80, rationale: "strong Novelty" })],
    });
    const now = new Date("2026-04-07T04:00:00Z");

    await rankCandidates([candidate], {
      topN: 5,
      generateObject,
      loadBodies: stubLoadBodies,
      now,
      shortlistBreakdowns: [
        { id: 1, relevance: 0.8, recency: 0.9, combined: 0.72 },
      ],
    });

    const call = generateObject.mock.calls[0]?.[0] as GenerateArgs;
    expect(call.prompt).toContain('"id": 1');
    expect(call.prompt).toContain("An article");
    expect(call.prompt).toContain("https://x.test/1");
    expect(call.prompt).toContain("hn");
    expect(call.prompt).toContain("2026-04-07T00:00:00");
    expect(call.prompt).toContain("ago");
    expect(call.prompt.toLowerCase()).toContain("stage1");
    expect(call.prompt).toContain("interesting body text");
    expect(call.prompt).toContain("first comment");
  });

  it("uses RANK_SYSTEM_PROMPT_NO_PROFILE (REQ-070)", async () => {
    const generateObject = makeGenerate({
      ranked: [makeRankedEntry({ id: 1, score: 50, rationale: "strong Novelty" })],
    });

    await rankCandidates([makeCandidate(1)], {
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

  it("calls generateObject with temperature 0 (REQ-064)", async () => {
    const generateObject = makeGenerate({
      ranked: [makeRankedEntry({ id: 1, score: 50, rationale: "strong Novelty" })],
    });

    await rankCandidates([makeCandidate(1)], {
      topN: 5,
      generateObject,
      loadBodies: stubLoadBodies,
    });

    const call = generateObject.mock.calls[0]?.[0] as GenerateArgs;
    expect(call.temperature).toBe(0);
  });

  it("REQ-065: drops items whose rationale does not name any scoring axis (instead of failing the run)", async () => {
    const generateObject = makeGenerate({
      ranked: [
        makeRankedEntry({ id: 1, score: 50, rationale: "just because" }),
        makeRankedEntry({ id: 2, score: 80, rationale: "strong Novelty" }),
      ],
    });

    const result = await rankCandidates([makeCandidate(1), makeCandidate(2)], {
      topN: 5,
      generateObject,
      loadBodies: stubLoadBodies,
    });

    // id=1 dropped (no axis named); id=2 kept
    expect(result.rankedItems).toHaveLength(1);
    expect(result.rankedItems[0].rawItemId).toBe(2);
  });

  it("REQ-065: throws only when ALL rationales fail axis validation", async () => {
    const generateObject = makeGenerate({
      ranked: [
        makeRankedEntry({ id: 1, score: 50, rationale: "just because" }),
        makeRankedEntry({ id: 2, score: 80, rationale: "vibes only" }),
      ],
    });

    await expect(
      rankCandidates([makeCandidate(1), makeCandidate(2)], {
        topN: 5,
        generateObject,
        loadBodies: stubLoadBodies,
      }),
    ).rejects.toThrow(/no valid items/);
  });

  it("accepts lowercase axis names in rationales (REQ-065 case-insensitive)", async () => {
    // Regression: Claude naturally writes "strong novelty — ..." mid-sentence
    // rather than "Strong Novelty — ...". The validator must be case-insensitive
    // so grammatically natural rationales don't trip the guard.
    const generateObject = makeGenerate({
      ranked: [
        makeRankedEntry({
          id: 1,
          score: 80,
          rationale:
            "Strong novelty — new research results. Good signal-vs-hype, real actionability.",
        }),
      ],
    });

    const result = await rankCandidates([makeCandidate(1)], {
      topN: 5,
      generateObject,
      loadBodies: stubLoadBodies,
    });

    expect(result.rankedItems).toHaveLength(1);
    expect(result.rankedItems[0].rawItemId).toBe(1);
  });

  it("multiplies LLM score by recencyDecay for a 48h-old item (REQ-066)", async () => {
    const publishedAt = new Date("2026-04-05T00:00:00Z");
    const now = new Date("2026-04-07T00:00:00Z"); // 48 h later
    const candidate = makeCandidate(1, { publishedAt });

    const generateObject = makeGenerate({
      ranked: [makeRankedEntry({ id: 1, score: 90, rationale: "strong Novelty" })],
    });

    const result = await rankCandidates([candidate], {
      topN: 5,
      halfLifeHours: 48,
      generateObject,
      loadBodies: stubLoadBodies,
      now,
    });

    expect(result.rankedItems).toHaveLength(1);
    const expected = 90 * Math.exp(-1);
    expect(result.rankedItems[0]?.score).toBeCloseTo(expected, 5);
  });

  it("validates output shape with zod (REQ-067)", async () => {
    const generateObject = vi.fn((args: GenerateArgs) => {
      const bad = { ranked: [{ id: 1, score: 50 }] };
      const parsed = args.schema.safeParse(bad);
      expect(parsed.success).toBe(false);
      return Promise.resolve({
        object: { ranked: [makeRankedEntry({ id: 1, score: 50, rationale: "strong Novelty" })] },
      });
    });

    await rankCandidates([makeCandidate(1)], {
      topN: 5,
      generateObject,
      loadBodies: stubLoadBodies,
    });
  });

  it("applies recency decay (REQ-071)", async () => {
    const publishedAt = new Date("2026-04-05T00:00:00Z");
    const now = new Date("2026-04-07T00:00:00Z");
    const candidate = makeCandidate(1, { publishedAt });

    const generateObject = makeGenerate({
      ranked: [makeRankedEntry({ id: 1, score: 80, rationale: "strong Novelty" })],
    });

    const result = await rankCandidates([candidate], {
      topN: 5,
      halfLifeHours: 48,
      generateObject,
      loadBodies: stubLoadBodies,
      now,
    });

    const expected = 80 * Math.exp(-1);
    expect(result.rankedItems[0]?.score).toBeCloseTo(expected, 5);
  });

  it("rethrows generateObject failures with informative error (EDGE-011)", async () => {
    const generateObject = makeGenerate(new Error("boom"));

    await expect(
      rankCandidates([makeCandidate(1)], {
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
      ranked: [makeRankedEntry({ id: 1, score: 50, rationale: "strong Novelty" })],
    });

    await rankCandidates([candidate], {
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
      ranked: [makeRankedEntry({ id: 1, score: 50, rationale: "strong Novelty" })],
    });

    await rankCandidates([candidate], {
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
      ranked: [makeRankedEntry({ id: 1, score: 50, rationale: "strong Novelty" })],
    });

    await rankCandidates([candidate], {
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

  it("sorts by adjusted score desc and truncates to topN", async () => {
    const candidates = [
      makeCandidate(1),
      makeCandidate(2),
      makeCandidate(3),
      makeCandidate(4),
    ];
    const generateObject = makeGenerate({
      ranked: [
        makeRankedEntry({ id: 1, score: 10, rationale: "Novelty" }),
        makeRankedEntry({ id: 2, score: 90, rationale: "Novelty" }),
        makeRankedEntry({ id: 3, score: 50, rationale: "Novelty" }),
        makeRankedEntry({ id: 4, score: 80, rationale: "Novelty" }),
      ],
    });

    const result = await rankCandidates(candidates, {
      topN: 2,
      generateObject,
      loadBodies: stubLoadBodies,
      now: new Date("2026-04-07T00:00:00Z"),
    });

    expect(result.rankedItems).toHaveLength(2);
    expect(result.rankedItems.map((r) => r.rawItemId)).toEqual([2, 4]);
  });

  it("emits run.rank INFO log with runId and counts (REQ-103)", async () => {
    const generateObject = makeGenerate({
      ranked: [
        makeRankedEntry({ id: 1, score: 50, rationale: "Novelty" }),
        makeRankedEntry({ id: 2, score: 70, rationale: "Novelty" }),
      ],
    });

    await rankCandidates([makeCandidate(1), makeCandidate(2)], {
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

  it("returns recap fields (summary, bullets, bottomLine) in RankedItemRef", async () => {
    const generateObject = makeGenerate({
      ranked: [makeRankedEntry({
        id: 1,
        score: 80,
        rationale: "strong Novelty",
        summary: "OpenAI released a new model with improved reasoning.",
        bullets: [
          "The new model shows 30% improvement on benchmarks.",
          "Pricing remains competitive with existing options.",
          "Early adopters report faster response times overall.",
        ],
        bottomLine: "This release raises the bar for reasoning-focused models.",
      })],
    });

    const result = await rankCandidates([makeCandidate(1)], {
      topN: 5,
      generateObject,
      loadBodies: stubLoadBodies,
    });

    expect(result.rankedItems).toHaveLength(1);
    const item = result.rankedItems[0];
    expect(item.summary).toBe("OpenAI released a new model with improved reasoning.");
    expect(item.bullets).toHaveLength(3);
    expect(item.bullets?.[0]).toBe("The new model shows 30% improvement on benchmarks.");
    expect(item.bottomLine).toBe("This release raises the bar for reasoning-focused models.");
  });

  it("zod accepts fewer than 3 bullets", async () => {
    const generateObject = vi.fn((_args: GenerateArgs) => {
      return Promise.resolve({
        object: {
          ranked: [makeRankedEntry({
            id: 1,
            score: 50,
            rationale: "strong Novelty",
            summary: "Short summary.",
            bullets: ["Only one bullet."],
            bottomLine: "Takeaway.",
          })],
        },
      });
    });

    const result = await rankCandidates([makeCandidate(1)], {
      topN: 5,
      generateObject,
      loadBodies: stubLoadBodies,
    });
    expect(result.rankedCount).toBe(1);
  });

  it("REQ-06: forwards abortSignal to generateObject call", async () => {
    const controller = new AbortController();
    let capturedAbortSignal: AbortSignal | undefined;

    const generateObject = vi.fn((args: GenerateArgs & { abortSignal?: AbortSignal }) => {
      capturedAbortSignal = args.abortSignal;
      return Promise.resolve({
        object: {
          ranked: [makeRankedEntry({ id: 1, score: 80, rationale: "strong Novelty" })],
        },
      });
    });

    await rankCandidates([makeCandidate(1)], {
      topN: 5,
      generateObject,
      loadBodies: stubLoadBodies,
      abortSignal: controller.signal,
    });

    expect(capturedAbortSignal).toBe(controller.signal);
  });
});
