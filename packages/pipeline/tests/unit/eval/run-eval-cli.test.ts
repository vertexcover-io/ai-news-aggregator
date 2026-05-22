/* eslint-disable @typescript-eslint/require-await -- test stubs satisfy async-returning function types without needing awaits */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  Fixture,
  GroundTruth,
} from "@newsletter/shared/types/eval-ranking";

import { EvalCache } from "@pipeline/eval/cache.js";
import { runEvalCli } from "@pipeline/eval/run-eval-cli.js";
import type { runEval as runEvalDefault } from "@pipeline/eval/index.js";

type RunEvalFn = typeof runEvalDefault;

function makeFixture(id: string): Fixture {
  return {
    fixtureId: id,
    source: "manual",
    date: null,
    runId: null,
    model: "claude-haiku-4-5-20251001",
    exportedAt: "2026-05-22T00:00:00.000Z",
    pool: [],
    dedupClusters: [],
    originalRankerOutput: null,
  };
}

function makeGroundTruth(id: string, gradedAt: string): GroundTruth {
  return {
    fixtureId: id,
    gradedBy: ["alice"],
    gradedAt,
    labels: [{ rawItemId: 1, tier: "must" }],
  };
}

function makeRunEvalStub(
  perFixture?: Record<string, { ndcg: number } | { error: string }>,
): { fn: RunEvalFn; calls: { fixtureId: string; bypassCache: boolean }[] } {
  const calls: { fixtureId: string; bypassCache: boolean }[] = [];
  const fn = vi.fn(
    async (
      args: Parameters<RunEvalFn>[0],
    ): ReturnType<RunEvalFn> => {
      calls.push({
        fixtureId: args.fixture.fixtureId,
        bypassCache: args.cache.bypassCache,
      });
      const recipe = perFixture?.[args.fixture.fixtureId];
      if (recipe !== undefined && "error" in recipe) {
        throw new Error(recipe.error);
      }
      const ndcg = recipe?.ndcg ?? 0.8;
      return {
        rankedItems: [],
        score: {
          fixtureId: args.fixture.fixtureId,
          ndcgAt10: ndcg,
          precisionAt10: 0.6,
          mustIncludeRecall: 0.7,
          rankOneIsMustInclude: true,
          perItemDiff: [],
          ranAt: "2026-05-22T00:00:00.000Z",
          promptHash: "hash1234",
          model: args.fixture.model,
        },
        cost: {
          tokensIn: 5000,
          tokensOut: 2000,
          usd: 0.02,
          cacheHit: false,
          promptHash: "hash1234",
        },
      };
    },
  ) as unknown as RunEvalFn;
  return { fn, calls };
}

describe("runEvalCli", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "run-eval-cli-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const baseOpts = (overrides: Partial<Parameters<typeof runEvalCli>[0]>) => ({
    cache: new EvalCache(dir),
    loadPromptFromDb: async (): Promise<string> => "system prompt",
    readScoreHistory: async (): Promise<Record<string, never>> => ({}),
    recordScore: async (): Promise<void> => undefined,
    writeLine: (): void => undefined,
    ...overrides,
  });

  it("single fixture: exits 0 with score", async () => {
    const fixture = makeFixture("fix-1");
    const gt = makeGroundTruth("fix-1", "2026-05-22T00:00:00.000Z");
    const stub = makeRunEvalStub();
    const recordedScores: { fixtureId: string; ndcgAt10: number }[] = [];

    const result = await runEvalCli(
      baseOpts({
        fixture: "fix-1",
        readFixture: async () => fixture,
        readGroundTruth: async () => gt,
        runEval: stub.fn,
        recordScore: async (e) => {
          recordedScores.push({
            fixtureId: e.fixtureId,
            ndcgAt10: e.ndcgAt10,
          });
        },
      }),
    );

    expect(result.exitCode).toBe(0);
    expect(result.perFixture).toHaveLength(1);
    expect(result.perFixture[0].score?.ndcgAt10).toBe(0.8);
    expect(stub.calls).toHaveLength(1);
    expect(recordedScores).toEqual([{ fixtureId: "fix-1", ndcgAt10: 0.8 }]);
  });

  it("--all default window slices to 20 most-recent graded fixtures", async () => {
    const all: Fixture[] = Array.from({ length: 25 }, (_, i) =>
      makeFixture(`fix-${String(i).padStart(2, "0")}`),
    );
    const gts = new Map<string, GroundTruth>();
    for (let i = 0; i < 25; i++) {
      gts.set(
        `fix-${String(i).padStart(2, "0")}`,
        makeGroundTruth(
          `fix-${String(i).padStart(2, "0")}`,
          `2026-05-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
        ),
      );
    }
    const stub = makeRunEvalStub();

    const result = await runEvalCli(
      baseOpts({
        all: true,
        listFixtures: async () => all,
        readGroundTruth: async (id: string) => gts.get(id) ?? null,
        runEval: stub.fn,
      }),
    );

    expect(stub.calls).toHaveLength(20);
    // newest gradedAt is fix-24 (May 25), then fix-23, etc.
    expect(stub.calls[0].fixtureId).toBe("fix-24");
    expect(result.exitCode).toBe(0);
  });

  it("--window 30 takes 30", async () => {
    const all: Fixture[] = Array.from({ length: 40 }, (_, i) =>
      makeFixture(`f-${i}`),
    );
    const gts = new Map(
      all.map((f, i) => [
        f.fixtureId,
        makeGroundTruth(
          f.fixtureId,
          `2026-05-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
        ),
      ]),
    );
    const stub = makeRunEvalStub();

    await runEvalCli(
      baseOpts({
        window: 30,
        listFixtures: async () => all,
        readGroundTruth: async (id) => gts.get(id) ?? null,
        runEval: stub.fn,
      }),
    );

    expect(stub.calls).toHaveLength(30);
  });

  it("--window 65 without --force-window throws", async () => {
    await expect(
      runEvalCli(
        baseOpts({
          window: 65,
          listFixtures: async () => [],
          readGroundTruth: async () => null,
        }),
      ),
    ).rejects.toThrow(/force-window/);
  });

  it("--force-window 65 takes 65", async () => {
    const all: Fixture[] = Array.from({ length: 70 }, (_, i) =>
      makeFixture(`f-${i}`),
    );
    const gts = new Map(
      all.map((f) => [
        f.fixtureId,
        makeGroundTruth(f.fixtureId, "2026-05-22T00:00:00.000Z"),
      ]),
    );
    const stub = makeRunEvalStub();

    await runEvalCli(
      baseOpts({
        forceWindow: 65,
        listFixtures: async () => all,
        readGroundTruth: async (id) => gts.get(id) ?? null,
        runEval: stub.fn,
      }),
    );

    expect(stub.calls).toHaveLength(65);
  });

  it("--prompt-file reads prompt from file", async () => {
    const promptPath = join(dir, "prompt.txt");
    await writeFile(promptPath, "FROM FILE PROMPT", "utf8");
    const fixture = makeFixture("fix-1");
    const gt = makeGroundTruth("fix-1", "2026-05-22T00:00:00.000Z");
    let seenPrompt = "";
    const fn: RunEvalFn = (async (args: Parameters<RunEvalFn>[0]) => {
      seenPrompt = args.prompt;
      return {
        rankedItems: [],
        score: {
          fixtureId: args.fixture.fixtureId,
          ndcgAt10: 0.8,
          precisionAt10: 0.6,
          mustIncludeRecall: 0.7,
          rankOneIsMustInclude: true,
          perItemDiff: [],
          ranAt: "2026-05-22T00:00:00.000Z",
          promptHash: "h",
          model: args.fixture.model,
        },
        cost: {
          tokensIn: 0,
          tokensOut: 0,
          usd: 0,
          cacheHit: false,
          promptHash: "h",
        },
      };
    }) as unknown as RunEvalFn;

    await runEvalCli(
      baseOpts({
        fixture: "fix-1",
        promptFile: promptPath,
        readFixture: async () => fixture,
        readGroundTruth: async () => gt,
        runEval: fn,
      }),
    );

    expect(seenPrompt).toBe("FROM FILE PROMPT");
  });

  it("--no-cache constructs cache with bypassCache=true", async () => {
    const fixture = makeFixture("fix-1");
    const gt = makeGroundTruth("fix-1", "2026-05-22T00:00:00.000Z");
    const stub = makeRunEvalStub();
    const cache = new EvalCache(dir, { bypassCache: true });

    await runEvalCli({
      cache,
      fixture: "fix-1",
      noCache: true,
      readFixture: async () => fixture,
      readGroundTruth: async () => gt,
      runEval: stub.fn,
      loadPromptFromDb: async () => "x",
      writeLine: () => undefined,
      readScoreHistory: async () => ({}),
      recordScore: async () => undefined,
    });

    expect(stub.calls[0].bypassCache).toBe(true);
  });

  it("--dry-run skips runEval and exits 0", async () => {
    const all = [makeFixture("a"), makeFixture("b"), makeFixture("c")];
    const gts = new Map(
      all.map((f) => [
        f.fixtureId,
        makeGroundTruth(f.fixtureId, "2026-05-22T00:00:00.000Z"),
      ]),
    );
    const stub = makeRunEvalStub();
    const lines: string[] = [];

    const result = await runEvalCli(
      baseOpts({
        all: true,
        dryRun: true,
        listFixtures: async () => all,
        readGroundTruth: async (id) => gts.get(id) ?? null,
        runEval: stub.fn,
        writeLine: (s) => lines.push(s),
      }),
    );

    expect(result.exitCode).toBe(0);
    expect(stub.calls).toHaveLength(0);
    expect(lines.join("\n")).toMatch(/dry-run/);
    expect(result.estimate).toBeDefined();
  });

  it("--json prints exactly one JSON object to stdout", async () => {
    const fixture = makeFixture("fix-1");
    const gt = makeGroundTruth("fix-1", "2026-05-22T00:00:00.000Z");
    const stub = makeRunEvalStub();
    const lines: string[] = [];

    await runEvalCli(
      baseOpts({
        fixture: "fix-1",
        json: true,
        readFixture: async () => fixture,
        readGroundTruth: async () => gt,
        runEval: stub.fn,
        writeLine: (s) => lines.push(s),
      }),
    );

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.exitCode).toBe(0);
    expect(parsed.perFixture).toHaveLength(1);
    expect(parsed.aggregate.succeeded).toBe(1);
  });

  it("1-of-3 failure: exit 0, error captured, 2 succeed", async () => {
    const all = [makeFixture("a"), makeFixture("b"), makeFixture("c")];
    const gts = new Map(
      all.map((f) => [
        f.fixtureId,
        makeGroundTruth(f.fixtureId, "2026-05-22T00:00:00.000Z"),
      ]),
    );
    const stub = makeRunEvalStub({ b: { error: "boom" } });

    const result = await runEvalCli(
      baseOpts({
        all: true,
        listFixtures: async () => all,
        readGroundTruth: async (id) => gts.get(id) ?? null,
        runEval: stub.fn,
      }),
    );

    expect(result.exitCode).toBe(0);
    expect(result.aggregate?.succeeded).toBe(2);
    expect(result.aggregate?.failed).toBe(1);
    const errEntry = result.perFixture.find((p) => p.fixtureId === "b");
    expect(errEntry?.error).toBe("boom");
  });

  it("all-fail: exit 1", async () => {
    const all = [makeFixture("a"), makeFixture("b"), makeFixture("c")];
    const gts = new Map(
      all.map((f) => [
        f.fixtureId,
        makeGroundTruth(f.fixtureId, "2026-05-22T00:00:00.000Z"),
      ]),
    );
    const stub = makeRunEvalStub({
      a: { error: "x" },
      b: { error: "y" },
      c: { error: "z" },
    });

    const result = await runEvalCli(
      baseOpts({
        all: true,
        listFixtures: async () => all,
        readGroundTruth: async (id) => gts.get(id) ?? null,
        runEval: stub.fn,
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.aggregate?.succeeded).toBe(0);
    expect(result.aggregate?.failed).toBe(3);
  });

  it("delta-vs-previous: includes previousNdcgAt10 from history", async () => {
    const fixture = makeFixture("fix-1");
    const gt = makeGroundTruth("fix-1", "2026-05-22T00:00:00.000Z");
    const stub = makeRunEvalStub({ "fix-1": { ndcg: 0.85 } });

    const result = await runEvalCli(
      baseOpts({
        fixture: "fix-1",
        readFixture: async () => fixture,
        readGroundTruth: async () => gt,
        runEval: stub.fn,
        readScoreHistory: async () => ({
          "fix-1": {
            fixtureId: "fix-1",
            ndcgAt10: 0.7,
            ranAt: "2026-05-21T00:00:00.000Z",
            promptHash: "prev",
          },
        }),
      }),
    );

    expect(result.perFixture[0].previousNdcgAt10).toBe(0.7);
  });

  it("missing ground truth in --all mode is skipped without error", async () => {
    const all = [makeFixture("a"), makeFixture("b")];
    const gts = new Map([
      [
        "a",
        makeGroundTruth("a", "2026-05-22T00:00:00.000Z"),
      ],
    ]);
    const stub = makeRunEvalStub();

    await runEvalCli(
      baseOpts({
        all: true,
        listFixtures: async () => all,
        readGroundTruth: async (id) => gts.get(id) ?? null,
        runEval: stub.fn,
      }),
    );

    // only `a` is graded and so eligible
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0].fixtureId).toBe("a");
  });
});
