import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FixtureSchema } from "@newsletter/shared/types/eval-ranking-schemas";
import type { RankedItemRef } from "@newsletter/shared";

import { exportFixtures } from "@pipeline/eval/export-fixtures.js";
import type {
  EvalExportArchiveRow,
  EvalExportsRepo,
} from "@pipeline/repositories/eval-exports.js";
import type { RawItemRow } from "@pipeline/repositories/raw-items.js";

interface Seed {
  archives: EvalExportArchiveRow[];
  items: RawItemRow[];
}

function makeArchive(
  id: string,
  createdAt: Date,
  rankedItemIds: number[],
): EvalExportArchiveRow {
  const rankedItems: RankedItemRef[] = rankedItemIds.map((rawItemId, idx) => ({
    rawItemId,
    score: rankedItemIds.length - idx,
    rationale: `rationale-${rawItemId}`,
  }));
  return {
    id,
    rankedItems,
    createdAt,
    completedAt: new Date(createdAt.getTime() + 60 * 1000),
    startedAt: new Date(createdAt.getTime() - 60 * 1000),
  };
}

function makeRawItem(
  id: number,
  collectedAt: Date,
  overrides: Partial<RawItemRow> = {},
): RawItemRow {
  return {
    id,
    sourceType: "hn",
    externalId: `ext-${id}`,
    title: `Title ${id}`,
    url: `https://example.com/${id}`,
    sourceUrl: null,
    author: "alice",
    content: `content ${id}`,
    imageUrl: null,
    publishedAt: collectedAt,
    engagement: { points: id * 10, commentCount: id },
    metadata: { comments: [] },
    ...overrides,
    // Force collectedAt to be applied through the filter via the repo stub —
    // we don't store collectedAt on RawItemRow, but our stub uses the
    // separate `items` arg's mapping.
  };
}

function buildRepo(seed: Seed, itemCollectedAt: Map<number, Date>): EvalExportsRepo {
  return {
    listCompletedArchives({ since, runId }) {
      if (runId !== undefined) {
        return Promise.resolve(seed.archives.filter((a) => a.id === runId));
      }
      return Promise.resolve(seed.archives.filter((a) => a.createdAt >= since));
    },
    findRawItemsInWindow({ from, to }) {
      return Promise.resolve(
        seed.items.filter((row) => {
          const ts = itemCollectedAt.get(row.id);
          if (ts === undefined) return false;
          return ts >= from && ts <= to;
        }),
      );
    },
  };
}

describe("exportFixtures", () => {
  let dir: string;
  let now: Date;
  let seed: Seed;
  let itemTimes: Map<number, Date>;
  let repo: EvalExportsRepo;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "export-fixtures-"));
    now = new Date("2026-05-22T12:00:00Z");

    const aCreated = new Date("2026-05-20T10:00:00Z");
    const bCreated = new Date("2026-05-21T10:00:00Z");
    seed = {
      archives: [
        makeArchive(
          "11111111-1111-4111-8111-111111111111",
          aCreated,
          [1, 2],
        ),
        makeArchive(
          "22222222-2222-4222-8222-222222222222",
          bCreated,
          [3, 4],
        ),
      ],
      items: [
        makeRawItem(1, aCreated),
        makeRawItem(2, aCreated),
        makeRawItem(3, bCreated),
        makeRawItem(4, bCreated),
      ],
    };
    itemTimes = new Map([
      [1, aCreated],
      [2, aCreated],
      [3, bCreated],
      [4, bCreated],
    ]);
    repo = buildRepo(seed, itemTimes);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes one fixture per completed archive", async () => {
    const result = await exportFixtures({ repo, fixturesDir: dir, now });

    expect(result.exported).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);

    const files = (await readdir(dir)).sort();
    expect(files).toHaveLength(2);
    expect(files[0]).toMatch(/^run-\d{4}-\d{2}-\d{2}-[0-9a-f]{8}\.json$/);
  });

  it("emits files that validate against FixtureSchema", async () => {
    await exportFixtures({ repo, fixturesDir: dir, now });

    const files = await readdir(dir);
    for (const file of files) {
      const raw = await readFile(join(dir, file), "utf8");
      const parsed = FixtureSchema.parse(JSON.parse(raw));
      expect(parsed.source).toBe("run");
      expect(parsed.pool.length).toBeGreaterThan(0);
      expect(parsed.pool[0].rawItemId).toBeTypeOf("number");
      expect(parsed.pool[0].title).toBeTypeOf("string");
      expect(parsed.pool[0].sourceType).toBe("hn");
      expect(parsed.originalRankerOutput).not.toBeNull();
    }
  });

  it("is idempotent: re-running skips existing files", async () => {
    await exportFixtures({ repo, fixturesDir: dir, now });
    const second = await exportFixtures({ repo, fixturesDir: dir, now });

    expect(second.exported).toBe(0);
    expect(second.skipped).toBe(2);
    expect(second.failed).toBe(0);
  });

  it("--force rewrites existing fixture files", async () => {
    await exportFixtures({ repo, fixturesDir: dir, now });
    const result = await exportFixtures({
      repo,
      fixturesDir: dir,
      now,
      force: true,
    });

    expect(result.exported).toBe(2);
    expect(result.skipped).toBe(0);
  });

  it("--days bounds the archive lookback", async () => {
    const veryOldArchive = makeArchive(
      "33333333-3333-4333-8333-333333333333",
      new Date("2026-03-01T10:00:00Z"),
      [5],
    );
    seed.archives.push(veryOldArchive);
    seed.items.push(makeRawItem(5, new Date("2026-03-01T10:00:00Z")));
    itemTimes.set(5, new Date("2026-03-01T10:00:00Z"));

    const narrow = await exportFixtures({
      repo,
      fixturesDir: dir,
      now,
      days: 5,
    });
    expect(narrow.exported).toBe(2);

    await rm(dir, { recursive: true, force: true });
    const wide = await exportFixtures({
      repo,
      fixturesDir: dir,
      now,
      days: 365,
    });
    expect(wide.exported).toBe(3);
  });

  it("filters to a single archive when runId is provided", async () => {
    const result = await exportFixtures({
      repo,
      fixturesDir: dir,
      now,
      runId: "22222222-2222-4222-8222-222222222222",
    });
    expect(result.exported).toBe(1);
    expect(result.fixtures[0].runId).toBe(
      "22222222-2222-4222-8222-222222222222",
    );
  });

  it("encodes originalRankerOutput with rank-position scores", async () => {
    await exportFixtures({ repo, fixturesDir: dir, now });
    const files = (await readdir(dir)).sort();
    const first = JSON.parse(await readFile(join(dir, files[0]), "utf8"));
    expect(first.originalRankerOutput[0].score).toBe(1);
    expect(first.originalRankerOutput[1].score).toBe(2);
  });
});
