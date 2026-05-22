import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  readScoreHistory,
  recordScore,
  type ScoreHistoryEntry,
} from "@pipeline/eval/score-history.js";

describe("score-history", () => {
  let dir: string;
  let path: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "score-history-test-"));
    path = join(dir, "scores.json");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns {} when file missing", async () => {
    const h = await readScoreHistory(path);
    expect(h).toEqual({});
  });

  it("roundtrips an entry", async () => {
    const entry: ScoreHistoryEntry = {
      fixtureId: "fix-1",
      ndcgAt10: 0.82,
      ranAt: "2026-05-22T00:00:00.000Z",
      promptHash: "abcd1234",
    };
    await recordScore(entry, path);
    const h = await readScoreHistory(path);
    expect(h["fix-1"]).toEqual(entry);
  });

  it("overwrites prior entry for the same fixtureId", async () => {
    await recordScore(
      {
        fixtureId: "fix-1",
        ndcgAt10: 0.5,
        ranAt: "2026-05-22T00:00:00.000Z",
        promptHash: "old",
      },
      path,
    );
    await recordScore(
      {
        fixtureId: "fix-1",
        ndcgAt10: 0.9,
        ranAt: "2026-05-23T00:00:00.000Z",
        promptHash: "new",
      },
      path,
    );
    const h = await readScoreHistory(path);
    expect(h["fix-1"]?.ndcgAt10).toBe(0.9);
    expect(h["fix-1"]?.promptHash).toBe("new");
  });

  it("preserves entries for other fixtures", async () => {
    await recordScore(
      {
        fixtureId: "fix-1",
        ndcgAt10: 0.5,
        ranAt: "2026-05-22T00:00:00.000Z",
        promptHash: "a",
      },
      path,
    );
    await recordScore(
      {
        fixtureId: "fix-2",
        ndcgAt10: 0.7,
        ranAt: "2026-05-22T00:00:00.000Z",
        promptHash: "b",
      },
      path,
    );
    const h = await readScoreHistory(path);
    expect(Object.keys(h).sort()).toEqual(["fix-1", "fix-2"]);
  });

  it("written file is valid JSON", async () => {
    await recordScore(
      {
        fixtureId: "fix-1",
        ndcgAt10: 0.5,
        ranAt: "2026-05-22T00:00:00.000Z",
        promptHash: "a",
      },
      path,
    );
    const raw = await readFile(path, "utf8");
    expect(() => JSON.parse(raw)).not.toThrow();
  });
});
