import { Hono } from "hono";
import { Queue } from "bullmq";
import type IORedis from "ioredis";
import type { CollectorType, HealthCheckJobData, HealthCheckReport } from "@newsletter/shared/types";

export const ALL_COLLECTORS: CollectorType[] = [
  "hn",
  "reddit",
  "twitter",
  "web_search",
  "blog",
];

const COLLECTOR_TYPE_SET = new Set<string>(ALL_COLLECTORS);
const HEALTH_CHECK_LATEST_KEY = "health-check:latest";

export interface HealthCheckRouterDeps {
  processingQueue: Queue;
  redis?: IORedis;
}

export function createHealthCheckRouter(deps: HealthCheckRouterDeps): Hono {
  const router = new Hono();

  // GET /status — fetch latest health check results
  router.get("/status", async (c) => {
    if (!deps.redis) {
      return c.json(null, 200);
    }
    try {
      const raw = await deps.redis.get(HEALTH_CHECK_LATEST_KEY);
      if (!raw) {
        return c.json(null, 200);
      }
      const report = JSON.parse(raw) as HealthCheckReport & { storedAt?: string };
      return c.json(report, 200);
    } catch {
      return c.json(null, 200);
    }
  });

  // POST / — trigger health check for all collectors
  router.post("/", async (c) => {
    const job = await deps.processingQueue.add("health-check", {
      collectorType: undefined,
      triggeredBy: "manual",
    } satisfies HealthCheckJobData);
    return c.json({ jobId: job.id, collectors: ALL_COLLECTORS }, 202);
  });

  // POST /:collectorType — trigger health check for a single collector
  router.post("/:collectorType", async (c) => {
    const raw = c.req.param("collectorType");
    if (!COLLECTOR_TYPE_SET.has(raw)) {
      return c.json(
        {
          error: `invalid collector type '${raw}': must be one of ${ALL_COLLECTORS.join(", ")}`,
        },
        400,
      );
    }
    const collectorType = raw as CollectorType;
    const job = await deps.processingQueue.add("health-check", {
      collectorType,
      triggeredBy: "manual",
    } satisfies HealthCheckJobData);
    return c.json({ jobId: job.id, collector: collectorType }, 202);
  });

  return router;
}
