import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RankedItemRef } from "@newsletter/shared";

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

vi.mock("@pipeline/services/embeddings.js", () => ({
  cosineSimilarity: vi.fn((a: number[], b: number[]) => {
    // Real cosine similarity for deterministic tests
    const len = Math.min(a.length, b.length);
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < len; i++) {
      dot += (a[i] ?? 0) * (b[i] ?? 0);
      normA += (a[i] ?? 0) * (a[i] ?? 0);
      normB += (b[i] ?? 0) * (b[i] ?? 0);
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }),
}));

import { mmrSelect, jaccardBigram, MMR_LAMBDA, SOURCE_CAP } from "@pipeline/processors/mmr.js";
import type { MmrItem } from "@pipeline/processors/mmr.js";

function makeRef(rawItemId: number, score: number): RankedItemRef {
  return { rawItemId, score, rationale: "test" };
}

function makeItem(overrides: Partial<MmrItem> & { score?: number; rawItemId?: number } = {}): MmrItem {
  const rawItemId = overrides.rawItemId ?? 1;
  const score = overrides.score ?? 0.5;
  return {
    ref: makeRef(rawItemId, score),
    title: overrides.title ?? `Item ${rawItemId}`,
    sourceType: overrides.sourceType ?? "hn",
  };
}

beforeEach(() => {
  mockLoggerInfo.mockReset();
});

describe("mmrSelect", () => {
  describe("REQ-022: MMR greedy selection", () => {
    it("first selected item is always the highest fusion score", () => {
      const items: MmrItem[] = [
        makeItem({ rawItemId: 1, score: 0.5, title: "item one", sourceType: "hn" }),
        makeItem({ rawItemId: 2, score: 0.9, title: "item two", sourceType: "reddit" }),
        makeItem({ rawItemId: 3, score: 0.3, title: "item three", sourceType: "blog" }),
      ];
      const result = mmrSelect(items, { topN: 3 });
      expect(result[0]?.rawItemId).toBe(2);
    });

    it("second item maximizes 0.7*score - 0.3*maxSim(item, selected) using Jaccard", () => {
      // Item A: score=0.8, title="alpha beta" (similar to item B)
      // Item B: score=0.7, title="alpha beta gamma" (similar to A)
      // Item C: score=0.5, title="completely different xyz"
      // First selected: A (highest score)
      // For second slot:
      //   B: 0.7*0.7 - 0.3*jaccard("alpha beta gamma", "alpha beta")
      //   C: 0.7*0.5 - 0.3*jaccard("completely different xyz", "alpha beta")
      // jaccard("alpha beta gamma", "alpha beta") is high (shared tokens)
      // jaccard("completely different xyz", "alpha beta") is 0 (no shared tokens)
      // So C should beat B for second slot despite lower raw score
      const items: MmrItem[] = [
        makeItem({ rawItemId: 1, score: 0.8, title: "alpha beta", sourceType: "hn" }),
        makeItem({ rawItemId: 2, score: 0.7, title: "alpha beta gamma", sourceType: "reddit" }),
        makeItem({ rawItemId: 3, score: 0.5, title: "completely different xyz", sourceType: "blog" }),
      ];
      const result = mmrSelect(items, { topN: 3 });
      expect(result[0]?.rawItemId).toBe(1);
      // C has higher MMR score than B for second slot (zero sim vs high sim)
      expect(result[1]?.rawItemId).toBe(3);
      expect(result[2]?.rawItemId).toBe(2);
    });
  });

  describe("REQ-023: cosine similarity used when titleEmbeds provided", () => {
    it("uses cosine similarity between title embeddings for item-to-item similarity", () => {
      // Item 1: score=0.8, embed=[1,0,0] (basis 0)
      // Item 2: score=0.7, embed=[1,0,0] (same direction → high cosine sim)
      // Item 3: score=0.5, embed=[0,0,1] (orthogonal → zero cosine sim)
      // After selecting item 1, MMR for slot 2:
      //   Item 2: 0.7*0.7 - 0.3*1.0 = 0.49-0.30 = 0.19
      //   Item 3: 0.7*0.5 - 0.3*0.0 = 0.35-0.00 = 0.35 → wins
      const items: MmrItem[] = [
        makeItem({ rawItemId: 1, score: 0.8, title: "a", sourceType: "hn" }),
        makeItem({ rawItemId: 2, score: 0.7, title: "b", sourceType: "reddit" }),
        makeItem({ rawItemId: 3, score: 0.5, title: "c", sourceType: "blog" }),
      ];
      const titleEmbeds = [
        [1, 0, 0],
        [1, 0, 0],
        [0, 0, 1],
      ];
      const result = mmrSelect(items, { topN: 3, titleEmbeds });
      expect(result[0]?.rawItemId).toBe(1);
      expect(result[1]?.rawItemId).toBe(3);
      expect(result[2]?.rawItemId).toBe(2);
    });
  });

  describe("REQ-024: jaccardBigram used when titleEmbeds absent", () => {
    it("falls back to Jaccard when no titleEmbeds provided", () => {
      // Same structure as cosine test but no embeds
      // Item 1: score=0.8, title="foo bar" → selected first
      // Item 2: score=0.7, title="foo bar baz" → high Jaccard with item 1
      // Item 3: score=0.5, title="xyz qrs" → zero Jaccard with item 1
      const items: MmrItem[] = [
        makeItem({ rawItemId: 1, score: 0.8, title: "foo bar", sourceType: "hn" }),
        makeItem({ rawItemId: 2, score: 0.7, title: "foo bar baz", sourceType: "reddit" }),
        makeItem({ rawItemId: 3, score: 0.5, title: "xyz qrs", sourceType: "blog" }),
      ];
      const result = mmrSelect(items, { topN: 3 });
      expect(result[0]?.rawItemId).toBe(1);
      // Item 3 has zero similarity to item 1, so its MMR score = 0.7*0.5 = 0.35
      // Item 2 shares tokens, lower MMR score for second slot
      expect(result[1]?.rawItemId).toBe(3);
    });
  });

  describe("REQ-025: source cap enforcement", () => {
    it("no sourceType appears more than 3 times in output", () => {
      const items = Array.from({ length: 10 }, (_, i) =>
        makeItem({ rawItemId: i + 1, score: 0.9 - i * 0.05, title: `item ${i}`, sourceType: "hn" }),
      );
      const result = mmrSelect(items, { topN: 10 });
      const hnCount = result.filter((r) => {
        const item = items.find((it) => it.ref.rawItemId === r.rawItemId);
        return item?.sourceType === "hn";
      }).length;
      expect(hnCount).toBeLessThanOrEqual(SOURCE_CAP);
    });

    it("mixed sources — each source is capped at SOURCE_CAP", () => {
      const items: MmrItem[] = [
        ...Array.from({ length: 5 }, (_, i) =>
          makeItem({ rawItemId: i + 1, score: 0.9 - i * 0.01, title: `hn ${i}`, sourceType: "hn" }),
        ),
        ...Array.from({ length: 5 }, (_, i) =>
          makeItem({ rawItemId: i + 10, score: 0.85 - i * 0.01, title: `reddit ${i}`, sourceType: "reddit" }),
        ),
      ];
      const result = mmrSelect(items, { topN: 10 });
      const sourceCounts: Record<string, number> = {};
      for (const ref of result) {
        const item = items.find((it) => it.ref.rawItemId === ref.rawItemId);
        const src = item?.sourceType ?? "unknown";
        sourceCounts[src] = (sourceCounts[src] ?? 0) + 1;
      }
      for (const count of Object.values(sourceCounts)) {
        expect(count).toBeLessThanOrEqual(SOURCE_CAP);
      }
    });
  });

  describe("EDGE cases", () => {
    it("EDGE-013: fewer candidates than topN → shorter output, no padding", () => {
      const items: MmrItem[] = [
        makeItem({ rawItemId: 1, score: 0.9, title: "a", sourceType: "hn" }),
        makeItem({ rawItemId: 2, score: 0.7, title: "b", sourceType: "reddit" }),
      ];
      const result = mmrSelect(items, { topN: 10 });
      expect(result.length).toBe(2);
    });

    it("EDGE-014: all-HN input with topN=10 → at most 3 items returned", () => {
      const items = Array.from({ length: 8 }, (_, i) =>
        makeItem({ rawItemId: i + 1, score: 0.9 - i * 0.05, title: `hn story ${i}`, sourceType: "hn" }),
      );
      const result = mmrSelect(items, { topN: 10 });
      expect(result.length).toBe(SOURCE_CAP);
    });

    it("EDGE-016: single candidate → returned as-is", () => {
      const items: MmrItem[] = [
        makeItem({ rawItemId: 42, score: 0.6, title: "only one", sourceType: "blog" }),
      ];
      const result = mmrSelect(items, { topN: 5 });
      expect(result.length).toBe(1);
      expect(result[0]?.rawItemId).toBe(42);
    });

    it("EDGE-018: equal fusion scores → stable (index) order", () => {
      const items: MmrItem[] = [
        makeItem({ rawItemId: 10, score: 0.5, title: "apple mango", sourceType: "hn" }),
        makeItem({ rawItemId: 20, score: 0.5, title: "different unrelated xyz", sourceType: "reddit" }),
        makeItem({ rawItemId: 30, score: 0.5, title: "unique content abc", sourceType: "blog" }),
      ];
      const result = mmrSelect(items, { topN: 3 });
      // All equal scores and zero similarity between them — should be in original index order
      expect(result.map((r) => r.rawItemId)).toEqual([10, 20, 30]);
    });

    it("empty input → empty output", () => {
      const result = mmrSelect([], { topN: 5 });
      expect(result).toEqual([]);
    });

    it("titleEmbeds length mismatch → falls back to Jaccard", () => {
      const items: MmrItem[] = [
        makeItem({ rawItemId: 1, score: 0.8, title: "foo bar", sourceType: "hn" }),
        makeItem({ rawItemId: 2, score: 0.5, title: "baz qux", sourceType: "reddit" }),
      ];
      // Provide wrong number of embeddings — should fall back to Jaccard
      const titleEmbeds = [[1, 0, 0]]; // only 1 embed for 2 items
      const result = mmrSelect(items, { topN: 2, titleEmbeds });
      expect(result.length).toBe(2);
      expect(result[0]?.rawItemId).toBe(1);
    });
  });

  describe("REQ-029: logger", () => {
    it("logs mmr.end with inputCount, outputCount, durationMs", () => {
      const items: MmrItem[] = [
        makeItem({ rawItemId: 1, score: 0.9, title: "a", sourceType: "hn" }),
        makeItem({ rawItemId: 2, score: 0.7, title: "b", sourceType: "reddit" }),
      ];
      mmrSelect(items, { topN: 2, runId: "run-123" });

      const calls = mockLoggerInfo.mock.calls.map((args) => args[0]);
      const endEvent = calls.find(
        (e) => e && typeof e === "object" && e.event === "mmr.end",
      );
      expect(endEvent).toBeDefined();
      expect(endEvent.inputCount).toBe(2);
      expect(endEvent.outputCount).toBe(2);
      expect(typeof endEvent.durationMs).toBe("number");
    });

    it("logs mmr.end with zero counts on empty input", () => {
      mmrSelect([], { topN: 5 });

      const calls = mockLoggerInfo.mock.calls.map((args) => args[0]);
      const endEvent = calls.find(
        (e) => e && typeof e === "object" && e.event === "mmr.end",
      );
      expect(endEvent).toBeDefined();
      expect(endEvent.inputCount).toBe(0);
      expect(endEvent.outputCount).toBe(0);
    });
  });

  describe("MMR_LAMBDA and SOURCE_CAP constants", () => {
    it("MMR_LAMBDA is 0.7", () => {
      expect(MMR_LAMBDA).toBe(0.7);
    });

    it("SOURCE_CAP is 3", () => {
      expect(SOURCE_CAP).toBe(3);
    });
  });
});

describe("jaccardBigram", () => {
  it("identical strings → 1.0", () => {
    expect(jaccardBigram("hello world", "hello world")).toBe(1.0);
  });

  it("completely disjoint strings → 0.0", () => {
    expect(jaccardBigram("alpha beta", "gamma delta")).toBe(0.0);
  });

  it("partial overlap → between 0 and 1", () => {
    const sim = jaccardBigram("alpha beta gamma", "alpha beta delta");
    expect(sim).toBeGreaterThan(0);
    expect(sim).toBeLessThan(1);
  });

  it("empty strings → 0.0 (no tokens → union=0)", () => {
    expect(jaccardBigram("", "")).toBe(0.0);
  });

  it("one empty, one non-empty → 0.0", () => {
    expect(jaccardBigram("hello world", "")).toBe(0.0);
  });

  it("single word identical → 1.0 (only unigrams, no bigrams)", () => {
    expect(jaccardBigram("hello", "hello")).toBe(1.0);
  });

  it("is case insensitive", () => {
    expect(jaccardBigram("Hello World", "hello world")).toBe(1.0);
  });

  it("ignores non-alphanumeric characters", () => {
    expect(jaccardBigram("hello, world!", "hello world")).toBe(1.0);
  });

  it("bigrams contribute to similarity: 'a b c' vs 'a b d' shares a,b,a_b tokens", () => {
    // "a b c" → tokens: a, b, c, a_b, b_c
    // "a b d" → tokens: a, b, d, a_b, b_d
    // intersection: {a, b, a_b} = 3
    // union: {a, b, c, a_b, b_c, d, b_d} = 7
    const sim = jaccardBigram("a b c", "a b d");
    expect(sim).toBeCloseTo(3 / 7, 10);
  });
});
