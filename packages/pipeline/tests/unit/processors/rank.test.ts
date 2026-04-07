import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";

const { mockLoggerInfo, mockLoggerError } = vi.hoisted(() => ({
  mockLoggerInfo: vi.fn(),
  mockLoggerError: vi.fn(),
}));

vi.mock("@newsletter/shared", async () => {
  const actual = await vi.importActual("@newsletter/shared");
  return {
    ...actual,
    createLogger: vi.fn(() => ({
      info: mockLoggerInfo,
      warn: vi.fn(),
      error: mockLoggerError,
    })),
  };
});

import {
  rankCandidates,
  rankSystemPrompt,
  type RankCandidate,
} from "@pipeline/processors/rank.js";

interface GenerateArgs {
  model: unknown;
  system: string;
  prompt: string;
  schema: z.ZodType;
}

interface RankedEntry {
  id: number;
  score: number;
  rationale: string;
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

function makeCandidate(id: number, points = 0, commentCount = 0): RankCandidate {
  return {
    id,
    title: `title-${id}`,
    url: `https://example.com/${id}`,
    sourceType: "hn",
    publishedAt: "2026-04-07T00:00:00Z",
    engagement: { points, commentCount },
  };
}

describe("rankCandidates", () => {
  const originalModel = process.env.RANKING_MODEL;
  const originalKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  beforeEach(() => {
    delete process.env.RANKING_MODEL;
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-key";
    mockLoggerInfo.mockClear();
    mockLoggerError.mockClear();
  });

  afterEach(() => {
    if (originalModel === undefined) delete process.env.RANKING_MODEL;
    else process.env.RANKING_MODEL = originalModel;
    if (originalKey === undefined) delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    else process.env.GOOGLE_GENERATIVE_AI_API_KEY = originalKey;
  });

  it("truncates to 100 candidates by engagement desc before calling generate (REQ-060)", async () => {
    const candidates: RankCandidate[] = Array.from({ length: 150 }, (_, i) =>
      makeCandidate(i + 1, i + 1, 0),
    );
    const generate = makeGenerate({
      ranked: [{ id: 150, score: 90, rationale: "ok" }],
    });

    await rankCandidates(candidates, { topN: 10 }, generate);

    expect(generate).toHaveBeenCalledTimes(1);
    const call = generate.mock.calls[0]?.[0] as GenerateArgs;
    const payload = JSON.parse(call.prompt) as {
      candidates: { id: number }[];
    };
    expect(payload.candidates).toHaveLength(100);
    expect(payload.candidates[0]?.id).toBe(150);
    expect(payload.candidates[99]?.id).toBe(51);
  });

  it("calls generate exactly once with system prompt and a zod schema (REQ-061)", async () => {
    const generate = makeGenerate({
      ranked: [{ id: 1, score: 50, rationale: "ok" }],
    });

    await rankCandidates([makeCandidate(1)], { topN: 5 }, generate);

    expect(generate).toHaveBeenCalledTimes(1);
    const call = generate.mock.calls[0]?.[0] as GenerateArgs;
    expect(call.system).toBe(rankSystemPrompt);
    expect(call.schema).toBeDefined();
    const parsed = call.schema.safeParse({
      ranked: [{ id: 1, score: 50, rationale: "ok" }],
    });
    expect(parsed.success).toBe(true);
    const bad = call.schema.safeParse({ ranked: [{ id: 1, score: 50 }] });
    expect(bad.success).toBe(false);
  });

  it("serializes candidate payload with required fields (REQ-062)", async () => {
    const generate = makeGenerate({
      ranked: [{ id: 1, score: 50, rationale: "ok" }],
    });
    const candidate = makeCandidate(1, 5, 2);

    await rankCandidates([candidate], { topN: 5 }, generate);

    const call = generate.mock.calls[0]?.[0] as GenerateArgs;
    const payload = JSON.parse(call.prompt) as {
      candidates: Record<string, unknown>[];
    };
    expect(payload.candidates).toHaveLength(1);
    const entry = payload.candidates[0];
    expect(entry).toEqual({
      id: 1,
      title: "title-1",
      url: "https://example.com/1",
      sourceType: "hn",
      publishedAt: "2026-04-07T00:00:00Z",
      engagement: { points: 5, commentCount: 2 },
    });
  });

  it("sorts by score desc and truncates to topN (REQ-063)", async () => {
    const candidates = Array.from({ length: 10 }, (_, i) => makeCandidate(i + 1));
    const generate = makeGenerate({
      ranked: [
        { id: 1, score: 10, rationale: "a" },
        { id: 2, score: 90, rationale: "b" },
        { id: 3, score: 50, rationale: "c" },
        { id: 4, score: 80, rationale: "d" },
        { id: 5, score: 20, rationale: "e" },
        { id: 6, score: 70, rationale: "f" },
        { id: 7, score: 30, rationale: "g" },
        { id: 8, score: 60, rationale: "h" },
        { id: 9, score: 40, rationale: "i" },
        { id: 10, score: 100, rationale: "j" },
      ],
    });

    const result = await rankCandidates(candidates, { topN: 3 }, generate);

    expect(result.rankedItems).toHaveLength(3);
    expect(result.rankedItems.map((r) => r.rawItemId)).toEqual([10, 2, 4]);
    expect(result.rankedItems.map((r) => r.score)).toEqual([100, 90, 80]);
    expect(result.rankedCount).toBe(3);
    expect(result.candidateCount).toBe(10);
  });

  it("filters out IDs not present in candidates (EDGE-008)", async () => {
    const candidates = [makeCandidate(1), makeCandidate(2)];
    const generate = makeGenerate({
      ranked: [
        { id: 1, score: 50, rationale: "ok" },
        { id: 999, score: 99, rationale: "ghost" },
        { id: 2, score: 70, rationale: "ok" },
      ],
    });

    const result = await rankCandidates(candidates, { topN: 10 }, generate);

    expect(result.rankedItems.map((r) => r.rawItemId)).toEqual([2, 1]);
  });

  it("throws if all ranked IDs are invalid (EDGE-008)", async () => {
    const generate = makeGenerate({
      ranked: [{ id: 999, score: 50, rationale: "ghost" }],
    });

    await expect(
      rankCandidates([makeCandidate(1)], { topN: 5 }, generate),
    ).rejects.toThrow("ranking returned no valid items");
  });

  it("rethrows generate failures as 'ranking failed: ...' (REQ-064)", async () => {
    const generate = makeGenerate(new Error("boom"));

    await expect(
      rankCandidates([makeCandidate(1)], { topN: 5 }, generate),
    ).rejects.toThrow("ranking failed: boom");
  });

  it("uses RANKING_MODEL env var when set, default otherwise (REQ-065)", async () => {
    const generate = makeGenerate({
      ranked: [{ id: 1, score: 50, rationale: "ok" }],
    });

    process.env.RANKING_MODEL = "gemini-2.5-pro";
    await rankCandidates([makeCandidate(1)], { topN: 5 }, generate);
    const callA = generate.mock.calls[0]?.[0] as GenerateArgs;
    const modelA = callA.model as { modelId?: string };
    expect(modelA.modelId).toContain("gemini-2.5-pro");

    delete process.env.RANKING_MODEL;
    await rankCandidates([makeCandidate(1)], { topN: 5 }, generate);
    const callB = generate.mock.calls[1]?.[0] as GenerateArgs;
    const modelB = callB.model as { modelId?: string };
    expect(modelB.modelId).toContain("gemini-2.5-flash");
  });

  it("loads system prompt from disk as a non-empty string (REQ-066)", () => {
    expect(typeof rankSystemPrompt).toBe("string");
    expect(rankSystemPrompt.length).toBeGreaterThan(0);
    expect(rankSystemPrompt).toMatch(/rank/i);
  });

  it("handles a single candidate (EDGE-009)", async () => {
    const generate = makeGenerate({
      ranked: [{ id: 1, score: 75, rationale: "great" }],
    });

    const result = await rankCandidates(
      [makeCandidate(1)],
      { topN: 5 },
      generate,
    );

    expect(result.rankedItems).toHaveLength(1);
    expect(result.rankedItems[0]).toEqual({
      rawItemId: 1,
      score: 75,
      rationale: "great",
    });
  });

  it("returns all candidates when topN exceeds candidate count (EDGE-010)", async () => {
    const candidates = [makeCandidate(1), makeCandidate(2), makeCandidate(3)];
    const generate = makeGenerate({
      ranked: [
        { id: 1, score: 10, rationale: "a" },
        { id: 2, score: 20, rationale: "b" },
        { id: 3, score: 30, rationale: "c" },
      ],
    });

    const result = await rankCandidates(candidates, { topN: 10 }, generate);

    expect(result.rankedItems).toHaveLength(3);
    expect(result.rankedItems.map((r) => r.rawItemId)).toEqual([3, 2, 1]);
  });

  it("emits run.rank log including runId, candidateCount, rankedCount (REQ-084)", async () => {
    const generate = makeGenerate({
      ranked: [
        { id: 1, score: 50, rationale: "ok" },
        { id: 2, score: 70, rationale: "ok" },
      ],
    });

    await rankCandidates(
      [makeCandidate(1), makeCandidate(2)],
      { topN: 5, runId: "run-xyz" },
      generate,
    );

    const rankLog = mockLoggerInfo.mock.calls.find(
      (c) => (c[0] as { event?: string }).event === "run.rank",
    );
    expect(rankLog).toBeDefined();
    const payload = rankLog?.[0] as {
      event: string;
      runId: string;
      candidateCount: number;
      rankedCount: number;
    };
    expect(payload.runId).toBe("run-xyz");
    expect(payload.candidateCount).toBe(2);
    expect(payload.rankedCount).toBe(2);
  });

  it("returns empty result for empty candidates without calling generate", async () => {
    const generate = makeGenerate({ ranked: [] });

    const result = await rankCandidates([], { topN: 5 }, generate);

    expect(generate).not.toHaveBeenCalled();
    expect(result).toEqual({
      rankedItems: [],
      candidateCount: 0,
      rankedCount: 0,
    });
  });
});
