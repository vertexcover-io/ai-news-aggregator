import type {
  CollectorHealthResult,
  CollectorHealthSnapshot,
  CollectorHealthTrigger,
  HealthCheckCollector,
} from "../types/collector-health.js";
import {
  collectorHealthKey,
  HEALTH_CHECKABLE_COLLECTORS,
} from "../constants/index.js";

interface RedisLike {
  set(key: string, value: string): Promise<unknown>;
  mget(...keys: string[]): Promise<(string | null)[]>;
}

// Every operation is tenant-scoped (the Redis key embeds the tenantId) so one
// tenant's collector-health result never surfaces in another's snapshot.
export interface CollectorHealthStore {
  set(tenantId: string, result: CollectorHealthResult): Promise<void>;
  setRunning(
    tenantId: string,
    collector: HealthCheckCollector,
    trigger: CollectorHealthTrigger,
    now: Date,
  ): Promise<void>;
  getSnapshot(tenantId: string): Promise<CollectorHealthSnapshot>;
}

const NEVER_ENTRY = (collector: HealthCheckCollector): CollectorHealthResult => ({
  collector,
  status: "never",
  trigger: null,
  checkedAt: null,
  durationMs: null,
  reason: null,
  detail: null,
});

function parseOrNever(
  raw: string | null,
  collector: HealthCheckCollector,
): CollectorHealthResult {
  if (raw === null) return NEVER_ENTRY(collector);
  try {
    return JSON.parse(raw) as CollectorHealthResult;
  } catch {
    return NEVER_ENTRY(collector);
  }
}

export function createCollectorHealthStore(redis: RedisLike): CollectorHealthStore {
  return {
    async set(tenantId: string, result: CollectorHealthResult): Promise<void> {
      // No "EX" — persists forever (REQ-007)
      await redis.set(
        collectorHealthKey(tenantId, result.collector),
        JSON.stringify(result),
      );
    },

    async setRunning(
      tenantId: string,
      collector: HealthCheckCollector,
      trigger: CollectorHealthTrigger,
      now: Date,
    ): Promise<void> {
      const placeholder: CollectorHealthResult = {
        collector,
        status: "running",
        trigger,
        checkedAt: now.toISOString(),
        durationMs: null,
        reason: null,
        detail: null,
      };
      // No "EX" — persists forever (REQ-007)
      await redis.set(
        collectorHealthKey(tenantId, collector),
        JSON.stringify(placeholder),
      );
    },

    async getSnapshot(tenantId: string): Promise<CollectorHealthSnapshot> {
      const keys = HEALTH_CHECKABLE_COLLECTORS.map((c) =>
        collectorHealthKey(tenantId, c),
      );
      const values = await redis.mget(...keys);
      const collectors = HEALTH_CHECKABLE_COLLECTORS.map((c, i) =>
        parseOrNever(values[i] ?? null, c),
      );
      return { collectors };
    },
  };
}
