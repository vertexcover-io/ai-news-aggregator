import { describe, expect, it } from "vitest";
import {
  classifyItemLifecycle,
  orderSourceItems,
  summarizeSourceItems,
  type ClassifyItemLifecycleInput,
} from "@shared/services/index.js";
import type {
  EnrichedLinkContent,
  RunSourceItem,
  RunSourceItemsResponse,
  RunSourceItemsSummary,
} from "@shared/types/index.js";

const okEnriched: EnrichedLinkContent = {
  url: "https://example.com/story",
  fetchedAt: "2026-05-27T00:00:00.000Z",
  status: "ok",
  markdown: "Story body",
};

const failedEnriched: EnrichedLinkContent = {
  url: "https://example.com/failed",
  fetchedAt: "2026-05-27T00:00:00.000Z",
  status: "failed",
  failureReason: "timeout",
};

const skippedEnriched: EnrichedLinkContent = {
  url: "https://news.ycombinator.com/item?id=1",
  fetchedAt: "2026-05-27T00:00:00.000Z",
  status: "skipped",
  skipReason: "same-platform",
};

function makeInput(
  overrides: Partial<ClassifyItemLifecycleInput> = {},
): ClassifyItemLifecycleInput {
  return {
    id: 1,
    title: "Default story",
    url: "https://example.com/default",
    author: "author",
    engagement: { points: 10, commentCount: 2 },
    publishedAt: "2026-05-27T01:00:00.000Z",
    sourceIdentifier: "example.com",
    enrichedLink: okEnriched,
    dedup: { status: "survived", winnerTitle: null, winnerId: null, winnerPoints: null },
    shortlistedIds: [],
    rankByItemId: new Map(),
    live: false,
    ...overrides,
  };
}

function classify(
  overrides: Partial<ClassifyItemLifecycleInput> = {},
): RunSourceItem {
  return classifyItemLifecycle(makeInput(overrides));
}

describe("classifyItemLifecycle (REQ-008)", () => {
  it("classifies ranked items first and keeps dropReason null (REQ-006, EDGE-003)", () => {
    const ranked = classify({
      id: 42,
      title: "Ranked despite missing pool",
      dedup: null,
      shortlistedIds: null,
      rankByItemId: new Map([[42, 2]]),
    });

    expect(ranked.furthestStage).toBe("ranked");
    expect(ranked.lifecycle.rank).toBe(2);
    expect(ranked.lifecycle.shortlisted).toBeNull();
    expect(ranked.lifecycle.dedup).toBeNull();
    expect(ranked.dropReason).toBeNull();
  });

  it("classifies shortlisted items ahead of dedup/enrich outcomes", () => {
    const shortlisted = classify({
      id: 9,
      enrichedLink: failedEnriched,
      dedup: { status: "dropped", winnerTitle: "Winner", winnerId: 8, winnerPoints: 50 },
      shortlistedIds: [9],
    });

    expect(shortlisted.furthestStage).toBe("shortlisted");
    expect(shortlisted.lifecycle.shortlisted).toBe(true);
    expect(shortlisted.lifecycle.enrich).toEqual({ status: "failed", reason: "timeout" });
    expect(shortlisted.dropReason).toBeNull();
  });

  it("classifies multiple dedup survivors without drop reasons", () => {
    const survivedWithEnrich = classify({ id: 1, shortlistedIds: [4, 5] });
    const survivedWithoutEnrich = classify({
      id: 2,
      enrichedLink: undefined,
      dedup: { status: "survived", winnerTitle: null, winnerId: null, winnerPoints: null },
    });

    expect(survivedWithEnrich.furthestStage).toBe("deduped-survivor");
    expect(survivedWithEnrich.dropReason).toBeNull();
    expect(survivedWithoutEnrich.lifecycle.enrich).toEqual({ status: "none", reason: null });
    expect(survivedWithoutEnrich.furthestStage).toBe("deduped-survivor");
  });

  it("classifies dedup drops with winner attribution and point comparison when winner points are known", () => {
    const dropped = classify({
      id: 3,
      title: "Duplicate",
      engagement: { points: 12, commentCount: 4 },
      dedup: {
        status: "dropped",
        winnerTitle: "Original winner",
        winnerId: 1,
        winnerPoints: 84,
      },
    });

    expect(dropped.furthestStage).toBe("dedup-dropped");
    expect(dropped.lifecycle.dedup).toEqual({
      status: "dropped",
      winnerTitle: "Original winner",
      winnerId: 1,
      winnerPoints: 84,
    });
    expect(dropped.dropReason).toBe(
      'dedup-dropped · duplicate URL, lost to "Original winner" (84 vs 12 pts)',
    );
  });

  it("classifies covered-link style dedup drops without crashing when winner title is unknown (EDGE-010)", () => {
    const dropped = classify({
      id: 4,
      dedup: { status: "dropped", winnerTitle: null, winnerId: null, winnerPoints: null },
    });

    expect(dropped.furthestStage).toBe("dedup-dropped");
    expect(dropped.dropReason).toBe("dedup-dropped · duplicate URL");
  });

  it("classifies enrich failures only when not shortlisted", () => {
    const failed = classify({
      id: 5,
      enrichedLink: failedEnriched,
      dedup: null,
      shortlistedIds: [],
    });

    expect(failed.furthestStage).toBe("enrich-failed");
    expect(failed.lifecycle.enrich).toEqual({ status: "failed", reason: "timeout" });
    expect(failed.dropReason).toBe(
      "enrich-failed: timeout · not shortlisted (title-only signal)",
    );
  });

  it("classifies enrich skips as fetched with an informational not-shortlisted reason (EDGE-004)", () => {
    const skipped = classify({
      id: 6,
      enrichedLink: skippedEnriched,
      dedup: null,
      shortlistedIds: [],
    });

    expect(skipped.furthestStage).toBe("fetched");
    expect(skipped.lifecycle.enrich).toEqual({ status: "skipped", reason: "same-platform" });
    expect(skipped.dropReason).toBe("enrich-skipped: same-platform · not shortlisted");
  });

  it("preserves legacy null shortlist state without emitting not-shortlisted reasons (EDGE-001)", () => {
    const legacyFailed = classify({
      id: 7,
      enrichedLink: failedEnriched,
      dedup: null,
      shortlistedIds: null,
    });
    const legacySkipped = classify({
      id: 8,
      enrichedLink: skippedEnriched,
      dedup: null,
      shortlistedIds: null,
    });

    expect(legacyFailed.lifecycle.shortlisted).toBeNull();
    expect(legacyFailed.furthestStage).toBe("enrich-failed");
    expect(legacyFailed.dropReason).toBeNull();
    expect(legacySkipped.lifecycle.shortlisted).toBeNull();
    expect(legacySkipped.furthestStage).toBe("fetched");
    expect(legacySkipped.dropReason).toBeNull();
  });

  it("leaves live unknown stages null for Phase 4 pending rendering (REQ-013)", () => {
    const live = classify({
      id: 11,
      enrichedLink: undefined,
      dedup: null,
      shortlistedIds: null,
      rankByItemId: new Map(),
      live: true,
    });

    expect(live.lifecycle.dedup).toBeNull();
    expect(live.lifecycle.shortlisted).toBeNull();
    expect(live.lifecycle.rank).toBeNull();
    expect(live.furthestStage).toBe("fetched");
    expect(live.dropReason).toBeNull();
  });
});

describe("orderSourceItems (REQ-006)", () => {
  it("orders by lifecycle bucket, ranked rank ascending, then preserves input order within equal buckets", () => {
    const survivor = classify({ id: 1, title: "Survivor" });
    const rankedTwo = classify({ id: 2, title: "Rank two", rankByItemId: new Map([[2, 2]]) });
    const failed = classify({ id: 3, title: "Failed", enrichedLink: failedEnriched, dedup: null });
    const shortlisted = classify({ id: 4, title: "Shortlisted", shortlistedIds: [4] });
    const rankedOne = classify({ id: 5, title: "Rank one", rankByItemId: new Map([[5, 1]]) });
    const dropped = classify({
      id: 6,
      title: "Dropped",
      dedup: { status: "dropped", winnerTitle: "Survivor", winnerId: 1, winnerPoints: 10 },
    });
    const fetched = classify({ id: 7, title: "Fetched", enrichedLink: undefined, dedup: null });

    const ordered = orderSourceItems([
      survivor,
      rankedTwo,
      failed,
      shortlisted,
      rankedOne,
      dropped,
      fetched,
    ]);

    expect(ordered.map((item) => item.id)).toEqual([5, 2, 4, 1, 6, 3, 7]);
  });
});

describe("summarizeSourceItems (REQ-004)", () => {
  it("counts ranked, shortlisted-only, dedup survivors, dedup drops, and enrich failures", () => {
    const items = [
      classify({ id: 1, rankByItemId: new Map([[1, 1]]) }),
      classify({ id: 2, shortlistedIds: [2] }),
      classify({ id: 3 }),
      classify({
        id: 4,
        enrichedLink: undefined,
        dedup: { status: "survived", winnerTitle: null, winnerId: null, winnerPoints: null },
      }),
      classify({
        id: 5,
        dedup: { status: "dropped", winnerTitle: "Winner", winnerId: 3, winnerPoints: 20 },
      }),
      classify({ id: 6, enrichedLink: failedEnriched, dedup: null }),
      classify({ id: 7, enrichedLink: skippedEnriched, dedup: null }),
    ];

    const summary = summarizeSourceItems(items);

    expect(summary).toEqual({
      ranked: 1,
      shortlisted: 1,
      dedupedSurvivors: 2,
      dedupDropped: 1,
      enrichFailed: 1,
    } satisfies RunSourceItemsSummary);
  });
});

describe("RunSourceItemsResponse type (REQ-014)", () => {
  it("constructs the lean response without markdown, recap, or cost fields", () => {
    const item = classify({ id: 1 });
    const response: RunSourceItemsResponse = {
      runId: "11111111-1111-1111-1111-111111111111",
      sourceKey: "blog:example.com",
      live: false,
      summary: summarizeSourceItems([item]),
      items: [item],
      logs: [],
    };

    expect(response.items[0]?.title).toBe("Default story");
    expect(Object.keys(response.items[0] ?? {})).not.toContain("markdown");
    expect(Object.keys(response.items[0] ?? {})).not.toContain("recap");
    expect(Object.keys(response)).not.toContain("cost");
  });
});
