import { describe, it, expect } from "vitest";
import type { CollectorResult, SourceUnitResult } from "@newsletter/shared";
import {
  buildSourceTelemetry,
  type CollectorOutcome,
} from "@pipeline/services/source-telemetry.js";

function makeUnit(overrides: Partial<SourceUnitResult> = {}): SourceUnitResult {
  return {
    identifier: "x",
    displayName: "X",
    itemsFetched: 0,
    status: "completed",
    errors: [],
    durationMs: 0,
    ...overrides,
  };
}

function makeResult(
  overrides: Partial<CollectorResult> = {},
): CollectorResult {
  return {
    itemsFetched: 0,
    commentsFetched: 0,
    itemsStored: 0,
    durationMs: 0,
    ...overrides,
  };
}

describe("buildSourceTelemetry", () => {
  it("emits a single fallback entry for HN (no unitResults)", () => {
    const outcomes: CollectorOutcome[] = [
      {
        sourceType: "hn",
        result: makeResult({ itemsFetched: 12, durationMs: 250 }),
        topLevelError: null,
        durationMs: 250,
      },
    ];

    const tel = buildSourceTelemetry(outcomes);

    expect(tel.sources).toHaveLength(1);
    expect(tel.sources[0]).toEqual({
      sourceType: "hn",
      identifier: "hn",
      displayName: "Hacker News",
      itemsFetched: 12,
      status: "completed",
      errors: [],
      retries: 0,
      durationMs: 250,
    });
    expect(tel.totalItemsFetched).toBe(12);
    expect(tel.totalErrors).toBe(0);
  });

  it("explodes Reddit unit results into per-subreddit entries", () => {
    const units = [
      makeUnit({
        identifier: "r/MachineLearning",
        displayName: "r/MachineLearning",
        itemsFetched: 10,
        status: "completed",
        durationMs: 100,
      }),
      makeUnit({
        identifier: "r/LocalLLaMA",
        displayName: "r/LocalLLaMA",
        itemsFetched: 7,
        status: "completed",
        durationMs: 80,
      }),
      makeUnit({
        identifier: "r/singularity",
        displayName: "r/singularity",
        itemsFetched: 0,
        status: "failed",
        errors: ["403"],
        durationMs: 30,
      }),
    ];
    const outcomes: CollectorOutcome[] = [
      {
        sourceType: "reddit",
        result: makeResult({ itemsFetched: 17, unitResults: units }),
        topLevelError: null,
        durationMs: 210,
      },
    ];

    const tel = buildSourceTelemetry(outcomes);

    expect(tel.sources).toHaveLength(3);
    expect(tel.sources.map((s) => s.displayName)).toEqual([
      "r/MachineLearning",
      "r/LocalLLaMA",
      "r/singularity",
    ]);
    expect(tel.sources.every((s) => s.sourceType === "reddit")).toBe(true);
    expect(tel.sources.every((s) => s.retries === 0)).toBe(true);
    expect(tel.totalItemsFetched).toBe(17);
    expect(tel.totalErrors).toBe(1);
  });

  it("explodes Twitter unit results across lists and users", () => {
    const units = [
      makeUnit({
        identifier: "list:1234567890",
        displayName: "Twitter list 1234567890",
        itemsFetched: 5,
        durationMs: 90,
      }),
      makeUnit({
        identifier: "user:111",
        displayName: "@alice",
        itemsFetched: 3,
        durationMs: 50,
      }),
      makeUnit({
        identifier: "user:222",
        displayName: "@bob",
        itemsFetched: 4,
        durationMs: 60,
      }),
    ];
    const outcomes: CollectorOutcome[] = [
      {
        sourceType: "twitter",
        result: makeResult({ itemsFetched: 12, unitResults: units }),
        topLevelError: null,
        durationMs: 200,
      },
    ];

    const tel = buildSourceTelemetry(outcomes);

    expect(tel.sources).toHaveLength(3);
    expect(tel.sources[0].identifier).toBe("list:1234567890");
    expect(tel.sources[1].identifier).toBe("user:111");
    expect(tel.sources[2].identifier).toBe("user:222");
  });

  it("explodes Web unit results, counts failed entries", () => {
    const units = [
      makeUnit({
        identifier: "https://a.example/feed",
        displayName: "A blog",
        itemsFetched: 4,
        status: "completed",
        durationMs: 100,
      }),
      makeUnit({
        identifier: "https://b.example/feed",
        displayName: "B blog",
        itemsFetched: 0,
        status: "failed",
        errors: ["timeout"],
        durationMs: 30,
      }),
    ];
    const outcomes: CollectorOutcome[] = [
      {
        sourceType: "blog",
        result: makeResult({ itemsFetched: 4, unitResults: units }),
        topLevelError: null,
        durationMs: 130,
      },
    ];

    const tel = buildSourceTelemetry(outcomes);

    expect(tel.sources).toHaveLength(2);
    expect(tel.totalItemsFetched).toBe(4);
    expect(tel.totalErrors).toBe(1);
  });

  it("returns empty telemetry when no outcomes", () => {
    const tel = buildSourceTelemetry([]);
    expect(tel.sources).toEqual([]);
    expect(tel.totalItemsFetched).toBe(0);
    expect(tel.totalErrors).toBe(0);
  });

  it("encodes a top-level collector error as a failed fallback entry", () => {
    const outcomes: CollectorOutcome[] = [
      {
        sourceType: "twitter",
        result: null,
        topLevelError: "rettiwt: 401 unauthorized",
        durationMs: 12,
      },
    ];

    const tel = buildSourceTelemetry(outcomes);

    expect(tel.sources).toHaveLength(1);
    expect(tel.sources[0]).toEqual({
      sourceType: "twitter",
      identifier: "twitter",
      displayName: "Twitter",
      itemsFetched: 0,
      status: "failed",
      errors: ["rettiwt: 401 unauthorized"],
      retries: 0,
      durationMs: 12,
    });
    expect(tel.totalErrors).toBe(1);
  });
});
