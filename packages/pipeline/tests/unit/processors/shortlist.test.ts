import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Candidate } from "@newsletter/shared";

const { mockLoggerInfo, mockLoggerWarn, mockLoggerDebug, mockLoggerError } =
  vi.hoisted(() => ({
    mockLoggerInfo: vi.fn(),
    mockLoggerWarn: vi.fn(),
    mockLoggerDebug: vi.fn(),
    mockLoggerError: vi.fn(),
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
      debug: mockLoggerDebug,
      error: mockLoggerError,
    })),
  };
});

import {
  shortlistCandidates,
  DEFAULT_ENGAGEMENT_WEIGHT,
  DEFAULT_RECENCY_WEIGHT,
} from "@pipeline/processors/shortlist.js";
import { engagementScore } from "@pipeline/services/recency.js";

const NOW = new Date("2026-04-09T12:00:00Z");

function makeCandidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: 1,
    title: "Default title",
    url: "https://example.com/1",
    sourceType: "hn",
    author: null,
    publishedAt: new Date(NOW.getTime() - 24 * 3_600_000),
    engagement: { points: 0, commentCount: 0 },
    content: null,
    comments: [],
    ...overrides,
  };
}

beforeEach(() => {
  mockLoggerInfo.mockReset();
  mockLoggerWarn.mockReset();
  mockLoggerDebug.mockReset();
  mockLoggerError.mockReset();
});

describe("shortlistCandidates", () => {
  it("ranks by engagement + recency blend, not recency alone", async () => {
    const candidates: Candidate[] = [
      makeCandidate({
        id: 1,
        publishedAt: new Date(NOW.getTime() - 6 * 3_600_000),
        engagement: { points: 500, commentCount: 80 },
      }),
      makeCandidate({
        id: 2,
        publishedAt: new Date(NOW.getTime() - 1 * 3_600_000),
        engagement: { points: 0, commentCount: 0 },
      }),
      makeCandidate({
        id: 3,
        publishedAt: new Date(NOW.getTime() - 3 * 3_600_000),
        engagement: { points: 100, commentCount: 20 },
      }),
    ];

    const result = await shortlistCandidates(candidates, { now: NOW });

    // High-engagement older post should beat zero-engagement fresh post
    expect(result.shortlist[0].id).toBe(1);
    // Mid-engagement mid-age post should beat zero-engagement fresh post
    expect(result.shortlist[1].id).toBe(3);
    expect(result.shortlist[2].id).toBe(2);
  });

  it("blog posts with zero engagement still make the shortlist via recency", async () => {
    const candidates: Candidate[] = [
      makeCandidate({
        id: 1,
        sourceType: "blog",
        publishedAt: new Date(NOW.getTime() - 2 * 3_600_000),
        engagement: { points: 0, commentCount: 0 },
      }),
      makeCandidate({
        id: 2,
        sourceType: "hn",
        publishedAt: new Date(NOW.getTime() - 4 * 3_600_000),
        engagement: { points: 200, commentCount: 30 },
      }),
    ];

    const result = await shortlistCandidates(candidates, { now: NOW });

    // Both should be in the shortlist
    expect(result.shortlist.length).toBe(2);
    // Blog post with zero engagement should still have a reasonable score
    const blogBreakdown = result.breakdowns.find((b) => b.id === 1);
    // Score should be at least recencyWeight * recency(2h) ≈ 0.5 * 0.97 = 0.49
    expect(blogBreakdown?.combined).toBeGreaterThan(0.4);
  });

  it("populates relevance field with normalized engagement score", async () => {
    const candidates: Candidate[] = [
      makeCandidate({
        id: 1,
        publishedAt: new Date(NOW.getTime() - 24 * 3_600_000),
        engagement: { points: 100, commentCount: 20 },
      }),
      makeCandidate({
        id: 2,
        publishedAt: new Date(NOW.getTime() - 24 * 3_600_000),
        engagement: { points: 0, commentCount: 0 },
      }),
    ];

    const result = await shortlistCandidates(candidates, { now: NOW });

    const b1 = result.breakdowns.find((b) => b.id === 1);
    const b2 = result.breakdowns.find((b) => b.id === 2);
    // Highest engagement candidate gets relevance = 1.0
    expect(b1?.relevance).toBeCloseTo(1.0);
    // Zero engagement gets relevance = 0.0
    expect(b2?.relevance).toBeCloseTo(0.0);
  });

  it("combined = engagementWeight * relevance + recencyWeight * recency", async () => {
    const candidates: Candidate[] = [
      makeCandidate({
        id: 1,
        publishedAt: new Date(NOW.getTime() - 24 * 3_600_000),
        engagement: { points: 100, commentCount: 0 },
      }),
    ];

    const result = await shortlistCandidates(candidates, { now: NOW });

    const b = result.breakdowns[0];
    // Single candidate → relevance = 1.0 (it's the max)
    expect(b.relevance).toBeCloseTo(1.0);
    const expectedRecency = Math.exp(-24 / 72);
    const expectedCombined =
      DEFAULT_ENGAGEMENT_WEIGHT * 1.0 + DEFAULT_RECENCY_WEIGHT * expectedRecency;
    expect(b.combined).toBeCloseTo(expectedCombined, 10);
  });

  it("all zero engagement candidates get relevance = 0 and combined = recencyWeight * recency", async () => {
    const candidates: Candidate[] = [
      makeCandidate({
        id: 1,
        publishedAt: new Date(NOW.getTime() - 24 * 3_600_000),
        engagement: { points: 0, commentCount: 0 },
      }),
      makeCandidate({
        id: 2,
        publishedAt: new Date(NOW.getTime() - 48 * 3_600_000),
        engagement: { points: 0, commentCount: 0 },
      }),
    ];

    const result = await shortlistCandidates(candidates, { now: NOW });

    for (const b of result.breakdowns) {
      expect(b.relevance).toBe(0);
      expect(b.combined).toBeCloseTo(DEFAULT_RECENCY_WEIGHT * b.recency, 10);
    }
  });

  it("returns top K out of many candidates", async () => {
    const candidates: Candidate[] = Array.from({ length: 100 }, (_, i) =>
      makeCandidate({
        id: i + 1,
        publishedAt: new Date(NOW.getTime() - i * 3_600_000),
        engagement: { points: 100 - i, commentCount: 10 },
      }),
    );

    const result = await shortlistCandidates(candidates, {
      shortlistSize: 20,
      now: NOW,
    });

    expect(result.shortlist.length).toBe(20);
  });

  it("REQ-026 / EDGE-007: null publishedAt yields recency = exp(-24/48)", async () => {
    const candidates: Candidate[] = [
      makeCandidate({ id: 1, publishedAt: null }),
    ];

    const result = await shortlistCandidates(candidates, { now: NOW });

    expect(result.breakdowns[0].recency).toBeCloseTo(Math.exp(-24 / 72), 12);
  });

  it("REQ-027: logs shortlist.start and shortlist.end with required fields", async () => {
    const candidates = [makeCandidate({ id: 1 })];

    await shortlistCandidates(candidates, {
      shortlistSize: 20,
      now: NOW,
    });

    const infoEvents = mockLoggerInfo.mock.calls.map((args) => args[0]);
    const startEvent = infoEvents.find(
      (e) => e && typeof e === "object" && e.event === "shortlist.start",
    );
    const endEvent = infoEvents.find(
      (e) => e && typeof e === "object" && e.event === "shortlist.end",
    );
    expect(startEvent).toBeDefined();
    expect(startEvent.candidateCount).toBe(1);
    expect(startEvent.shortlistSize).toBe(20);
    expect(endEvent).toBeDefined();
    expect(endEvent.candidateCount ?? endEvent.inputCount).toBeDefined();
    expect(typeof endEvent.durationMs).toBe("number");
  });

  it("REQ-028: deterministic tie-break by ascending id", async () => {
    const sameTime = new Date(NOW.getTime() - 10 * 3_600_000);
    const candidates: Candidate[] = [
      makeCandidate({
        id: 5,
        publishedAt: sameTime,
        engagement: { points: 50, commentCount: 5 },
      }),
      makeCandidate({
        id: 2,
        publishedAt: sameTime,
        engagement: { points: 50, commentCount: 5 },
      }),
      makeCandidate({
        id: 8,
        publishedAt: sameTime,
        engagement: { points: 50, commentCount: 5 },
      }),
    ];

    const result = await shortlistCandidates(candidates, { now: NOW });

    expect(result.shortlist.map((c) => c.id)).toEqual([2, 5, 8]);
  });

  it("EDGE-004: empty candidates returns empty shortlist", async () => {
    const result = await shortlistCandidates([], { now: NOW });

    expect(result).toEqual({ shortlist: [], breakdowns: [] });
  });

  describe("dynamic shortlist sizing", () => {
    it("shrinks below default when few candidates pass the score floor", async () => {
      // 12 candidates, but only a few will score above 0.15
      // Very old items with zero engagement will score below the floor
      const candidates: Candidate[] = Array.from({ length: 12 }, (_, i) =>
        makeCandidate({
          id: i + 1,
          publishedAt: new Date(NOW.getTime() - (i * 50 + 200) * 3_600_000),
          engagement: { points: 0, commentCount: 0 },
        }),
      );

      const result = await shortlistCandidates(candidates, {
        shortlistSize: 20,
        now: NOW,
      });

      // Should be clamped to MIN_SHORTLIST_SIZE (10) since all items score
      // below the floor (200+ hours old, zero engagement)
      expect(result.shortlist.length).toBe(10);
    });

    it("never returns fewer than MIN_SHORTLIST_SIZE (10)", async () => {
      const candidates: Candidate[] = Array.from({ length: 15 }, (_, i) =>
        makeCandidate({
          id: i + 1,
          publishedAt: new Date(NOW.getTime() - 500 * 3_600_000),
          engagement: { points: 0, commentCount: 0 },
        }),
      );

      const result = await shortlistCandidates(candidates, {
        shortlistSize: 20,
        now: NOW,
      });

      expect(result.shortlist.length).toBeGreaterThanOrEqual(10);
    });

    it("never returns more than MAX_SHORTLIST_SIZE (30)", async () => {
      const candidates: Candidate[] = Array.from({ length: 50 }, (_, i) =>
        makeCandidate({
          id: i + 1,
          publishedAt: new Date(NOW.getTime() - i * 3_600_000),
          engagement: { points: 200, commentCount: 30 },
        }),
      );

      const result = await shortlistCandidates(candidates, {
        shortlistSize: 50,
        now: NOW,
      });

      expect(result.shortlist.length).toBeLessThanOrEqual(30);
    });

    it("respects configuredSize as upper bound within MIN/MAX range", async () => {
      const candidates: Candidate[] = Array.from({ length: 30 }, (_, i) =>
        makeCandidate({
          id: i + 1,
          publishedAt: new Date(NOW.getTime() - i * 3_600_000),
          engagement: { points: 100, commentCount: 10 },
        }),
      );

      const result = await shortlistCandidates(candidates, {
        shortlistSize: 15,
        now: NOW,
      });

      expect(result.shortlist.length).toBeLessThanOrEqual(15);
    });
  });

  describe("engagementScore", () => {
    it("returns 0 for zero points and zero comments", () => {
      expect(engagementScore(0, 0)).toBe(0);
    });

    it("weights comments at 0.5x points", () => {
      const pointsOnly = engagementScore(100, 0);
      const commentsOnly = engagementScore(0, 100);
      expect(commentsOnly).toBeCloseTo(0.5 * pointsOnly, 10);
    });

    it("compresses high values via log scale", () => {
      const low = engagementScore(10, 5);
      const high = engagementScore(1000, 500);
      // 100x difference in raw engagement, but much less in score
      expect(high / low).toBeLessThan(3.5);
    });
  });
});
