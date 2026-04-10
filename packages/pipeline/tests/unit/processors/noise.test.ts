import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Candidate } from "@newsletter/shared";

const { mockLoggerInfo } = vi.hoisted(() => ({
  mockLoggerInfo: vi.fn(),
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
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    })),
  };
});

import {
  filterNoise,
  NOISE_PATTERNS,
  MIN_ENGAGEMENT,
} from "@pipeline/processors/noise.js";

function makeCandidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: 1,
    title: "Some interesting AI article",
    url: "https://example.com/1",
    sourceType: "hn",
    author: null,
    publishedAt: new Date("2026-04-09T12:00:00Z"),
    engagement: { points: 10, commentCount: 5 },
    content: null,
    comments: [],
    ...overrides,
  };
}

beforeEach(() => {
  mockLoggerInfo.mockReset();
});

describe("NOISE_PATTERNS", () => {
  it("contains at least 5 patterns", () => {
    expect(NOISE_PATTERNS.length).toBeGreaterThanOrEqual(5);
  });
});

describe("MIN_ENGAGEMENT", () => {
  it("has hn threshold of 5", () => {
    expect(MIN_ENGAGEMENT.hn).toBe(5);
  });

  it("has reddit threshold of 10", () => {
    expect(MIN_ENGAGEMENT.reddit).toBe(10);
  });

  it("has blog threshold of 0", () => {
    expect(MIN_ENGAGEMENT.blog).toBe(0);
  });
});

describe("filterNoise", () => {
  describe("title pattern filtering (REQ-001)", () => {
    it('REQ-001: "Ask HN:" title is filtered', () => {
      const c = makeCandidate({ title: "Ask HN: What is the best way to learn Rust?" });
      expect(filterNoise([c])).toHaveLength(0);
    });

    it('REQ-001: "Who is hiring?" title is filtered', () => {
      const c = makeCandidate({ title: "Who is hiring? (April 2026)" });
      expect(filterNoise([c])).toHaveLength(0);
    });

    it('REQ-001: "Tell HN:" title is filtered', () => {
      const c = makeCandidate({ title: "Tell HN: I built a new tool" });
      expect(filterNoise([c])).toHaveLength(0);
    });

    it('REQ-001: "Show HN:" title is filtered', () => {
      const c = makeCandidate({ title: "Show HN: My new side project" });
      expect(filterNoise([c])).toHaveLength(0);
    });

    it('REQ-001: "Hiring" title is filtered', () => {
      const c = makeCandidate({ title: "Hiring Senior Engineers at Acme Corp" });
      expect(filterNoise([c])).toHaveLength(0);
    });

    it("REQ-001: noise patterns are case-insensitive", () => {
      const c = makeCandidate({ title: "ASK HN: lowercase check" });
      expect(filterNoise([c])).toHaveLength(0);
    });

    it("REQ-001: non-noise title passes through", () => {
      const c = makeCandidate({ title: "GPT-5 achieves state of the art on MMLU" });
      expect(filterNoise([c])).toHaveLength(1);
    });
  });

  describe("engagement threshold filtering (REQ-002)", () => {
    it("REQ-002: HN item with points < 5 is filtered", () => {
      const c = makeCandidate({
        sourceType: "hn",
        engagement: { points: 4, commentCount: 0 },
      });
      expect(filterNoise([c])).toHaveLength(0);
    });

    it("REQ-002: HN item with points >= 5 passes", () => {
      const c = makeCandidate({
        sourceType: "hn",
        engagement: { points: 5, commentCount: 0 },
      });
      expect(filterNoise([c])).toHaveLength(1);
    });

    it("REQ-002: Reddit item with points < 10 is filtered", () => {
      const c = makeCandidate({
        sourceType: "reddit",
        engagement: { points: 9, commentCount: 0 },
      });
      expect(filterNoise([c])).toHaveLength(0);
    });

    it("REQ-002: Reddit item with points >= 10 passes", () => {
      const c = makeCandidate({
        sourceType: "reddit",
        engagement: { points: 10, commentCount: 0 },
      });
      expect(filterNoise([c])).toHaveLength(1);
    });

    it("REQ-002: blog item always passes engagement threshold (threshold=0)", () => {
      const c = makeCandidate({
        sourceType: "blog",
        engagement: { points: 0, commentCount: 0 },
      });
      expect(filterNoise([c])).toHaveLength(1);
    });

    it("REQ-002: item at exactly threshold passes", () => {
      const c = makeCandidate({
        sourceType: "hn",
        engagement: { points: 5, commentCount: 0 },
      });
      expect(filterNoise([c])).toHaveLength(1);
    });

    it("REQ-002: unknown sourceType uses 0 threshold (always passes)", () => {
      const c = makeCandidate({
        sourceType: "rss",
        engagement: { points: 0, commentCount: 0 },
      });
      expect(filterNoise([c])).toHaveLength(1);
    });
  });

  describe("edge cases", () => {
    it("EDGE-001: all items match noise patterns → empty array returned", () => {
      const candidates = [
        makeCandidate({ id: 1, title: "Ask HN: question one" }),
        makeCandidate({ id: 2, title: "Who is hiring? (March)" }),
        makeCandidate({ id: 3, title: "Tell HN: something" }),
      ];
      expect(filterNoise(candidates)).toEqual([]);
    });

    it("EDGE-002: empty input → empty output", () => {
      expect(filterNoise([])).toEqual([]);
    });

    it("EDGE-003: custom patterns override defaults when provided", () => {
      const customPatterns = [/custom noise/i];
      const normalCandidate = makeCandidate({
        id: 1,
        title: "Ask HN: this would normally be filtered",
        engagement: { points: 10, commentCount: 0 },
      });
      const noiseCandidate = makeCandidate({
        id: 2,
        title: "custom noise title here",
        engagement: { points: 10, commentCount: 0 },
      });

      const result = filterNoise([normalCandidate, noiseCandidate], {
        patterns: customPatterns,
      });

      // With custom patterns, Ask HN should pass and custom noise should be filtered
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe(1);
    });
  });

  describe("logging (REQ-029)", () => {
    it("REQ-029: logger.info called with inputCount, outputCount, durationMs", () => {
      const candidates = [
        makeCandidate({ id: 1, title: "Good article", engagement: { points: 10, commentCount: 5 } }),
        makeCandidate({ id: 2, title: "Ask HN: question", engagement: { points: 10, commentCount: 5 } }),
      ];

      filterNoise(candidates, { runId: "test-run-1" });

      expect(mockLoggerInfo).toHaveBeenCalledOnce();
      const call = mockLoggerInfo.mock.calls[0];
      const logObj = call?.[0] as Record<string, unknown>;

      expect(logObj).toMatchObject({
        inputCount: 2,
        outputCount: 1,
        durationMs: expect.any(Number),
      });
    });

    it("REQ-029: runId is included in log when provided", () => {
      filterNoise([], { runId: "run-xyz" });

      expect(mockLoggerInfo).toHaveBeenCalledOnce();
      const call = mockLoggerInfo.mock.calls[0];
      const logObj = call?.[0] as Record<string, unknown>;
      expect(logObj).toMatchObject({ runId: "run-xyz" });
    });
  });
});
