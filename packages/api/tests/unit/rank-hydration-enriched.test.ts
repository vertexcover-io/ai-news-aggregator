import { describe, it, expect, vi } from "vitest";
import type { RankedItemRef } from "@newsletter/shared";
import { ENRICHED_SUMMARY_LAUNCHED_AT } from "@newsletter/shared/constants";
import { hydrateRankedItems } from "@api/services/rank-hydration.js";
import type {
  RawItemRow,
  RawItemsRepo,
} from "@api/repositories/raw-items.js";

function makeRepo(rows: RawItemRow[]): RawItemsRepo {
  return {
    findByIds: vi.fn(() => Promise.resolve(rows)),
  };
}

const BASE_ROW: Omit<RawItemRow, "id" | "metadata"> = {
  sourceType: "hn",
  title: "Some Story",
  url: "https://news.ycombinator.com/item?id=1",
  author: null,
  publishedAt: null,
  engagement: { points: 100, commentCount: 10 },
  content: "Native content text",
  imageUrl: null,
};

const BASE_REF: RankedItemRef = { rawItemId: 1, score: 0.9, rationale: "good" };

describe("hydrateRankedItems — enrichedSource (Phase 3, REQ-014, REQ-015)", () => {
  it("VS-6-equivalent: enriched item gets enrichedSource populated", async () => {
    const repo = makeRepo([
      {
        ...BASE_ROW,
        id: 1,
        metadata: {
          comments: [],
          enrichedLink: {
            url: "https://www.theverge.com/2026/article",
            fetchedAt: "2026-05-25T00:00:00Z",
            status: "ok",
            markdown: "## Article content\n\nFull enriched markdown here.",
          },
        },
      },
    ]);
    const result = await hydrateRankedItems(repo, [BASE_REF], null);
    expect(result[0].enrichedSource).toEqual({
      hostname: "theverge.com",
      url: "https://www.theverge.com/2026/article",
    });
  });

  it("VS-7: native item (no enrichedLink) gets enrichedSource: null", async () => {
    const repo = makeRepo([
      {
        ...BASE_ROW,
        id: 1,
        metadata: { comments: [] },
      },
    ]);
    const result = await hydrateRankedItems(repo, [BASE_REF], null);
    expect(result[0].enrichedSource).toBeNull();
  });

  // The non-ok / empty-markdown / malformed-url / www-strip branches of
  // enrichedSource derivation are unit-tested directly against the pure helper
  // `resolveEnrichedSource` in services/rank-hydration-helpers.test.ts. Here we
  // keep only the hydration-level concerns: the populated/native cases above and
  // the launch-date gate below.

  it("VS-8: legacy archive (archiveCompletedAt < ENRICHED_SUMMARY_LAUNCHED_AT) forces all enrichedSource to null", async () => {
    const legacyDate = new Date(ENRICHED_SUMMARY_LAUNCHED_AT.getTime() - 24 * 60 * 60 * 1000); // 1 day before launch
    const repo = makeRepo([
      {
        ...BASE_ROW,
        id: 1,
        metadata: {
          comments: [],
          enrichedLink: {
            url: "https://theverge.com/article",
            fetchedAt: "2026-05-24T00:00:00Z",
            status: "ok",
            markdown: "Great enriched content here",
          },
        },
      },
    ]);
    const result = await hydrateRankedItems(repo, [BASE_REF], legacyDate);
    expect(result[0].enrichedSource).toBeNull();
  });

  it("archive on exactly ENRICHED_SUMMARY_LAUNCHED_AT is NOT gated (gate is strictly less-than)", async () => {
    const repo = makeRepo([
      {
        ...BASE_ROW,
        id: 1,
        metadata: {
          comments: [],
          enrichedLink: {
            url: "https://theverge.com/article",
            fetchedAt: "2026-05-25T00:00:00Z",
            status: "ok",
            markdown: "Great enriched content here",
          },
        },
      },
    ]);
    const result = await hydrateRankedItems(repo, [BASE_REF], ENRICHED_SUMMARY_LAUNCHED_AT);
    expect(result[0].enrichedSource).toEqual({
      hostname: "theverge.com",
      url: "https://theverge.com/article",
    });
  });

  it("archiveCompletedAt === null skips the gate (live /run use case)", async () => {
    const repo = makeRepo([
      {
        ...BASE_ROW,
        id: 1,
        metadata: {
          comments: [],
          enrichedLink: {
            url: "https://arxiv.org/abs/2401.0001",
            fetchedAt: "2026-05-25T00:00:00Z",
            status: "ok",
            markdown: "Enriched paper content",
          },
        },
      },
    ]);
    const result = await hydrateRankedItems(repo, [BASE_REF], null);
    expect(result[0].enrichedSource).toEqual({
      hostname: "arxiv.org",
      url: "https://arxiv.org/abs/2401.0001",
    });
  });

  it("legacy gate applies to all items in the batch — not just first", async () => {
    const legacyDate = new Date(ENRICHED_SUMMARY_LAUNCHED_AT.getTime() - 1);
    const repo = makeRepo([
      {
        ...BASE_ROW,
        id: 1,
        metadata: {
          comments: [],
          enrichedLink: {
            url: "https://theverge.com/a",
            fetchedAt: "2026-05-24T00:00:00Z",
            status: "ok",
            markdown: "Content A",
          },
        },
      },
      {
        ...BASE_ROW,
        id: 2,
        metadata: {
          comments: [],
          enrichedLink: {
            url: "https://wired.com/b",
            fetchedAt: "2026-05-24T00:00:00Z",
            status: "ok",
            markdown: "Content B",
          },
        },
      },
    ]);
    const refs: RankedItemRef[] = [
      { rawItemId: 1, score: 0.9, rationale: "a" },
      { rawItemId: 2, score: 0.8, rationale: "b" },
    ];
    const result = await hydrateRankedItems(repo, refs, legacyDate);
    expect(result[0].enrichedSource).toBeNull();
    expect(result[1].enrichedSource).toBeNull();
  });
});
