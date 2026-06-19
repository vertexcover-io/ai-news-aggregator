import { describe, it, expect, vi } from "vitest";
import { createCandidatesRepo } from "@pipeline/repositories/candidates.js";
import type { AppDb, SourceType } from "@newsletter/shared/db";

function makeDb(rows: object[]): Pick<AppDb, "select"> {
  const whereBuilder = {
    then: (resolve: (v: object[]) => unknown) => Promise.resolve(rows).then(resolve),
  };
  const fromBuilder = { where: () => whereBuilder };
  const selectBuilder = { from: () => fromBuilder };
  return { select: vi.fn(() => selectBuilder) } as unknown as Pick<AppDb, "select">;
}

describe("CandidatesRepo.findSince", () => {
  it("test_REQ_009_manual_item_is_candidate: returns a manual raw_item when queried with sourceType 'manual'", async () => {
    const since = new Date("2026-06-17T00:00:00Z");
    const manualRow = {
      id: 42,
      title: "My submitted article",
      url: "https://example.com/article",
      sourceType: "manual" as SourceType,
      author: null,
      publishedAt: null,
      engagement: { points: 0, commentCount: 0 },
      content: null,
      metadata: { comments: [] },
    };

    const db = makeDb([manualRow]);
    const repo = createCandidatesRepo(db);

    const results = await repo.findSince(since, ["manual"]);

    expect(results).toHaveLength(1);
    expect(results[0].sourceType).toBe("manual");
    expect(results[0].id).toBe(42);
    expect(results[0].url).toBe("https://example.com/article");
  });

  it("returns empty array when sourceTypes is empty (guard)", async () => {
    const db = makeDb([]);
    const repo = createCandidatesRepo(db);
    const results = await repo.findSince(new Date(), []);
    expect(results).toEqual([]);
  });
});
