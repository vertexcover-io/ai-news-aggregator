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

import { shortlistCandidates } from "@pipeline/processors/shortlist.js";

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
  it("REQ-022: sorts candidates by recency only", async () => {
    const candidates: Candidate[] = [
      makeCandidate({
        id: 1,
        publishedAt: new Date(NOW.getTime() - 72 * 3_600_000),
      }),
      makeCandidate({
        id: 2,
        publishedAt: new Date(NOW.getTime() - 1 * 3_600_000),
      }),
      makeCandidate({
        id: 3,
        publishedAt: new Date(NOW.getTime() - 12 * 3_600_000),
      }),
    ];

    const result = await shortlistCandidates(candidates, { now: NOW });

    expect(result.shortlist.map((c) => c.id)).toEqual([2, 3, 1]);
  });

  it("all items get relevance = 0 and combined = recency", async () => {
    const candidates: Candidate[] = [
      makeCandidate({
        id: 1,
        publishedAt: new Date(NOW.getTime() - 24 * 3_600_000),
      }),
      makeCandidate({
        id: 2,
        publishedAt: new Date(NOW.getTime() - 48 * 3_600_000),
      }),
    ];

    const result = await shortlistCandidates(candidates, { now: NOW });

    for (const b of result.breakdowns) {
      expect(b.relevance).toBe(0);
      expect(b.combined).toBeCloseTo(b.recency, 10);
    }
    const b1 = result.breakdowns.find((b) => b.id === 1);
    const b2 = result.breakdowns.find((b) => b.id === 2);
    expect(b1?.combined).toBeCloseTo(Math.exp(-24 / 48), 10);
    expect(b2?.combined).toBeCloseTo(Math.exp(-48 / 48), 10);
  });

  it("returns top K out of many candidates", async () => {
    const candidates: Candidate[] = Array.from({ length: 100 }, (_, i) =>
      makeCandidate({
        id: i + 1,
        publishedAt: new Date(NOW.getTime() - i * 3_600_000),
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

    expect(result.breakdowns[0].recency).toBeCloseTo(Math.exp(-24 / 48), 12);
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
    const candidates: Candidate[] = [
      makeCandidate({
        id: 5,
        publishedAt: new Date(NOW.getTime() - 10 * 3_600_000),
      }),
      makeCandidate({
        id: 2,
        publishedAt: new Date(NOW.getTime() - 10 * 3_600_000),
      }),
      makeCandidate({
        id: 8,
        publishedAt: new Date(NOW.getTime() - 10 * 3_600_000),
      }),
    ];

    const result = await shortlistCandidates(candidates, { now: NOW });

    expect(result.shortlist.map((c) => c.id)).toEqual([2, 5, 8]);
  });

  it("EDGE-004: empty candidates returns empty shortlist", async () => {
    const result = await shortlistCandidates([], { now: NOW });

    expect(result).toEqual({ shortlist: [], breakdowns: [] });
  });
});
