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

import { rankCandidates, rankedResponseSchema } from "@pipeline/processors/rank.js";

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

const DEFAULT_DIGEST = {
  headline: "Test digest headline phrase",
  summary: "A one-sentence summary of the day's main stories for tests.",
  hook: "A punchy hook line for the social post.",
  twitterSummary: "A Twitter-native summary for the feed.",
};

function makeGenerate(
  response:
    | {
        ranked: RankedEntry[];
        digest?: {
          headline: string;
          summary: string;
          hook: string;
          twitterSummary: string;
        };
      }
    | Error,
): ReturnType<typeof vi.fn> {
  return vi.fn((args: GenerateArgs) => {
    void args;
    if (response instanceof Error) return Promise.reject(response);
    const fullResponse = {
      digest: response.digest ?? DEFAULT_DIGEST,
      ranked: response.ranked,
    };
    return Promise.resolve({ object: fullResponse });
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
      digestHeadline: "",
      digestSummary: "",
      hook: "",
      twitterSummary: "",
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
      ranked: [makeRankedEntry({ id: 1, score: 80, rationale: "strong Developer-relevance" })],
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
    expect(call.prompt).toContain('"requestedTopN": 5');
    expect(call.prompt).toContain('"twitterSummaryMaxChars"');
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

  it("uses a general developer-and-engineering-team ranking prompt (REQ-070)", async () => {
    const generateObject = makeGenerate({
      ranked: [
        makeRankedEntry({
          id: 1,
          score: 50,
          rationale: "strong Developer-relevance",
        }),
      ],
    });

    await rankCandidates([makeCandidate(1)], {
      topN: 5,
      generateObject,
      loadBodies: stubLoadBodies,
    });

    const call = generateObject.mock.calls[0]?.[0] as GenerateArgs;
    expect(call.system).toContain("software developer");
    expect(call.system).toContain("tech lead");
    expect(call.system).toContain("engineering manager");
    expect(call.system).toContain("share with their teams");
    expect(call.system).toContain("Direct developer-tool");
    expect(call.system).toContain("requestedTopN");
    expect(call.system).toContain("coding agents");
    expect(call.system).toContain("agentic AI tooling");
    expect(call.system).toContain("Developer-relevance");
    expect(call.system).toContain("Builder-impact");
    expect(call.system).toContain("Agentic-systems-relevance");
    expect(call.system).toContain("Evidence-quality");
    expect(call.system).toContain("Signal-vs-hype");
    expect(call.system).not.toContain("Vertexcover");
    expect(call.system).not.toContain("Harness engineering");
    expect(call.system).not.toContain("feel the pulse of the field");
  });

  it("calls generateObject with temperature 0 (REQ-064)", async () => {
    const generateObject = makeGenerate({
      ranked: [makeRankedEntry({ id: 1, score: 50, rationale: "strong Developer-relevance" })],
    });

    await rankCandidates([makeCandidate(1)], {
      topN: 5,
      generateObject,
      loadBodies: stubLoadBodies,
    });

    const call = generateObject.mock.calls[0]?.[0] as GenerateArgs;
    expect(call.temperature).toBe(0);
  });

  it("skips items whose rationale does not name a scoring axis, run continues (REQ-065 softened)", async () => {
    // Previously this threw and killed the entire run. New behaviour: drop the
    // unvalidated item, log a warn, keep the rest. One bad rationale must not
    // brick a daily run (Stage-5 finding 2026-05-04: a tweet with terse
    // content produced rationale "Low on all axes..." which is semantically
    // valid but lexically doesn't match a single axis name).
    const generateObject = makeGenerate({
      ranked: [
        makeRankedEntry({ id: 1, score: 80, rationale: "strong Developer-relevance" }),
        makeRankedEntry({ id: 2, score: 50, rationale: "just because" }),
        makeRankedEntry({ id: 3, score: 70, rationale: "good Builder-impact" }),
      ],
    });

    const result = await rankCandidates(
      [makeCandidate(1), makeCandidate(2), makeCandidate(3)],
      {
        topN: 5,
        generateObject,
        loadBodies: stubLoadBodies,
      },
    );

    // Items 1 and 3 survive; item 2 is dropped.
    const ids = result.rankedItems.map((r) => r.rawItemId).sort();
    expect(ids).toEqual([1, 3]);
  });

  it("skips empty-title ranked rows instead of failing the whole run", async () => {
    const generateObject = makeGenerate({
      ranked: [
        makeRankedEntry({
          id: 1,
          score: 80,
          rationale: "strong Developer-relevance",
          title: "Valid ranked title",
        }),
        makeRankedEntry({
          id: 2,
          score: 70,
          rationale: "strong Builder-impact",
          title: "",
        }),
      ],
    });

    const result = await rankCandidates([makeCandidate(1), makeCandidate(2)], {
      topN: 5,
      generateObject,
      loadBodies: stubLoadBodies,
    });

    expect(result.rankedItems.map((r) => r.rawItemId)).toEqual([1]);
  });

  it("throws if EVERY rationale fails axis validation (REQ-065 still gates totally-bad runs)", async () => {
    const generateObject = makeGenerate({
      ranked: [
        makeRankedEntry({ id: 1, score: 50, rationale: "just because" }),
        makeRankedEntry({ id: 2, score: 40, rationale: "no reason" }),
      ],
    });

    await expect(
      rankCandidates([makeCandidate(1), makeCandidate(2)], {
        topN: 5,
        generateObject,
        loadBodies: stubLoadBodies,
      }),
    ).rejects.toThrow(/no valid items/i);
  });

  it("accepts lowercase new axis names in rationales (REQ-065 case-insensitive)", async () => {
    // Regression: Claude naturally writes "strong developer-relevance — ..." mid-sentence
    // rather than "Strong developer-relevance — ...". The validator must be case-insensitive
    // so grammatically natural rationales don't trip the guard.
    const generateObject = makeGenerate({
      ranked: [
        makeRankedEntry({
          id: 1,
          score: 80,
          rationale:
            "Strong developer-relevance — this directly helps agentic systems teams improve production workflows.",
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

  it("rejects old-only ranking axes when every rationale lacks the new axes", async () => {
    const generateObject = makeGenerate({
      ranked: [
        makeRankedEntry({
          id: 1,
          score: 80,
          rationale: "strong Novelty and practical utility",
        }),
        makeRankedEntry({
          id: 2,
          score: 60,
          rationale: "good Actionability for AI practitioners",
        }),
      ],
    });

    await expect(
      rankCandidates([makeCandidate(1), makeCandidate(2)], {
        topN: 5,
        generateObject,
        loadBodies: stubLoadBodies,
      }),
    ).rejects.toThrow(/no valid items/i);
  });

  it("multiplies LLM score by recencyDecay for a 48h-old item (REQ-066)", async () => {
    const publishedAt = new Date("2026-04-05T00:00:00Z");
    const now = new Date("2026-04-07T00:00:00Z"); // 48 h later
    const candidate = makeCandidate(1, { publishedAt });

    const generateObject = makeGenerate({
      ranked: [makeRankedEntry({ id: 1, score: 90, rationale: "strong Developer-relevance" })],
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
        object: {
          digest: DEFAULT_DIGEST,
          ranked: [makeRankedEntry({ id: 1, score: 50, rationale: "strong Developer-relevance" })],
        },
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
      ranked: [makeRankedEntry({ id: 1, score: 80, rationale: "strong Developer-relevance" })],
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
      ranked: [makeRankedEntry({ id: 1, score: 50, rationale: "strong Developer-relevance" })],
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
      ranked: [makeRankedEntry({ id: 1, score: 50, rationale: "strong Developer-relevance" })],
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
      ranked: [makeRankedEntry({ id: 1, score: 50, rationale: "strong Developer-relevance" })],
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
        makeRankedEntry({ id: 1, score: 10, rationale: "Developer-relevance" }),
        makeRankedEntry({ id: 2, score: 90, rationale: "Developer-relevance" }),
        makeRankedEntry({ id: 3, score: 50, rationale: "Developer-relevance" }),
        makeRankedEntry({ id: 4, score: 80, rationale: "Developer-relevance" }),
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
        makeRankedEntry({ id: 1, score: 50, rationale: "Developer-relevance" }),
        makeRankedEntry({ id: 2, score: 70, rationale: "Developer-relevance" }),
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
        rationale: "strong Developer-relevance",
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
          digest: DEFAULT_DIGEST,
          ranked: [makeRankedEntry({
            id: 1,
            score: 50,
            rationale: "strong Developer-relevance",
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

  it("VER-96: propagates digestHeadline and digestSummary from LLM response", async () => {
    const generateObject = makeGenerate({
      digest: {
        headline: "AI safety, regulation, open models",
        summary: "Five stories on regulation, new open-weight releases, and benchmark results across the day's main themes.",
        hook: "Hook line.",
        twitterSummary: "A Twitter-native digest summary.",
      },
      ranked: [makeRankedEntry({ id: 1, score: 80, rationale: "strong Developer-relevance" })],
    });

    const result = await rankCandidates([makeCandidate(1)], {
      topN: 5,
      generateObject,
      loadBodies: stubLoadBodies,
    });

    expect(result.digestHeadline).toBe("AI safety, regulation, open models");
    expect(result.digestSummary).toContain("regulation");
  });

  it("propagates hook from LLM response", async () => {
    const generateObject = makeGenerate({
      digest: {
        headline: "h",
        summary: "s",
        hook: "Big news today: someone shipped something interesting.",
        twitterSummary: "A feed-native version of the same story.",
      },
      ranked: [makeRankedEntry({ id: 1, score: 80, rationale: "strong Developer-relevance" })],
    });

    const result = await rankCandidates([makeCandidate(1)], {
      topN: 5,
      generateObject,
      loadBodies: stubLoadBodies,
    });

    expect(result.hook).toBe(
      "Big news today: someone shipped something interesting.",
    );
    expect(result.twitterSummary).toBe("A feed-native version of the same story.");
  });

  it("retries once when twitterSummary exceeds the non-premium budget", async () => {
    const generateObject = vi
      .fn()
      .mockResolvedValueOnce({
        object: {
          digest: {
            ...DEFAULT_DIGEST,
            twitterSummary: "x".repeat(240),
          },
          ranked: [
            makeRankedEntry({
              id: 1,
              score: 80,
              rationale: "strong Developer-relevance",
            }),
          ],
        },
      })
      .mockResolvedValueOnce({
        object: {
          digest: {
            ...DEFAULT_DIGEST,
            twitterSummary: "A shorter Twitter summary.",
          },
          ranked: [
            makeRankedEntry({
              id: 1,
              score: 80,
              rationale: "strong Developer-relevance",
            }),
          ],
        },
      });

    const result = await rankCandidates([makeCandidate(1)], {
      topN: 5,
      generateObject,
      loadBodies: stubLoadBodies,
    });

    expect(generateObject).toHaveBeenCalledTimes(2);
    expect(result.twitterSummary).toBe("A shorter Twitter summary.");
  });

  it("VER-96: empty shortlist returns empty digest fields without calling LLM", async () => {
    const generateObject = makeGenerate({ ranked: [] });
    const result = await rankCandidates([], {
      topN: 5,
      generateObject,
      loadBodies: stubLoadBodies,
    });

    expect(generateObject).not.toHaveBeenCalled();
    expect(result.digestHeadline).toBe("");
    expect(result.digestSummary).toBe("");
    expect(result.hook).toBe("");
    expect(result.twitterSummary).toBe("");
  });

  it("VER-96: rankedResponseSchema rejects responses missing the digest field", () => {
    const without = {
      ranked: [
        { id: 1, score: 50, rationale: "strong Developer-relevance", summary: "x", bullets: ["a"], bottomLine: "b" },
      ],
    };
    expect(rankedResponseSchema.safeParse(without).success).toBe(false);
  });

  it("REQ-06: forwards abortSignal to generateObject call", async () => {
    const controller = new AbortController();
    let capturedAbortSignal: AbortSignal | undefined;

    const generateObject = vi.fn((args: GenerateArgs & { abortSignal?: AbortSignal }) => {
      capturedAbortSignal = args.abortSignal;
      return Promise.resolve({
        object: {
          digest: DEFAULT_DIGEST,
          ranked: [makeRankedEntry({ id: 1, score: 80, rationale: "strong Developer-relevance" })],
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

  it("emits rank.recap.over_budget warn when a story exceeds 130 words", async () => {
    const longBullet = "word ".repeat(40).trim(); // 40 words
    const overBudget = makeRankedEntry({
      id: 1,
      score: 80,
      rationale: "strong Developer-relevance",
      summary: "word ".repeat(30).trim(), // 30 words
      bullets: [longBullet, longBullet, longBullet, longBullet], // 4 × 40 = 160
      bottomLine: "word ".repeat(20).trim(), // 20 words; total = 30 + 160 + 20 = 210
    });
    const generateObject = makeGenerate({ ranked: [overBudget] });

    await rankCandidates([makeCandidate(1)], {
      topN: 5,
      generateObject,
      loadBodies: stubLoadBodies,
      runId: "run-abc",
    });

    const warnCalls = mockLoggerWarn.mock.calls.filter(
      (call) =>
        typeof call[0] === "object" &&
        call[0] !== null &&
        (call[0] as { event?: string }).event === "rank.recap.over_budget",
    );
    expect(warnCalls).toHaveLength(1);
    const payload = warnCalls[0]?.[0] as {
      rawItemId: number;
      totalWords: number;
      bulletCount: number;
      runId?: string;
      budget: number;
    };
    expect(payload.rawItemId).toBe(1);
    expect(payload.bulletCount).toBe(4);
    expect(payload.totalWords).toBe(210);
    expect(payload.runId).toBe("run-abc");
    expect(payload.budget).toBe(130);
  });

  it("does NOT emit rank.recap.over_budget when a story is under budget", async () => {
    // Default makeRankedEntry: summary (~8 words) + 3 short bullets (~6 words each) + bottomLine (~7 words) ≈ 33 words.
    const underBudget = makeRankedEntry({
      id: 1,
      score: 80,
      rationale: "strong Developer-relevance",
    });
    const generateObject = makeGenerate({ ranked: [underBudget] });

    await rankCandidates([makeCandidate(1)], {
      topN: 5,
      generateObject,
      loadBodies: stubLoadBodies,
    });

    const warnCalls = mockLoggerWarn.mock.calls.filter(
      (call) =>
        typeof call[0] === "object" &&
        call[0] !== null &&
        (call[0] as { event?: string }).event === "rank.recap.over_budget",
    );
    expect(warnCalls).toHaveLength(0);
  });

  it("emits one over_budget warn per offending story (not one per run)", async () => {
    const longBullet = "word ".repeat(40).trim();
    const ranked = [
      makeRankedEntry({
        id: 1,
        score: 80,
        rationale: "strong Developer-relevance",
        bullets: [longBullet, longBullet, longBullet, longBullet],
      }),
      makeRankedEntry({
        id: 2,
        score: 70,
        rationale: "strong Builder-impact",
      }), // under budget
      makeRankedEntry({
        id: 3,
        score: 60,
        rationale: "strong Signal-vs-hype",
        bullets: [longBullet, longBullet, longBullet, longBullet],
      }),
    ];
    const generateObject = makeGenerate({ ranked });

    await rankCandidates(
      [makeCandidate(1), makeCandidate(2), makeCandidate(3)],
      {
        topN: 5,
        generateObject,
        loadBodies: stubLoadBodies,
      },
    );

    const warnCalls = mockLoggerWarn.mock.calls.filter(
      (call) =>
        typeof call[0] === "object" &&
        call[0] !== null &&
        (call[0] as { event?: string }).event === "rank.recap.over_budget",
    );
    expect(warnCalls).toHaveLength(2);
    const ids = warnCalls
      .map((c) => (c[0] as { rawItemId: number }).rawItemId)
      .sort((a, b) => a - b);
    expect(ids).toEqual([1, 3]);
  });
});
