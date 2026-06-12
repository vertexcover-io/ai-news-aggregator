import { describe, expect, it, beforeEach } from "vitest";
import type { CollectorHealthResult } from "@shared/types/index.js";
import {
  collectorHealthKey,
  HEALTH_CHECKABLE_COLLECTORS,
} from "@shared/constants/index.js";
import { createCollectorHealthStore } from "@shared/services/collector-health-store.js";

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

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

describe("createCollectorHealthStore", () => {
  let redis: FakeRedis;

  beforeEach(() => {
    redis = new FakeRedis();
  });

  // REQ-005, REQ-006: set then getSnapshot round-trips a healthy result
  it("set then getSnapshot returns the stored healthy result (REQ-005/REQ-006)", async () => {
    const store = createCollectorHealthStore(redis, TENANT_A);
    const result: CollectorHealthResult = {
      collector: "hn",
      status: "healthy",
      trigger: "manual",
      checkedAt: "2026-06-03T12:00:00.000Z",
      durationMs: 350,
      reason: null,
      detail: "Fetched 10 items",
    };

    await store.set(result);
    const snapshot = await store.getSnapshot();

    const entry = snapshot.collectors.find((c) => c.collector === "hn");
    expect(entry).toEqual(result);
  });

  // REQ-005, REQ-006: set then getSnapshot round-trips a failed result
  it("set then getSnapshot returns the stored failed result (REQ-005/REQ-006)", async () => {
    const store = createCollectorHealthStore(redis, TENANT_A);
    const result: CollectorHealthResult = {
      collector: "twitter",
      status: "failed",
      trigger: "scheduled",
      checkedAt: "2026-06-03T11:00:00.000Z",
      durationMs: 1200,
      reason: "Twitter auth failed",
      detail: "HTTP 401",
    };

    await store.set(result);
    const snapshot = await store.getSnapshot();

    const entry = snapshot.collectors.find((c) => c.collector === "twitter");
    expect(entry).toEqual(result);
  });

  // REQ-008, EDGE-006: getSnapshot always returns exactly 5 entries
  it("getSnapshot returns exactly 5 entries even when nothing is set (REQ-008/EDGE-006)", async () => {
    const store = createCollectorHealthStore(redis, TENANT_A);
    const snapshot = await store.getSnapshot();
    expect(snapshot.collectors).toHaveLength(5);
  });

  // REQ-008, EDGE-006: unset collectors synthesize status:"never"
  it("unset collectors come back as status:never with all nulls (REQ-008/EDGE-006)", async () => {
    const store = createCollectorHealthStore(redis, TENANT_A);
    const snapshot = await store.getSnapshot();
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
    const store = createCollectorHealthStore(redis, TENANT_A);
    const snapshot = await store.getSnapshot();
    const returned = snapshot.collectors.map((c) => c.collector);
    expect(returned).toEqual([...HEALTH_CHECKABLE_COLLECTORS]);
  });

  // REQ-007: set uses NO TTL — assert ttl(key) === -1 (persistent)
  it("set stores the key with no TTL — ttl returns -1 (REQ-007)", async () => {
    const store = createCollectorHealthStore(redis, TENANT_A);
    const result: CollectorHealthResult = {
      collector: "reddit",
      status: "healthy",
      trigger: "scheduled",
      checkedAt: "2026-06-03T12:00:00.000Z",
      durationMs: 200,
      reason: null,
      detail: null,
    };

    await store.set(result);
    const ttl = await redis.ttl(collectorHealthKey(TENANT_A, "reddit"));
    expect(ttl).toBe(-1); // persistent, no expiry
  });

  // REQ-003: setRunning writes status:"running" with correct trigger and durationMs:null
  it("setRunning writes status:running, correct trigger, durationMs:null (REQ-003)", async () => {
    const store = createCollectorHealthStore(redis, TENANT_A);
    const now = new Date("2026-06-03T10:00:00.000Z");

    await store.setRunning("blog", "manual", now);
    const snapshot = await store.getSnapshot();

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
    const store = createCollectorHealthStore(redis, TENANT_A);
    await store.setRunning("web_search", "scheduled", new Date());
    const ttl = await redis.ttl(collectorHealthKey(TENANT_A, "web_search"));
    expect(ttl).toBe(-1);
  });

  // Malformed JSON at a key → synthesize "never" (defensive read at boundary)
  it("malformed JSON at a Redis key is treated as never (defensive read)", async () => {
    // Manually corrupt a key in the fake store
    await redis.set(collectorHealthKey(TENANT_A, "hn"), "{this is not json}");

    const store = createCollectorHealthStore(redis, TENANT_A);
    const snapshot = await store.getSnapshot();

    const entry = snapshot.collectors.find((c) => c.collector === "hn");
    expect(entry?.status).toBe("never");
    expect(entry?.trigger).toBeNull();
    expect(entry?.checkedAt).toBeNull();
  });

  // Cross-tenant isolation: scheduler.ts creates one scheduled collector-health
  // job PER TENANT, so results must land under tenant-scoped keys — tenant B's
  // check must not clobber tenant A's snapshot or leak reason/detail strings.
  it(
    "keeps one tenant's snapshot isolated from another tenant's scheduled check",
    async () => {
      const tenantAStore = createCollectorHealthStore(redis, TENANT_A);
      const tenantBStore = createCollectorHealthStore(redis, TENANT_B);

      await tenantAStore.set({
        collector: "reddit",
        status: "healthy",
        trigger: "scheduled",
        checkedAt: "2026-06-10T09:00:00.000Z",
        durationMs: 200,
        reason: null,
        detail: null,
      });
      await tenantBStore.set({
        collector: "reddit",
        status: "failed",
        trigger: "scheduled",
        checkedAt: "2026-06-10T09:05:00.000Z",
        durationMs: 900,
        reason: "tenant-b: r/secretsub returned 403",
        detail: null,
      });

      const tenantASnapshot = await tenantAStore.getSnapshot();
      const reddit = tenantASnapshot.collectors.find(
        (c) => c.collector === "reddit",
      );
      expect(reddit?.status).toBe("healthy");
      expect(reddit?.reason ?? "").not.toContain("tenant-b");
    },
  );

  // Partial snapshot: one set, rest never
  it("returns set collector alongside never-synthesized ones", async () => {
    const store = createCollectorHealthStore(redis, TENANT_A);
    await store.set({
      collector: "reddit",
      status: "healthy",
      trigger: "scheduled",
      checkedAt: "2026-06-03T09:00:00.000Z",
      durationMs: 500,
      reason: null,
      detail: null,
    });

    const snapshot = await store.getSnapshot();
    expect(snapshot.collectors).toHaveLength(5);

    const reddit = snapshot.collectors.find((c) => c.collector === "reddit");
    expect(reddit?.status).toBe("healthy");

    const others = snapshot.collectors.filter((c) => c.collector !== "reddit");
    for (const o of others) {
      expect(o.status).toBe("never");
    }
  });
});
