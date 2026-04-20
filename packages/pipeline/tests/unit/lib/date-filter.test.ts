import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { filterBySinceDays } from "@pipeline/lib/date-filter";
import type { RawItemInsert } from "@newsletter/shared/db";

const BASE_NOW = new Date("2026-04-20T12:00:00Z").getTime();

function makeItem(overrides: Partial<RawItemInsert> = {}): RawItemInsert {
  return {
    sourceType: "hn",
    externalId: "test-id",
    title: "Test title",
    url: "https://example.com",
    author: null,
    content: null,
    publishedAt: null,
    collectedAt: new Date(BASE_NOW),
    engagement: { points: 0, commentCount: 0 },
    metadata: { comments: [] },
    updatedAt: new Date(BASE_NOW),
    ...overrides,
  };
}

describe("filterBySinceDays", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps items with null publishedAt regardless of cutoff", () => {
    const items = [makeItem({ publishedAt: null })];

    const result = filterBySinceDays(items, 1, "test");

    expect(result).toHaveLength(1);
    expect(result[0]).toBe(items[0]);
  });

  it("keeps items with publishedAt after the cutoff", () => {
    // 12 hours ago — within 1 day window
    const publishedAt = new Date(BASE_NOW - 12 * 60 * 60 * 1000);
    const items = [makeItem({ publishedAt })];

    const result = filterBySinceDays(items, 1, "test");

    expect(result).toHaveLength(1);
  });

  it("drops items with publishedAt before the cutoff", () => {
    // 2 days ago — outside 1 day window
    const publishedAt = new Date(BASE_NOW - 2 * 24 * 60 * 60 * 1000);
    const items = [makeItem({ publishedAt })];

    const result = filterBySinceDays(items, 1, "test");

    expect(result).toHaveLength(0);
  });

  it("returns all items when none are older than cutoff", () => {
    const items = [
      makeItem({ publishedAt: new Date(BASE_NOW - 6 * 60 * 60 * 1000) }),
      makeItem({ externalId: "2", publishedAt: new Date(BASE_NOW - 12 * 60 * 60 * 1000) }),
      makeItem({ externalId: "3", publishedAt: new Date(BASE_NOW - 18 * 60 * 60 * 1000) }),
    ];

    const result = filterBySinceDays(items, 1, "test");

    expect(result).toHaveLength(3);
  });

  it("returns empty array when all items are older than cutoff", () => {
    const items = [
      makeItem({ publishedAt: new Date(BASE_NOW - 2 * 24 * 60 * 60 * 1000) }),
      makeItem({ externalId: "2", publishedAt: new Date(BASE_NOW - 3 * 24 * 60 * 60 * 1000) }),
    ];

    const result = filterBySinceDays(items, 1, "test");

    expect(result).toHaveLength(0);
  });

  it("returns unchanged empty array when input is empty", () => {
    const result = filterBySinceDays([], 7, "test");

    expect(result).toEqual([]);
  });

  it("keeps items with publishedAt exactly at the cutoff boundary", () => {
    // Exactly 1 day ago (equal to cutoff)
    const publishedAt = new Date(BASE_NOW - 1 * 24 * 60 * 60 * 1000);
    const items = [makeItem({ publishedAt })];

    const result = filterBySinceDays(items, 1, "test");

    expect(result).toHaveLength(1);
  });

  it("mixes null publishedAt items (kept) with old items (dropped)", () => {
    const items = [
      makeItem({ externalId: "1", publishedAt: null }),
      makeItem({ externalId: "2", publishedAt: new Date(BASE_NOW - 5 * 24 * 60 * 60 * 1000) }),
      makeItem({ externalId: "3", publishedAt: new Date(BASE_NOW - 6 * 60 * 60 * 1000) }),
    ];

    const result = filterBySinceDays(items, 1, "test");

    expect(result).toHaveLength(2);
    expect(result.map((i) => i.externalId)).toContain("1");
    expect(result.map((i) => i.externalId)).toContain("3");
  });
});
