import { describe, expect, it } from "vitest";
import type {
  CollectorHealthResult,
  CollectorHealthSnapshot,
  CollectorHealthStatus,
  CollectorHealthTrigger,
  HealthCheckCollector,
} from "@shared/types/index.js";
import {
  COLLECTOR_HEALTH_LEAD_MINUTES,
  COLLECTOR_HEALTH_QUEUE_NAME,
  COLLECTOR_HEALTH_SCHEDULER_KEY,
  collectorHealthKey,
  HEALTH_CHECKABLE_COLLECTORS,
} from "@shared/constants/index.js";

// Phase 1 — pure types + constants (REQ-007, data shapes for all REQs)

describe("collectorHealthKey", () => {
  it("produces the expected Redis key for 'blog'", () => {
    expect(collectorHealthKey("blog")).toBe("collector-health:blog");
  });

  it("produces distinct keys for every checkable collector", () => {
    const keys = HEALTH_CHECKABLE_COLLECTORS.map((c) => collectorHealthKey(c));
    const unique = new Set(keys);
    expect(unique.size).toBe(HEALTH_CHECKABLE_COLLECTORS.length);
  });
});

describe("HEALTH_CHECKABLE_COLLECTORS", () => {
  it("has exactly 5 entries", () => {
    expect(HEALTH_CHECKABLE_COLLECTORS).toHaveLength(5);
  });

  it("contains exactly the expected collectors", () => {
    const expected: readonly HealthCheckCollector[] = [
      "hn",
      "reddit",
      "twitter",
      "blog",
      "web_search",
    ];
    expect([...HEALTH_CHECKABLE_COLLECTORS].sort()).toEqual([...expected].sort());
  });
});

describe("constants", () => {
  it("COLLECTOR_HEALTH_QUEUE_NAME is 'collector-health'", () => {
    expect(COLLECTOR_HEALTH_QUEUE_NAME).toBe("collector-health");
  });

  it("COLLECTOR_HEALTH_SCHEDULER_KEY is 'collector-health:default'", () => {
    expect(COLLECTOR_HEALTH_SCHEDULER_KEY).toBe("collector-health:default");
  });

  it("COLLECTOR_HEALTH_LEAD_MINUTES is 30", () => {
    expect(COLLECTOR_HEALTH_LEAD_MINUTES).toBe(30);
  });
});

describe("CollectorHealthResult shape (round-trip)", () => {
  it("healthy result survives JSON.stringify/parse unchanged", () => {
    const result: CollectorHealthResult = {
      collector: "hn",
      status: "healthy",
      trigger: "manual",
      checkedAt: "2026-06-03T12:00:00.000Z",
      durationMs: 420,
      reason: null,
      detail: "Fetched 10 items from Algolia",
    };
    const parsed: CollectorHealthResult = JSON.parse(
      JSON.stringify(result),
    ) as CollectorHealthResult;
    expect(parsed).toEqual(result);
  });

  it("failed result with reason survives JSON.stringify/parse unchanged", () => {
    const result: CollectorHealthResult = {
      collector: "twitter",
      status: "failed",
      trigger: "scheduled",
      checkedAt: "2026-06-03T11:30:00.000Z",
      durationMs: 1500,
      reason: "Twitter auth failed — rotate cookies at /admin/settings",
      detail: "HTTP 401",
    };
    const parsed: CollectorHealthResult = JSON.parse(
      JSON.stringify(result),
    ) as CollectorHealthResult;
    expect(parsed).toEqual(result);
  });

  it("never entry (no prior check) survives JSON.stringify/parse unchanged", () => {
    const result: CollectorHealthResult = {
      collector: "web_search",
      status: "never",
      trigger: null,
      checkedAt: null,
      durationMs: null,
      reason: null,
      detail: null,
    };
    const parsed: CollectorHealthResult = JSON.parse(
      JSON.stringify(result),
    ) as CollectorHealthResult;
    expect(parsed).toEqual(result);
  });

  it("running entry has null durationMs and null reason", () => {
    const result: CollectorHealthResult = {
      collector: "reddit",
      status: "running",
      trigger: "manual",
      checkedAt: "2026-06-03T12:00:00.000Z",
      durationMs: null,
      reason: null,
      detail: null,
    };
    expect(result.durationMs).toBeNull();
    expect(result.reason).toBeNull();
  });

  it("CollectorHealthSnapshot wraps a collectors array", () => {
    const snapshot: CollectorHealthSnapshot = {
      collectors: [
        {
          collector: "hn",
          status: "healthy",
          trigger: "scheduled",
          checkedAt: "2026-06-03T12:00:00.000Z",
          durationMs: 200,
          reason: null,
          detail: null,
        },
        {
          collector: "blog",
          status: "never",
          trigger: null,
          checkedAt: null,
          durationMs: null,
          reason: null,
          detail: null,
        },
      ],
    };
    expect(snapshot.collectors).toHaveLength(2);
    expect(snapshot.collectors[0]?.collector).toBe("hn");
    expect(snapshot.collectors[1]?.status).toBe("never");
  });
});

// Type-level assertions (compile-time guards — fail at tsc if types drift)
const _statusValues: CollectorHealthStatus[] = [
  "never",
  "running",
  "healthy",
  "failed",
];
const _triggerValues: CollectorHealthTrigger[] = ["manual", "scheduled"];
const _collectors: HealthCheckCollector[] = [
  "hn",
  "reddit",
  "twitter",
  "blog",
  "web_search",
];

describe("type compile-time guards", () => {
  it("CollectorHealthStatus covers all 4 values", () => {
    expect(_statusValues).toHaveLength(4);
  });

  it("CollectorHealthTrigger covers both trigger values", () => {
    expect(_triggerValues).toHaveLength(2);
  });

  it("HealthCheckCollector covers all 5 collector values", () => {
    expect(_collectors).toHaveLength(5);
  });
});
