import { describe, expect, it } from "vitest";
import {
  buildSourceSteps,
  classifyLogStep,
  SOURCE_STEP_ORDER,
} from "../source-steps.js";
import type {
  RunLogEntry,
  RunSourceItemsSummary,
  SourceStepKey,
} from "../../types/observability.js";

const EMPTY_SUMMARY: RunSourceItemsSummary = {
  ranked: 0,
  shortlisted: 0,
  dedupedSurvivors: 0,
  dedupDropped: 0,
  enrichFailed: 0,
};

function log(overrides: Partial<RunLogEntry> & { id: number }): RunLogEntry {
  return {
    runId: "11111111-1111-1111-1111-111111111111",
    ts: "2026-06-23T00:00:00.000Z",
    level: "info",
    stage: "collect",
    source: "cursor.com",
    event: "collector.web.listing_completed",
    message: "",
    context: null,
    ...overrides,
  };
}

describe("classifyLogStep", () => {
  it("honors an explicit context.step over the event name", () => {
    expect(classifyLogStep("anything.at.all", { step: "enrich" })).toBe("enrich");
  });

  it("maps known event-name substrings", () => {
    const cases: [string, SourceStepKey | null][] = [
      ["collector.web.listing_completed", "discover"],
      ["fetch.post", "fetch"],
      ["collector.web.detail_failed", "fetch"],
      ["web.extract.start", "extract"],
      ["link_enrichment.failed", "enrich"],
      ["stage.start", null],
      ["source.completed", null],
    ];
    for (const [event, expected] of cases) {
      expect(classifyLogStep(event, null)).toBe(expected);
    }
  });
});

describe("buildSourceSteps", () => {
  it("returns all seven steps in canonical order", () => {
    const steps = buildSourceSteps({
      logs: [],
      summary: EMPTY_SUMMARY,
      itemCount: 0,
    });
    expect(steps.map((s) => s.key)).toEqual([...SOURCE_STEP_ORDER]);
  });

  it("marks collect steps done from logs and process steps from the summary", () => {
    const steps = buildSourceSteps({
      logs: [
        log({ id: 1, event: "collector.web.listing_completed", context: { discovered: 14, durationMs: 900 } }),
        log({ id: 2, event: "web.extract.done", context: { extracted: 12, durationMs: 3400 } }),
      ],
      summary: { ranked: 3, shortlisted: 6, dedupedSurvivors: 11, dedupDropped: 1, enrichFailed: 1 },
      itemCount: 12,
    });
    const byKey = new Map(steps.map((s) => [s.key, s]));
    expect(byKey.get("discover")?.status).toBe("done");
    expect(byKey.get("discover")?.count).toBe(14);
    expect(byKey.get("extract")?.status).toBe("done");
    expect(byKey.get("extract")?.count).toBe(12);
    expect(byKey.get("fetch")?.status).toBe("empty");
    expect(byKey.get("dedup")?.count).toBe(11);
    expect(byKey.get("dedup")?.detail).toBe("1 dropped");
    expect(byKey.get("shortlist")?.count).toBe(6);
    expect(byKey.get("rank")?.count).toBe(3);
  });

  it("fails the fatal step and skips everything after it", () => {
    const steps = buildSourceSteps({
      logs: [
        log({
          id: 1,
          level: "error",
          event: "collector.web.detail_failed",
          context: { fatal: true, errorClass: "AuthError" },
        }),
      ],
      summary: EMPTY_SUMMARY,
      itemCount: 0,
    });
    const byKey = new Map(steps.map((s) => [s.key, s]));
    expect(byKey.get("fetch")?.status).toBe("failed");
    for (const key of ["extract", "enrich", "dedup", "shortlist", "rank"] as const) {
      expect(byKey.get(key)?.status).toBe("skipped");
    }
  });

  it("keeps a step done when it only had a non-fatal error", () => {
    const steps = buildSourceSteps({
      logs: [
        log({ id: 1, level: "error", event: "link_enrichment.failed", context: { fatal: false } }),
      ],
      summary: { ...EMPTY_SUMMARY, dedupedSurvivors: 2 },
      itemCount: 2,
    });
    const enrich = steps.find((s) => s.key === "enrich");
    expect(enrich?.status).toBe("done");
    expect(enrich?.detail).toBe("completed with errors");
  });
});
