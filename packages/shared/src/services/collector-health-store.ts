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

export interface CollectorHealthStore {
  set(result: CollectorHealthResult): Promise<void>;
  setRunning(
    collector: HealthCheckCollector,
    trigger: CollectorHealthTrigger,
    now: Date,
  ): Promise<void>;
  getSnapshot(): Promise<CollectorHealthSnapshot>;
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

// Tenant-scoped: per-tenant scheduled checks would otherwise clobber each
// other's snapshots (and leak reason/detail strings across tenants).
export function createCollectorHealthStore(
  redis: RedisLike,
  tenantId: string,
): CollectorHealthStore {
  return {
    async set(result: CollectorHealthResult): Promise<void> {
      // No "EX" — persists forever (REQ-007)
      await redis.set(
        collectorHealthKey(tenantId, result.collector),
        JSON.stringify(result),
      );
    },

    async setRunning(
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

    async getSnapshot(): Promise<CollectorHealthSnapshot> {
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
