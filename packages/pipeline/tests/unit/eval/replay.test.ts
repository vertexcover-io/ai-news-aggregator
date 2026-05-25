import { describe, expect, it } from "vitest";

import type { EnrichedLinkContent } from "@newsletter/shared";
import type {
  Fixture,
  FixtureItem,
} from "@newsletter/shared/types/eval-ranking";

import { fixtureToCandidates } from "@pipeline/eval/replay.js";

function makeItem(
  id: number,
  overrides: Partial<FixtureItem> = {},
): FixtureItem {
  return {
    rawItemId: id,
    title: `Item ${id}`,
    url: `https://example.com/${id}`,
    sourceType: "hn",
    publishedAt: null,
    content: null,
    enrichedLink: null,
    enrichmentStatus: "ok",
    comments: [],
    engagement: null,
    ...overrides,
  };
}

function makeFixture(overrides: Partial<Fixture> = {}): Fixture {
  return {
    fixtureId: "fix-1",
    source: "manual",
    date: null,
    runId: null,
    model: "claude-haiku-4-5",
    exportedAt: "2026-05-22T00:00:00.000Z",
    pool: [],
    dedupClusters: [],
    originalRankerOutput: null,
    ...overrides,
  };
}

describe("fixtureToCandidates", () => {
  it("defaults engagement to zero when null (manual fixtures)", () => {
    const fixture = makeFixture({ pool: [makeItem(1)] });
    const candidates = fixtureToCandidates(fixture);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].engagement).toEqual({ points: 0, commentCount: 0 });
  });

  it("preserves engagement when provided", () => {
    const fixture = makeFixture({
      pool: [makeItem(1, { engagement: { points: 42, commentCount: 7 } })],
    });
    const candidates = fixtureToCandidates(fixture);
    expect(candidates[0].engagement).toEqual({ points: 42, commentCount: 7 });
  });

  it("excludes dedup duplicates, keeps representatives", () => {
    const fixture = makeFixture({
      pool: [makeItem(1), makeItem(2), makeItem(3)],
      dedupClusters: [{ representativeId: 1, duplicateIds: [2] }],
    });
    const ids = fixtureToCandidates(fixture).map((c) => c.id);
    expect(ids).toEqual([1, 3]);
  });

  it("preserves input order of pool", () => {
    const fixture = makeFixture({
      pool: [makeItem(7), makeItem(2), makeItem(5)],
    });
    const ids = fixtureToCandidates(fixture).map((c) => c.id);
    expect(ids).toEqual([7, 2, 5]);
  });

  it("converts publishedAt string to Date", () => {
    const fixture = makeFixture({
      pool: [makeItem(1, { publishedAt: "2026-05-22T00:00:00.000Z" })],
    });
    const c = fixtureToCandidates(fixture)[0];
    expect(c.publishedAt).toBeInstanceOf(Date);
    expect(c.publishedAt?.toISOString()).toBe("2026-05-22T00:00:00.000Z");
  });

  it("uses enrichedLink.markdown as candidate.content when item.content is null", () => {
    const enrichedLink: EnrichedLinkContent = {
      url: "https://example.com/1",
      fetchedAt: "2026-05-22T00:00:00.000Z",
      status: "ok",
      markdown: "## Enriched body — used at rank time so no live fetch fires",
    };
    const fixture = makeFixture({
      pool: [makeItem(1, { content: null, enrichedLink })],
    });
    const c = fixtureToCandidates(fixture)[0];
    expect(c.content).toBe(
      "## Enriched body — used at rank time so no live fetch fires",
    );
  });

  it("enrichedLink.markdown wins over item.content when both present (REQ-001 priority flip)", () => {
    const enrichedLink: EnrichedLinkContent = {
      url: "https://example.com/1",
      fetchedAt: "2026-05-22T00:00:00.000Z",
      status: "ok",
      markdown: "FROM ENRICHED",
    };
    const fixture = makeFixture({
      pool: [makeItem(1, { content: "FROM CONTENT", enrichedLink })],
    });
    const c = fixtureToCandidates(fixture)[0];
    expect(c.content).toBe("FROM ENRICHED");
  });

  it("falls through to null when enrichment failed and content is null", () => {
    const enrichedLink: EnrichedLinkContent = {
      url: "https://example.com/1",
      fetchedAt: "2026-05-22T00:00:00.000Z",
      status: "failed",
      failureReason: "timeout",
    };
    const fixture = makeFixture({
      pool: [makeItem(1, { content: null, enrichedLink })],
    });
    const c = fixtureToCandidates(fixture)[0];
    expect(c.content).toBeNull();
  });
});
