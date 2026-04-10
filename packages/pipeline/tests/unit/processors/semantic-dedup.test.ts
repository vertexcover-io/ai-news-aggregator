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
  semanticDedupCandidates,
  SIMILARITY_THRESHOLD,
  AUTHORITY_RANK,
} from "@pipeline/processors/semantic-dedup.js";

type EmbedBatchFn = (
  inputs: string[],
  options?: { inputType?: "query" | "document" },
) => Promise<number[][]>;

let idCounter = 1;

function makeCandidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: idCounter++,
    title: "Default title",
    url: `https://example.com/${idCounter}`,
    sourceType: "hn",
    author: null,
    publishedAt: new Date("2026-04-09T12:00:00Z"),
    engagement: { points: 10, commentCount: 5 },
    content: null,
    comments: [],
    ...overrides,
  };
}

// Orthonormal basis vectors for controlled cosine similarity
function basisVector(dim: number, index: number): number[] {
  const v = new Array<number>(dim).fill(0);
  v[index] = 1;
  return v;
}

// Two vectors in the same direction → cosine = 1.0
// Two orthogonal vectors → cosine = 0.0
const DIM = 4;

beforeEach(() => {
  idCounter = 1;
  mockLoggerInfo.mockReset();
  mockLoggerWarn.mockReset();
  mockLoggerDebug.mockReset();
  mockLoggerError.mockReset();
});

describe("semanticDedupCandidates", () => {
  describe("exported constants", () => {
    it("SIMILARITY_THRESHOLD is 0.85", () => {
      expect(SIMILARITY_THRESHOLD).toBe(0.85);
    });

    it("AUTHORITY_RANK has blog=3, reddit=2, hn=1", () => {
      expect(AUTHORITY_RANK).toEqual({ blog: 3, reddit: 2, hn: 1 });
    });
  });

  describe("EDGE-002: empty input", () => {
    it("returns empty candidates and empty titleEmbeds without calling embedBatch", async () => {
      const embed = vi.fn<EmbedBatchFn>();

      const result = await semanticDedupCandidates([], { embedBatch: embed });

      expect(result.candidates).toEqual([]);
      expect(result.titleEmbeds).toEqual([]);
      expect(embed).not.toHaveBeenCalled();
    });
  });

  describe("EDGE-003: single item", () => {
    it("returns the item unchanged with its embedding", async () => {
      const c = makeCandidate({ title: "single item" });
      const embed: EmbedBatchFn = vi
        .fn()
        .mockResolvedValue([basisVector(DIM, 0)]);

      const result = await semanticDedupCandidates([c], { embedBatch: embed });

      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]).toBe(c);
      expect(result.titleEmbeds).toHaveLength(1);
      expect(result.titleEmbeds[0]).toEqual(basisVector(DIM, 0));
    });
  });

  describe("REQ-003: single embedBatch call", () => {
    it("calls embedBatch exactly once with all titles and inputType=document", async () => {
      const c1 = makeCandidate({ title: "item one" });
      const c2 = makeCandidate({ title: "item two" });
      const c3 = makeCandidate({ title: "item three" });
      const embed: EmbedBatchFn = vi
        .fn()
        .mockResolvedValue([
          basisVector(DIM, 0),
          basisVector(DIM, 1),
          basisVector(DIM, 2),
        ]);

      await semanticDedupCandidates([c1, c2, c3], { embedBatch: embed });

      expect(embed).toHaveBeenCalledTimes(1);
      expect(embed).toHaveBeenCalledWith(
        ["item one", "item two", "item three"],
        { inputType: "document" },
      );
    });
  });

  describe("REQ-003 (merge cluster): items with cosine > threshold are merged", () => {
    it("two identical-direction vectors (cosine=1.0) → merged into one", async () => {
      const c1 = makeCandidate({ title: "AI breakthrough announced" });
      const c2 = makeCandidate({ title: "AI breakthrough announced copy" });
      // Same direction → cosine = 1.0 > 0.85
      const embed: EmbedBatchFn = vi
        .fn()
        .mockResolvedValue([basisVector(DIM, 0), basisVector(DIM, 0)]);

      const result = await semanticDedupCandidates([c1, c2], {
        embedBatch: embed,
      });

      expect(result.candidates).toHaveLength(1);
    });
  });

  describe("REQ-007: items below threshold stay separate", () => {
    it("two orthogonal vectors (cosine=0.0) → remain as separate items", async () => {
      const c1 = makeCandidate({ title: "AI research paper" });
      const c2 = makeCandidate({ title: "Cooking recipes blog" });
      // Orthogonal → cosine = 0.0 < 0.85
      const embed: EmbedBatchFn = vi
        .fn()
        .mockResolvedValue([basisVector(DIM, 0), basisVector(DIM, 1)]);

      const result = await semanticDedupCandidates([c1, c2], {
        embedBatch: embed,
      });

      expect(result.candidates).toHaveLength(2);
    });
  });

  describe("threshold boundary", () => {
    it("cosine exactly at threshold (0.85) → NOT merged", async () => {
      // cos(theta) = 0.85 exactly
      // v1 = [1, 0], v2 = [0.85, sqrt(1 - 0.85^2)]
      const v1 = [1, 0, 0, 0];
      const antiSq = Math.sqrt(1 - 0.85 * 0.85);
      const v2 = [0.85, antiSq, 0, 0];
      const c1 = makeCandidate({ title: "item A" });
      const c2 = makeCandidate({ title: "item B" });
      const embed: EmbedBatchFn = vi
        .fn()
        .mockResolvedValue([v1, v2]);

      const result = await semanticDedupCandidates([c1, c2], {
        embedBatch: embed,
        threshold: 0.85,
      });

      // exactly 0.85 should NOT be merged (strictly >)
      expect(result.candidates).toHaveLength(2);
    });

    it("cosine just above threshold → merged", async () => {
      const v1 = [1, 0, 0, 0];
      // Make cosine slightly above 0.85
      const epsilon = 0.001;
      const sim = 0.85 + epsilon;
      const antiSq = Math.sqrt(1 - sim * sim);
      const v2 = [sim, antiSq, 0, 0];
      const c1 = makeCandidate({ title: "item A" });
      const c2 = makeCandidate({ title: "item B" });
      const embed: EmbedBatchFn = vi
        .fn()
        .mockResolvedValue([v1, v2]);

      const result = await semanticDedupCandidates([c1, c2], {
        embedBatch: embed,
        threshold: 0.85,
      });

      expect(result.candidates).toHaveLength(1);
    });
  });

  describe("REQ-004: engagement is summed across cluster members", () => {
    it("merged item has summed points and commentCount", async () => {
      const c1 = makeCandidate({
        title: "AI paper",
        engagement: { points: 100, commentCount: 20 },
      });
      const c2 = makeCandidate({
        title: "AI paper duplicate",
        engagement: { points: 50, commentCount: 10 },
      });
      // Same direction → merged
      const embed: EmbedBatchFn = vi
        .fn()
        .mockResolvedValue([basisVector(DIM, 0), basisVector(DIM, 0)]);

      const result = await semanticDedupCandidates([c1, c2], {
        embedBatch: embed,
      });

      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]?.engagement.points).toBe(150);
      expect(result.candidates[0]?.engagement.commentCount).toBe(30);
    });
  });

  describe("REQ-005: AUTHORITY_RANK determines representative sourceType", () => {
    it("blog selected over hn when in same cluster (AUTHORITY_RANK: blog=3 > hn=1)", async () => {
      const hn = makeCandidate({
        title: "AI news",
        sourceType: "hn",
        comments: [],
      });
      const blog = makeCandidate({
        title: "AI news blog",
        sourceType: "blog",
        comments: [],
      });
      // Same direction → merged
      const embed: EmbedBatchFn = vi
        .fn()
        .mockResolvedValue([basisVector(DIM, 0), basisVector(DIM, 0)]);

      const result = await semanticDedupCandidates([hn, blog], {
        embedBatch: embed,
      });

      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]?.sourceType).toBe("blog");
    });

    it("blog selected over reddit (AUTHORITY_RANK: blog=3 > reddit=2)", async () => {
      const reddit = makeCandidate({
        title: "AI news",
        sourceType: "reddit",
        comments: [],
      });
      const blog = makeCandidate({
        title: "AI news blog",
        sourceType: "blog",
        comments: [],
      });
      const embed: EmbedBatchFn = vi
        .fn()
        .mockResolvedValue([basisVector(DIM, 0), basisVector(DIM, 0)]);

      const result = await semanticDedupCandidates([reddit, blog], {
        embedBatch: embed,
      });

      expect(result.candidates[0]?.sourceType).toBe("blog");
    });

    it("reddit selected over hn (AUTHORITY_RANK: reddit=2 > hn=1)", async () => {
      const hn = makeCandidate({
        title: "AI news",
        sourceType: "hn",
        comments: [],
      });
      const reddit = makeCandidate({
        title: "AI news reddit",
        sourceType: "reddit",
        comments: [],
      });
      const embed: EmbedBatchFn = vi
        .fn()
        .mockResolvedValue([basisVector(DIM, 0), basisVector(DIM, 0)]);

      const result = await semanticDedupCandidates([hn, reddit], {
        embedBatch: embed,
      });

      expect(result.candidates[0]?.sourceType).toBe("reddit");
    });
  });

  describe("REQ-006: within same source type, representative is item with most comments", () => {
    it("selects item with more comments as representative", async () => {
      const c1 = makeCandidate({
        title: "AI topic",
        sourceType: "hn",
        comments: [
          { text: "comment1", author: "a" },
          { text: "comment2", author: "b" },
        ],
      });
      const c2 = makeCandidate({
        title: "AI topic copy",
        sourceType: "hn",
        comments: [{ text: "comment1", author: "a" }],
      });
      const embed: EmbedBatchFn = vi
        .fn()
        .mockResolvedValue([basisVector(DIM, 0), basisVector(DIM, 0)]);

      const result = await semanticDedupCandidates([c1, c2], {
        embedBatch: embed,
      });

      // c1 has 2 comments (more) so it's the representative
      expect(result.candidates[0]?.id).toBe(c1.id);
    });

    it("ties in comments broken by longer content", async () => {
      const c1 = makeCandidate({
        title: "AI topic",
        sourceType: "hn",
        comments: [{ text: "comment", author: "a" }],
        content: "short",
      });
      const c2 = makeCandidate({
        title: "AI topic copy",
        sourceType: "hn",
        comments: [{ text: "comment", author: "a" }],
        content: "much longer content here",
      });
      const embed: EmbedBatchFn = vi
        .fn()
        .mockResolvedValue([basisVector(DIM, 0), basisVector(DIM, 0)]);

      const result = await semanticDedupCandidates([c1, c2], {
        embedBatch: embed,
      });

      // c2 has longer content so it wins the tie
      expect(result.candidates[0]?.id).toBe(c2.id);
    });
  });

  describe("REQ-008: titleEmbeds length matches candidates length", () => {
    it("titleEmbeds has same length as output candidates (no merge)", async () => {
      const c1 = makeCandidate({ title: "item A" });
      const c2 = makeCandidate({ title: "item B" });
      const c3 = makeCandidate({ title: "item C" });
      const embed: EmbedBatchFn = vi
        .fn()
        .mockResolvedValue([
          basisVector(DIM, 0),
          basisVector(DIM, 1),
          basisVector(DIM, 2),
        ]);

      const result = await semanticDedupCandidates([c1, c2, c3], {
        embedBatch: embed,
      });

      expect(result.titleEmbeds.length).toBe(result.candidates.length);
    });

    it("titleEmbeds has same length as output candidates (with merge)", async () => {
      const c1 = makeCandidate({ title: "item A" });
      const c2 = makeCandidate({ title: "item A copy" });
      const c3 = makeCandidate({ title: "item B" });
      // c1 and c2 merged, c3 separate
      const embed: EmbedBatchFn = vi
        .fn()
        .mockResolvedValue([
          basisVector(DIM, 0), // c1
          basisVector(DIM, 0), // c2 - same direction as c1
          basisVector(DIM, 1), // c3 - different
        ]);

      const result = await semanticDedupCandidates([c1, c2, c3], {
        embedBatch: embed,
      });

      expect(result.candidates).toHaveLength(2);
      expect(result.titleEmbeds.length).toBe(2);
    });
  });

  describe("EDGE-018: equal authority and engagement → stable (index) order", () => {
    it("when two items tie on all selection criteria, lower index wins", async () => {
      const c1 = makeCandidate({
        title: "AI news",
        sourceType: "hn",
        comments: [],
        content: null,
        engagement: { points: 10, commentCount: 5 },
      });
      const c2 = makeCandidate({
        title: "AI news duplicate",
        sourceType: "hn",
        comments: [],
        content: null,
        engagement: { points: 10, commentCount: 5 },
      });
      const embed: EmbedBatchFn = vi
        .fn()
        .mockResolvedValue([basisVector(DIM, 0), basisVector(DIM, 0)]);

      const result = await semanticDedupCandidates([c1, c2], {
        embedBatch: embed,
      });

      expect(result.candidates).toHaveLength(1);
      // c1 was first (lower index), should be selected on tie
      expect(result.candidates[0]?.id).toBe(c1.id);
    });
  });

  describe("EDGE-019: embedBatch throws → stage throws", () => {
    it("propagates error when embedBatch fails", async () => {
      const c1 = makeCandidate({ title: "item" });
      const embed: EmbedBatchFn = vi
        .fn()
        .mockRejectedValue(new Error("Voyage API down"));

      await expect(
        semanticDedupCandidates([c1], { embedBatch: embed }),
      ).rejects.toThrow("Voyage API down");
    });
  });

  describe("REQ-029: logger events", () => {
    it("logs semantic-dedup.end with inputCount, outputCount, durationMs", async () => {
      const c1 = makeCandidate({ title: "item A" });
      const c2 = makeCandidate({ title: "item B" });
      const embed: EmbedBatchFn = vi
        .fn()
        .mockResolvedValue([basisVector(DIM, 0), basisVector(DIM, 1)]);

      await semanticDedupCandidates([c1, c2], { embedBatch: embed });

      const infoEvents = mockLoggerInfo.mock.calls.map((args) => args[0]);
      const endEvent = infoEvents.find(
        (e) => e && typeof e === "object" && e.event === "semantic-dedup.end",
      );
      expect(endEvent).toBeDefined();
      expect(endEvent.inputCount).toBe(2);
      expect(endEvent.outputCount).toBe(2);
      expect(typeof endEvent.durationMs).toBe("number");
    });

    it("logs semantic-dedup.end with correct counts after merge", async () => {
      const c1 = makeCandidate({ title: "item A" });
      const c2 = makeCandidate({ title: "item A dupe" });
      const embed: EmbedBatchFn = vi
        .fn()
        .mockResolvedValue([basisVector(DIM, 0), basisVector(DIM, 0)]);

      await semanticDedupCandidates([c1, c2], { embedBatch: embed });

      const infoEvents = mockLoggerInfo.mock.calls.map((args) => args[0]);
      const endEvent = infoEvents.find(
        (e) => e && typeof e === "object" && e.event === "semantic-dedup.end",
      );
      expect(endEvent.inputCount).toBe(2);
      expect(endEvent.outputCount).toBe(1);
    });

    it("logs semantic-dedup.end for empty input without calling embedBatch", async () => {
      const embed = vi.fn<EmbedBatchFn>();

      await semanticDedupCandidates([], { embedBatch: embed });

      const infoEvents = mockLoggerInfo.mock.calls.map((args) => args[0]);
      const endEvent = infoEvents.find(
        (e) => e && typeof e === "object" && e.event === "semantic-dedup.end",
      );
      expect(endEvent).toBeDefined();
      expect(endEvent.inputCount).toBe(0);
      expect(endEvent.outputCount).toBe(0);
    });
  });

  describe("custom threshold option", () => {
    it("uses provided threshold instead of default", async () => {
      const c1 = makeCandidate({ title: "item A" });
      const c2 = makeCandidate({ title: "item B" });
      // vectors with cosine = 0.9 > custom threshold of 0.5
      const sim = 0.9;
      const antiSq = Math.sqrt(1 - sim * sim);
      const v2 = [sim, antiSq, 0, 0];
      const embed: EmbedBatchFn = vi
        .fn()
        .mockResolvedValue([[1, 0, 0, 0], v2]);

      // With threshold=0.5, cosine=0.9 should cause merge
      const result = await semanticDedupCandidates([c1, c2], {
        embedBatch: embed,
        threshold: 0.5,
      });

      expect(result.candidates).toHaveLength(1);
    });
  });

  describe("titleEmbeds correspond to representative embeddings", () => {
    it("returns embedding of the representative item, not just the first item", async () => {
      // c1 has more comments → it's the representative
      const c1 = makeCandidate({
        title: "representative",
        comments: [
          { text: "c1", author: "a" },
          { text: "c2", author: "b" },
        ],
      });
      const c2 = makeCandidate({
        title: "non-representative",
        comments: [],
      });
      const repEmbed = basisVector(DIM, 0);
      // c1 is index 0, c2 is index 1; both same direction so they merge
      // representative is c1 (more comments), its embed is index 0
      const embed: EmbedBatchFn = vi
        .fn()
        .mockResolvedValue([repEmbed, repEmbed]); // same direction to force merge

      const result = await semanticDedupCandidates([c1, c2], {
        embedBatch: embed,
      });

      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]?.id).toBe(c1.id);
      expect(result.titleEmbeds[0]).toEqual(repEmbed);

    });
  });

  describe("three-way cluster", () => {
    it("merges all three items in same cluster, sums all engagements", async () => {
      const c1 = makeCandidate({
        title: "AI topic 1",
        engagement: { points: 10, commentCount: 2 },
      });
      const c2 = makeCandidate({
        title: "AI topic 2",
        engagement: { points: 20, commentCount: 3 },
      });
      const c3 = makeCandidate({
        title: "AI topic 3",
        engagement: { points: 30, commentCount: 5 },
      });
      // All same direction → all merged
      const embed: EmbedBatchFn = vi
        .fn()
        .mockResolvedValue([
          basisVector(DIM, 0),
          basisVector(DIM, 0),
          basisVector(DIM, 0),
        ]);

      const result = await semanticDedupCandidates([c1, c2, c3], {
        embedBatch: embed,
      });

      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]?.engagement.points).toBe(60);
      expect(result.candidates[0]?.engagement.commentCount).toBe(10);
    });
  });
});
