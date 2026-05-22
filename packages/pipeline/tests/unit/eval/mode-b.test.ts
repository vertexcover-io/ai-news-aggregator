import { describe, it, expect, vi } from "vitest";
import type { Fixture } from "@newsletter/shared/types/eval-ranking";
import type { RankedItemRef } from "@newsletter/shared";
import {
  buildCalendarFixture,
  runModeB,
  type CalendarPoolItem,
} from "@pipeline/eval/mode-b.js";
import type { EvalCache } from "@pipeline/eval/cache.js";
import type { RunEvalOutput } from "@pipeline/eval/index.js";

const POOL: CalendarPoolItem[] = [
  {
    rawItemId: 1,
    title: "a",
    url: "https://a.com",
    sourceType: "hn",
    publishedAt: null,
    content: null,
  },
  {
    rawItemId: 2,
    title: "b",
    url: "https://b.com",
    sourceType: "reddit",
    publishedAt: null,
    content: null,
  },
];

function fakeCache(): EvalCache {
  return {} as EvalCache;
}

describe("buildCalendarFixture", () => {
  it("constructs a calendar fixture from a pool", () => {
    const f = buildCalendarFixture("2026-05-20", POOL, "claude-haiku-4-5");
    expect(f.source).toBe("calendar");
    expect(f.fixtureId).toBe("calendar-2026-05-20");
    expect(f.date).toBe("2026-05-20");
    expect(f.pool).toHaveLength(2);
  });

  it("throws on empty pool", () => {
    expect(() => buildCalendarFixture("2026-05-20", [], "m")).toThrow(/no raw_items/);
  });
});

describe("runModeB", () => {
  it("calls runEval twice in parallel and returns both rankings", async () => {
    const fixture: Fixture = buildCalendarFixture(
      "2026-05-20",
      POOL,
      "claude-haiku-4-5",
    );
    const calls: string[] = [];
    const runEval = vi.fn(
      async (args: { prompt: string }): Promise<RunEvalOutput> => {
        calls.push(args.prompt);
        // sleep to detect parallelism
        await new Promise((r) => setTimeout(r, 5));
        const ranked: RankedItemRef[] = [
          { rawItemId: 1, score: 0.9, rationale: "ok" },
        ];
        return {
          rankedItems: ranked,
          score: null,
          cost: {
            tokensIn: 10,
            tokensOut: 5,
            usd: 0.001,
            cacheHit: false,
            promptHash: args.prompt,
          },
        };
      },
    );
    const result = await runModeB(
      {
        fixture,
        savedPrompt: "SAVED",
        draftPrompt: "DRAFT",
        model: "claude-haiku-4-5",
        cache: fakeCache(),
      },
      { runEval },
    );
    expect(runEval).toHaveBeenCalledTimes(2);
    expect(calls).toContain("SAVED");
    expect(calls).toContain("DRAFT");
    expect(result.saved).toHaveLength(1);
    expect(result.draft).toHaveLength(1);
    expect(result.cost.totalUsd).toBeCloseTo(0.002);
  });
});
