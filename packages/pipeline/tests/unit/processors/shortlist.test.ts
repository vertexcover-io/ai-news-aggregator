import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Candidate, UserProfile } from "@newsletter/shared";

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

type EmbedBatchFn = (
  inputs: string[],
  options?: { inputType?: "query" | "document" },
) => Promise<number[][]>;

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

function basisVector(dim: number, index: number): number[] {
  const v = new Array<number>(dim).fill(0);
  v[index] = 1;
  return v;
}

const DIM = 4;

beforeEach(() => {
  mockLoggerInfo.mockReset();
  mockLoggerWarn.mockReset();
  mockLoggerDebug.mockReset();
  mockLoggerError.mockReset();
});

describe("shortlistCandidates", () => {
  it("REQ-011: profiled combined score = relevance only (no recency factor)", async () => {
    // Title 0 matches topic (basis 0), title 1 matches topic (basis 1)
    const profile: UserProfile = {
      name: "alice",
      topics: ["ai", "ml"],
      antiTopics: [],
    };
    const candidates: Candidate[] = [
      makeCandidate({
        id: 1,
        title: "t1",
        publishedAt: new Date(NOW.getTime() - 24 * 3_600_000),
      }),
      makeCandidate({
        id: 2,
        title: "t2",
        publishedAt: new Date(NOW.getTime() - 48 * 3_600_000),
      }),
    ];
    const embed: EmbedBatchFn = vi
      .fn()
      .mockResolvedValueOnce([basisVector(DIM, 0), basisVector(DIM, 1)]) // topics
      .mockResolvedValueOnce([basisVector(DIM, 0), basisVector(DIM, 1)]); // titles

    const result = await shortlistCandidates(candidates, {
      profile,
      now: NOW,
      embedBatch: embed,
    });

    const b1 = result.breakdowns.find((b) => b.id === 1);
    const b2 = result.breakdowns.find((b) => b.id === 2);
    expect(b1).toBeDefined();
    expect(b2).toBeDefined();
    if (!b1 || !b2) throw new Error("unreachable");
    expect(b1.relevance).toBeCloseTo(1, 10);
    // combined = relevance only, no recency multiplication
    expect(b1.combined).toBeCloseTo(1, 10);
    expect(b2.combined).toBeCloseTo(1, 10);
    // recency field is always 0 in shortlist (moved to fusion)
    expect(b1.recency).toBe(0);
    expect(b2.recency).toBe(0);
  });

  it("REQ-021: relevance = max(topic sim) - 0.5 * max(antiTopic sim)", async () => {
    const profile: UserProfile = {
      name: "alice",
      topics: ["ai"],
      antiTopics: ["crypto"],
    };
    // Title vector = 0.6*topic + 0.8*antiTopic (orthonormal basis 0 and 1).
    // Normalize so cosine sims are exactly 0.6 and 0.8.
    const titleVec = [0.6, 0.8, 0, 0];
    const candidates: Candidate[] = [
      makeCandidate({ id: 1, title: "mixed", publishedAt: NOW }),
    ];
    const embed: EmbedBatchFn = vi
      .fn()
      .mockResolvedValueOnce([basisVector(DIM, 0), basisVector(DIM, 1)])
      .mockResolvedValueOnce([titleVec]);

    const result = await shortlistCandidates(candidates, {
      profile,
      now: NOW,
      embedBatch: embed,
    });

    const b = result.breakdowns[0];
    expect(b?.relevance).toBeCloseTo(0.6 - 0.5 * 0.8, 10);
  });

  it("REQ-011: no-profile combined=0 for all items", async () => {
    const embed = vi.fn<EmbedBatchFn>();
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

    const result = await shortlistCandidates(candidates, {
      profile: null,
      now: NOW,
      embedBatch: embed,
    });

    expect(embed.mock.calls.length).toBe(0);
    for (const b of result.breakdowns) {
      expect(b.combined).toBe(0);
      expect(b.recency).toBe(0);
    }
  });

  it("REQ-011: no-profile items sorted by id ascending", async () => {
    const embed = vi.fn<EmbedBatchFn>();
    const candidates: Candidate[] = [
      makeCandidate({
        id: 3,
        publishedAt: new Date(NOW.getTime() - 1 * 3_600_000),
      }),
      makeCandidate({
        id: 1,
        publishedAt: new Date(NOW.getTime() - 72 * 3_600_000),
      }),
      makeCandidate({
        id: 2,
        publishedAt: new Date(NOW.getTime() - 12 * 3_600_000),
      }),
    ];

    const result = await shortlistCandidates(candidates, {
      profile: null,
      now: NOW,
      embedBatch: embed,
    });

    expect(result.shortlist.map((c) => c.id)).toEqual([1, 2, 3]);
  });

  it("REQ-023: returns top K out of 100 candidates", async () => {
    const profile: UserProfile = {
      name: "alice",
      topics: ["ai"],
      antiTopics: [],
    };
    const candidates: Candidate[] = Array.from({ length: 100 }, (_, i) =>
      makeCandidate({
        id: i + 1,
        title: `t${i + 1}`,
        publishedAt: new Date(NOW.getTime() - i * 3_600_000),
      }),
    );
    const embed: EmbedBatchFn = vi
      .fn()
      .mockResolvedValueOnce([basisVector(DIM, 0)])
      .mockResolvedValueOnce(
        candidates.map(() => basisVector(DIM, 0)),
      );

    const result = await shortlistCandidates(candidates, {
      profile,
      shortlistSize: 20,
      now: NOW,
      embedBatch: embed,
    });

    expect(result.shortlist.length).toBe(20);
  });

  it("REQ-024: engagement fields do not affect score", async () => {
    const profile: UserProfile = {
      name: "alice",
      topics: ["ai"],
      antiTopics: [],
    };
    const base = makeCandidate({
      id: 1,
      title: "same",
      publishedAt: new Date(NOW.getTime() - 10 * 3_600_000),
      engagement: { points: 0, commentCount: 0 },
    });
    const other = makeCandidate({
      id: 2,
      title: "same",
      publishedAt: new Date(NOW.getTime() - 10 * 3_600_000),
      engagement: { points: 9999, commentCount: 9999 },
    });
    const embed: EmbedBatchFn = vi
      .fn()
      .mockResolvedValueOnce([basisVector(DIM, 0)])
      .mockResolvedValueOnce([basisVector(DIM, 0), basisVector(DIM, 0)]);

    const result = await shortlistCandidates([base, other], {
      profile,
      now: NOW,
      embedBatch: embed,
    });

    expect(result.breakdowns[0]?.combined).toBeCloseTo(
      result.breakdowns[1]?.combined ?? 0,
      12,
    );
  });

  it("REQ-009: when titleEmbeds absent, embedBatch IS called for titles once (2 calls total)", async () => {
    const profile: UserProfile = {
      name: "alice",
      topics: ["ai", "ml"],
      antiTopics: ["crypto"],
    };
    const candidates = Array.from({ length: 50 }, (_, i) =>
      makeCandidate({ id: i + 1, title: `t${i + 1}` }),
    );
    const embed = vi.fn<EmbedBatchFn>((inputs) =>
      Promise.resolve(inputs.map(() => basisVector(DIM, 0))),
    );

    await shortlistCandidates(candidates, {
      profile,
      now: NOW,
      embedBatch: embed,
    });

    expect(embed.mock.calls.length).toBe(2);
  });

  it("REQ-009: when titleEmbeds provided, embedBatch NOT called for titles (1 call total)", async () => {
    const profile: UserProfile = {
      name: "alice",
      topics: ["ai"],
      antiTopics: [],
    };
    const candidates = [
      makeCandidate({ id: 1, title: "t1" }),
      makeCandidate({ id: 2, title: "t2" }),
    ];
    const precomputedTitleEmbeds = [basisVector(DIM, 0), basisVector(DIM, 0)];
    const embed = vi.fn<EmbedBatchFn>((inputs) =>
      Promise.resolve(inputs.map(() => basisVector(DIM, 0))),
    );

    await shortlistCandidates(candidates, {
      profile,
      now: NOW,
      embedBatch: embed,
      titleEmbeds: precomputedTitleEmbeds,
    });

    // Only 1 call: for the profile topics — NOT for titles
    expect(embed.mock.calls.length).toBe(1);
    const firstCallInputs = embed.mock.calls[0]?.[0];
    expect(firstCallInputs).toContain("ai");
  });

  it("REQ-009: ShortlistResult.titleEmbeds matches input titleEmbeds slice when pre-computed embeds passed", async () => {
    const profile: UserProfile = {
      name: "alice",
      topics: ["ai"],
      antiTopics: [],
    };
    const candidates = [
      makeCandidate({ id: 1, title: "t1" }),
      makeCandidate({ id: 2, title: "t2" }),
    ];
    const precomputedTitleEmbeds = [
      [0.1, 0.2, 0.3, 0.4],
      [0.5, 0.6, 0.7, 0.8],
    ];
    const embed = vi.fn<EmbedBatchFn>((inputs) =>
      Promise.resolve(inputs.map(() => basisVector(DIM, 0))),
    );

    const result = await shortlistCandidates(candidates, {
      profile,
      shortlistSize: 5,
      now: NOW,
      embedBatch: embed,
      titleEmbeds: precomputedTitleEmbeds,
    });

    // Both candidates are in the shortlist; their titleEmbeds should match the input order
    expect(result.titleEmbeds.length).toBe(result.shortlist.length);
    for (let i = 0; i < result.shortlist.length; i++) {
      const item = result.shortlist[i];
      if (!item) continue;
      const expectedEmbed = precomputedTitleEmbeds[item.id - 1];
      expect(result.titleEmbeds[i]).toEqual(expectedEmbed);
    }
  });

  it("ShortlistResult.titleEmbeds has same length as shortlist", async () => {
    const profile: UserProfile = {
      name: "alice",
      topics: ["ai"],
      antiTopics: [],
    };
    const candidates = Array.from({ length: 30 }, (_, i) =>
      makeCandidate({ id: i + 1, title: `t${i + 1}` }),
    );
    const embed: EmbedBatchFn = vi.fn((inputs) =>
      Promise.resolve(inputs.map(() => basisVector(DIM, 0))),
    );

    const result = await shortlistCandidates(candidates, {
      profile,
      shortlistSize: 10,
      now: NOW,
      embedBatch: embed,
    });

    expect(result.titleEmbeds.length).toBe(result.shortlist.length);
    expect(result.shortlist.length).toBe(10);
  });

  it("REQ-026 / EDGE-007: null publishedAt — no-profile path still sorts by id", async () => {
    const candidates: Candidate[] = [
      makeCandidate({ id: 1, publishedAt: null }),
    ];

    const result = await shortlistCandidates(candidates, {
      profile: null,
      now: NOW,
    });

    expect(result.breakdowns[0]?.recency).toBe(0);
    expect(result.breakdowns[0]?.combined).toBe(0);
    expect(result.shortlist[0]?.id).toBe(1);
  });

  it("REQ-027: logs shortlist.start and shortlist.end with required fields", async () => {
    const candidates = [makeCandidate({ id: 1 })];

    await shortlistCandidates(candidates, {
      profile: null,
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
    expect(startEvent?.candidateCount).toBe(1);
    expect(startEvent?.shortlistSize).toBe(20);
    expect(endEvent).toBeDefined();
    expect(endEvent?.candidateCount ?? endEvent?.inputCount).toBeDefined();
    expect(typeof endEvent?.durationMs).toBe("number");
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

    const result = await shortlistCandidates(candidates, {
      profile: null,
      now: NOW,
    });

    expect(result.shortlist.map((c) => c.id)).toEqual([2, 5, 8]);
  });

  it("EDGE-001: logs warn thin_shortlist when candidates < shortlistSize", async () => {
    const candidates = [makeCandidate({ id: 1 })];
    const profile: UserProfile = {
      name: "alice",
      topics: ["ai"],
      antiTopics: [],
    };
    const embed: EmbedBatchFn = vi
      .fn()
      .mockResolvedValueOnce([basisVector(DIM, 0)])
      .mockResolvedValueOnce([basisVector(DIM, 0)]);

    await shortlistCandidates(candidates, {
      profile,
      shortlistSize: 20,
      now: NOW,
      embedBatch: embed,
    });

    const warnEvents = mockLoggerWarn.mock.calls.map((args) => args[0]);
    const thin = warnEvents.find(
      (e) => e && typeof e === "object" && e.event === "thin_shortlist",
    );
    expect(thin).toBeDefined();
  });

  it("EDGE-002: logs warn over_broad_profile when avg relevance > 0.8", async () => {
    const profile: UserProfile = {
      name: "alice",
      topics: ["ai"],
      antiTopics: [],
    };
    const candidates: Candidate[] = [
      makeCandidate({ id: 1, title: "a", publishedAt: NOW }),
      makeCandidate({ id: 2, title: "b", publishedAt: NOW }),
    ];
    // Title vectors identical to topic vector → relevance = 1.0, avg = 1.0 > 0.8
    const embed: EmbedBatchFn = vi
      .fn()
      .mockResolvedValueOnce([basisVector(DIM, 0)])
      .mockResolvedValueOnce([basisVector(DIM, 0), basisVector(DIM, 0)]);

    await shortlistCandidates(candidates, {
      profile,
      now: NOW,
      embedBatch: embed,
    });

    const warnEvents = mockLoggerWarn.mock.calls.map((args) => args[0]);
    const broad = warnEvents.find(
      (e) => e && typeof e === "object" && e.event === "over_broad_profile",
    );
    expect(broad).toBeDefined();
  });

  it("EDGE-004: empty candidates returns empty shortlist with no embed calls", async () => {
    const profile: UserProfile = {
      name: "alice",
      topics: ["ai"],
      antiTopics: [],
    };
    const embed = vi.fn<EmbedBatchFn>();

    const result = await shortlistCandidates([], {
      profile,
      now: NOW,
      embedBatch: embed,
    });

    expect(result).toEqual({ shortlist: [], breakdowns: [], titleEmbeds: [] });
    expect(embed.mock.calls.length).toBe(0);
  });

  it("EDGE-006: anti-topic match lowers but does not zero the score", async () => {
    const profile: UserProfile = {
      name: "alice",
      topics: ["ai"],
      antiTopics: ["crypto"],
    };
    const candidates: Candidate[] = [
      makeCandidate({ id: 1, title: "topic-match", publishedAt: NOW }),
      makeCandidate({ id: 2, title: "anti-match", publishedAt: NOW }),
    ];
    const embed: EmbedBatchFn = vi
      .fn()
      .mockResolvedValueOnce([basisVector(DIM, 0), basisVector(DIM, 1)])
      .mockResolvedValueOnce([
        basisVector(DIM, 0), // full topic hit → relevance 1.0
        basisVector(DIM, 1), // full anti-topic hit → relevance -0.5
      ]);

    const result = await shortlistCandidates(candidates, {
      profile,
      now: NOW,
      embedBatch: embed,
    });

    const b1 = result.breakdowns.find((b) => b.id === 1);
    const b2 = result.breakdowns.find((b) => b.id === 2);
    if (!b1 || !b2) throw new Error("missing");
    expect(b1.relevance).toBeCloseTo(1, 10);
    expect(b2.relevance).toBeCloseTo(-0.5, 10);
    expect(b1.combined).toBeGreaterThan(b2.combined);
    // Not zeroed / not hard-filtered: still present in result
    expect(result.shortlist.map((c) => c.id).sort()).toEqual([1, 2]);
  });

  it("EDGE-012: embedBatch throw surfaces as throw (no silent fallback)", async () => {
    const profile: UserProfile = {
      name: "alice",
      topics: ["ai"],
      antiTopics: [],
    };
    const candidates = [makeCandidate({ id: 1 })];
    const embed: EmbedBatchFn = vi
      .fn()
      .mockRejectedValue(new Error("voyage down"));

    await expect(
      shortlistCandidates(candidates, {
        profile,
        now: NOW,
        embedBatch: embed,
      }),
    ).rejects.toThrow("voyage down");
  });

  it("EDGE-015: empty candidate list → empty shortlist + empty titleEmbeds", async () => {
    const result = await shortlistCandidates([], {
      profile: null,
      now: NOW,
    });

    expect(result.shortlist).toEqual([]);
    expect(result.breakdowns).toEqual([]);
    expect(result.titleEmbeds).toEqual([]);
  });

  it("EDGE-016: single candidate passes through unchanged", async () => {
    const profile: UserProfile = {
      name: "alice",
      topics: ["ai"],
      antiTopics: [],
    };
    const candidate = makeCandidate({ id: 42, title: "solo" });
    const embed: EmbedBatchFn = vi
      .fn()
      .mockResolvedValueOnce([basisVector(DIM, 0)]) // topic
      .mockResolvedValueOnce([basisVector(DIM, 0)]); // title

    const result = await shortlistCandidates([candidate], {
      profile,
      now: NOW,
      embedBatch: embed,
    });

    expect(result.shortlist.length).toBe(1);
    expect(result.shortlist[0]?.id).toBe(42);
    expect(result.titleEmbeds.length).toBe(1);
  });

  it("Profile with no topics → relevance=0 for all, sorted by id", async () => {
    const profile: UserProfile = {
      name: "empty",
      topics: [],
      antiTopics: [],
    };
    const candidates: Candidate[] = [
      makeCandidate({ id: 5, title: "c" }),
      makeCandidate({ id: 2, title: "b" }),
      makeCandidate({ id: 8, title: "a" }),
    ];
    // embed returns empty array for zero topics
    const embed: EmbedBatchFn = vi
      .fn()
      .mockResolvedValueOnce([]) // zero topics → empty topicEmbeds
      .mockResolvedValueOnce([
        basisVector(DIM, 0),
        basisVector(DIM, 0),
        basisVector(DIM, 0),
      ]);

    const result = await shortlistCandidates(candidates, {
      profile,
      now: NOW,
      embedBatch: embed,
    });

    for (const b of result.breakdowns) {
      expect(b.relevance).toBe(0);
    }
    expect(result.shortlist.map((c) => c.id)).toEqual([2, 5, 8]);
  });

  it("no-profile titleEmbeds has empty arrays per item", async () => {
    const candidates: Candidate[] = [
      makeCandidate({ id: 1 }),
      makeCandidate({ id: 2 }),
    ];

    const result = await shortlistCandidates(candidates, {
      profile: null,
      now: NOW,
    });

    expect(result.titleEmbeds.length).toBe(2);
    for (const te of result.titleEmbeds) {
      expect(te).toEqual([]);
    }
  });
});
