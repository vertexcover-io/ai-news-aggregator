import { describe, expect, it } from "vitest";
import type {
  CollectorHealthResult,
  CollectorHealthSnapshot,
} from "@shared/types/index.js";
import {
  collectorHealthKey,
  HEALTH_CHECKABLE_COLLECTORS,
} from "@shared/constants/index.js";

// Phase 1 — pure types + constants (REQ-007, data shapes for all REQs)

describe("collectorHealthKey", () => {
  it("produces distinct keys for every checkable collector", () => {
    const keys = HEALTH_CHECKABLE_COLLECTORS.map((c) => collectorHealthKey("t1", c));
    const unique = new Set(keys);
    expect(unique.size).toBe(HEALTH_CHECKABLE_COLLECTORS.length);
  });

  it("scopes the key by tenant — same collector, different tenants → different keys", () => {
    expect(collectorHealthKey("t1", "hn")).not.toBe(collectorHealthKey("t2", "hn"));
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
