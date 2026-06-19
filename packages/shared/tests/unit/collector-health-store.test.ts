import { describe, expect, it, beforeEach } from "vitest";
import type { CollectorHealthResult } from "@shared/types/index.js";
import {
  collectorHealthKey,
  HEALTH_CHECKABLE_COLLECTORS,
} from "@shared/constants/index.js";
import { createCollectorHealthStore } from "@shared/services/collector-health-store.js";

// FIX: collector-health results are per-tenant — every store op is scoped by a
// tenantId so one tenant's check never surfaces in another's snapshot.
const T = "11111111-1111-1111-1111-111111111111";

// Minimal hand fake for ioredis — implements only get/set/mget/ttl
class FakeRedis {
  private store = new Map<string, string>();

  set(key: string, value: string): Promise<"OK"> {
    this.store.set(key, value);
    return Promise.resolve("OK");
  }

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.store.get(key) ?? null);
  }

  mget(...keys: string[]): Promise<(string | null)[]> {
    return Promise.resolve(keys.map((k) => this.store.get(k) ?? null));
  }

  // Returns -1 when key exists but has no TTL (persists forever)
  // Returns -2 when key does not exist
  ttl(key: string): Promise<number> {
    if (!this.store.has(key)) return Promise.resolve(-2);
    return Promise.resolve(-1); // no TTL set = persistent
  }
}

describe("createCollectorHealthStore", () => {
  let redis: FakeRedis;

  beforeEach(() => {
    redis = new FakeRedis();
  });

  // REQ-005, REQ-006: set then getSnapshot round-trips a healthy result
  it("set then getSnapshot returns the stored healthy result (REQ-005/REQ-006)", async () => {
    const store = createCollectorHealthStore(redis);
    const result: CollectorHealthResult = {
      collector: "hn",
      status: "healthy",
      trigger: "manual",
      checkedAt: "2026-06-03T12:00:00.000Z",
      durationMs: 350,
      reason: null,
      detail: "Fetched 10 items",
    };

    await store.set(T, result);
    const snapshot = await store.getSnapshot(T);

    const entry = snapshot.collectors.find((c) => c.collector === "hn");
    expect(entry).toEqual(result);
  });

  // REQ-005, REQ-006: set then getSnapshot round-trips a failed result
  it("set then getSnapshot returns the stored failed result (REQ-005/REQ-006)", async () => {
    const store = createCollectorHealthStore(redis);
    const result: CollectorHealthResult = {
      collector: "twitter",
      status: "failed",
      trigger: "scheduled",
      checkedAt: "2026-06-03T11:00:00.000Z",
      durationMs: 1200,
      reason: "Twitter auth failed",
      detail: "HTTP 401",
    };

    await store.set(T, result);
    const snapshot = await store.getSnapshot(T);

    const entry = snapshot.collectors.find((c) => c.collector === "twitter");
    expect(entry).toEqual(result);
  });

  // Tenant isolation: one tenant's result never appears in another's snapshot.
  it("scopes results by tenant — a result set for one tenant is invisible to another", async () => {
    const store = createCollectorHealthStore(redis);
    const other = "22222222-2222-2222-2222-222222222222";
    await store.set(T, {
      collector: "reddit",
      status: "healthy",
      trigger: "manual",
      checkedAt: "2026-06-03T12:00:00.000Z",
      durationMs: 200,
      reason: null,
      detail: null,
    });

    const mine = await store.getSnapshot(T);
    const theirs = await store.getSnapshot(other);

    expect(mine.collectors.find((c) => c.collector === "reddit")?.status).toBe(
      "healthy",
    );
    expect(theirs.collectors.find((c) => c.collector === "reddit")?.status).toBe(
      "never",
    );
  });

  // REQ-008, EDGE-006: getSnapshot always returns exactly 5 entries
  it("getSnapshot returns exactly 5 entries even when nothing is set (REQ-008/EDGE-006)", async () => {
    const store = createCollectorHealthStore(redis);
    const snapshot = await store.getSnapshot(T);
    expect(snapshot.collectors).toHaveLength(5);
  });

  // REQ-008, EDGE-006: unset collectors synthesize status:"never"
  it("unset collectors come back as status:never with all nulls (REQ-008/EDGE-006)", async () => {
    const store = createCollectorHealthStore(redis);
    const snapshot = await store.getSnapshot(T);
    for (const entry of snapshot.collectors) {
      expect(entry.status).toBe("never");
      expect(entry.trigger).toBeNull();
      expect(entry.checkedAt).toBeNull();
      expect(entry.durationMs).toBeNull();
      expect(entry.reason).toBeNull();
      expect(entry.detail).toBeNull();
    }
  });

  // REQ-008: snapshot entries are in HEALTH_CHECKABLE_COLLECTORS order
  it("getSnapshot entries are ordered per HEALTH_CHECKABLE_COLLECTORS (REQ-008)", async () => {
    const store = createCollectorHealthStore(redis);
    const snapshot = await store.getSnapshot(T);
    const returned = snapshot.collectors.map((c) => c.collector);
    expect(returned).toEqual([...HEALTH_CHECKABLE_COLLECTORS]);
  });

  // REQ-007: set uses NO TTL — assert ttl(key) === -1 (persistent)
  it("set stores the key with no TTL — ttl returns -1 (REQ-007)", async () => {
    const store = createCollectorHealthStore(redis);
    const result: CollectorHealthResult = {
      collector: "reddit",
      status: "healthy",
      trigger: "scheduled",
      checkedAt: "2026-06-03T12:00:00.000Z",
      durationMs: 200,
      reason: null,
      detail: null,
    };

    await store.set(T, result);
    const ttl = await redis.ttl(collectorHealthKey(T, "reddit"));
    expect(ttl).toBe(-1); // persistent, no expiry
  });

  // REQ-003: setRunning writes status:"running" with correct trigger and durationMs:null
  it("setRunning writes status:running, correct trigger, durationMs:null (REQ-003)", async () => {
    const store = createCollectorHealthStore(redis);
    const now = new Date("2026-06-03T10:00:00.000Z");

    await store.setRunning(T, "blog", "manual", now);
    const snapshot = await store.getSnapshot(T);

    const entry = snapshot.collectors.find((c) => c.collector === "blog");
    expect(entry).toBeDefined();
    expect(entry?.status).toBe("running");
    expect(entry?.trigger).toBe("manual");
    expect(entry?.checkedAt).toBe("2026-06-03T10:00:00.000Z");
    expect(entry?.durationMs).toBeNull();
    expect(entry?.reason).toBeNull();
    expect(entry?.detail).toBeNull();
  });

  // setRunning also has no TTL
  it("setRunning stores key with no TTL (REQ-007)", async () => {
    const store = createCollectorHealthStore(redis);
    await store.setRunning(T, "web_search", "scheduled", new Date());
    const ttl = await redis.ttl(collectorHealthKey(T, "web_search"));
    expect(ttl).toBe(-1);
  });

  // Malformed JSON at a key → synthesize "never" (defensive read at boundary)
  it("malformed JSON at a Redis key is treated as never (defensive read)", async () => {
    // Manually corrupt a key in the fake store
    await redis.set(collectorHealthKey(T, "hn"), "{this is not json}");

    const store = createCollectorHealthStore(redis);
    const snapshot = await store.getSnapshot(T);

    const entry = snapshot.collectors.find((c) => c.collector === "hn");
    expect(entry?.status).toBe("never");
    expect(entry?.trigger).toBeNull();
    expect(entry?.checkedAt).toBeNull();
  });

  // Partial snapshot: one set, rest never
  it("returns set collector alongside never-synthesized ones", async () => {
    const store = createCollectorHealthStore(redis);
    await store.set(T, {
      collector: "reddit",
      status: "healthy",
      trigger: "scheduled",
      checkedAt: "2026-06-03T09:00:00.000Z",
      durationMs: 500,
      reason: null,
      detail: null,
    });

    const snapshot = await store.getSnapshot(T);
    expect(snapshot.collectors).toHaveLength(5);

    const reddit = snapshot.collectors.find((c) => c.collector === "reddit");
    expect(reddit?.status).toBe("healthy");

    const others = snapshot.collectors.filter((c) => c.collector !== "reddit");
    for (const o of others) {
      expect(o.status).toBe("never");
    }
  });
});
