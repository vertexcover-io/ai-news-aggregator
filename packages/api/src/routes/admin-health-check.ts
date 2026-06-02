import { Hono } from "hono";
import { Queue } from "bullmq";
import type { CollectorType, HealthCheckJobData } from "@newsletter/shared/types";

export const ALL_COLLECTORS: CollectorType[] = [
  "hn",
  "reddit",
  "twitter",
  "web_search",
  "blog",
];

const COLLECTOR_TYPE_SET = new Set<string>(ALL_COLLECTORS);

export interface HealthCheckRouterDeps {
  processingQueue: Queue;
}

export function createHealthCheckRouter(deps: HealthCheckRouterDeps): Hono {
  const router = new Hono();

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
