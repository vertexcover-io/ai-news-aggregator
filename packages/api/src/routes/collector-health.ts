import { Hono } from "hono";
import { z } from "zod";
import { Queue } from "bullmq";
import {
  COLLECTOR_HEALTH_QUEUE_NAME,
  HEALTH_CHECKABLE_COLLECTORS,
  createRedisConnection,
} from "@newsletter/shared";
import {
  createCollectorHealthStore,
  type CollectorHealthStore,
} from "@newsletter/shared/services";
import type { HealthCheckCollector } from "@newsletter/shared/types";
import type { UserSettings } from "@newsletter/shared";
import type { TenantScope } from "@newsletter/shared/types/tenant-context";
import { tenantScopeFromContext } from "@api/auth/tenant-scope.js";

export interface CollectorHealthRouterDeps {
  collectorHealthQueue: Pick<Queue, "add">;
  store: CollectorHealthStore;
  /**
   * Settings of the SESSION tenant (the route is requireAuth-gated). An
   * unscoped read would return an arbitrary tenant's row now that every
   * user_settings row carries `singleton = true` (0041).
   */
  getSettings: (scope?: TenantScope) => Promise<UserSettings | null>;
}

const checkBodySchema = z.object({
  collector: z
    .enum(HEALTH_CHECKABLE_COLLECTORS)
    .optional(),
});

function enabledCollectors(settings: UserSettings): HealthCheckCollector[] {
  const result: HealthCheckCollector[] = [];
  if (settings.hnEnabled) result.push("hn");
  if (settings.redditEnabled) result.push("reddit");
  if (settings.twitterEnabled) result.push("twitter");
  if (settings.webEnabled) result.push("blog");
  if (settings.webSearchEnabled) result.push("web_search");
  return result;
}

export function createCollectorHealthRouter(deps: CollectorHealthRouterDeps): Hono {
  const app = new Hono();

  app.post("/check", async (c) => {
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      rawBody = {};
    }

    const parsed = checkBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json({ error: parsed.error.message }, 400);
    }

    let targets: HealthCheckCollector[];
    if (parsed.data.collector !== undefined) {
      // EDGE-013: explicit collector allowed even if disabled
      targets = [parsed.data.collector];
    } else {
      // REQ-002: absent -> all enabled from settings
      const settings = await deps.getSettings(tenantScopeFromContext(c));
      targets = settings !== null ? enabledCollectors(settings) : [];
    }

    const now = new Date();
    for (const collector of targets) {
      await deps.store.setRunning(collector, "manual", now);
    }

    if (targets.length > 0) {
      await deps.collectorHealthQueue.add("collector-health", {
        collectors: targets,
        trigger: "manual",
      });
    }

    return c.json({ enqueued: targets }, 202);
  });

  app.get("/", async (c) => {
    const snapshot = await deps.store.getSnapshot();
    return c.json(snapshot);
  });

  return app;
}

let defaultCollectorHealthQueue: Queue | null = null;
function getDefaultCollectorHealthQueue(): Queue {
  defaultCollectorHealthQueue ??= new Queue(COLLECTOR_HEALTH_QUEUE_NAME, {
    connection: createRedisConnection(),
  });
  return defaultCollectorHealthQueue;
}

export function createDefaultCollectorHealthRouter(): Hono {
  const redis = createRedisConnection();
  return createCollectorHealthRouter({
    collectorHealthQueue: getDefaultCollectorHealthQueue(),
    store: createCollectorHealthStore(redis),
    getSettings: async (scope) => {
      // Settings are read lazily per-request — no startup caching
      // to honour the "takes effect without restart" freshness promise.
      const { createUserSettingsRepo } = await import("@api/repositories/user-settings.js");
      const { getDb } = await import("@newsletter/shared");
      return createUserSettingsRepo(getDb(), scope).get();
    },
  });
}
