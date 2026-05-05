import { Hono } from "hono";
import { getDb } from "@newsletter/shared";
import { createAnalyticsRepo, type AnalyticsRepo } from "@api/repositories/analytics.js";

export interface AnalyticsRouterDeps {
  analyticsRepo: AnalyticsRepo;
}

export function createAnalyticsRouter(deps: AnalyticsRouterDeps): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const fromStr = c.req.query("from");
    const toStr = c.req.query("to");
    const rawGranularity = c.req.query("granularity") ?? "daily";
    const VALID_GRANULARITIES = ["daily", "weekly", "monthly"] as const;
    const granularity: "daily" | "weekly" | "monthly" = (
      VALID_GRANULARITIES as readonly string[]
    ).includes(rawGranularity)
      ? (rawGranularity as "daily" | "weekly" | "monthly")
      : "daily";

    const to = toStr ? new Date(toStr) : new Date();
    const from = fromStr ? new Date(fromStr) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      return c.json({ error: "invalid_date" }, 400);
    }
    if (from > to) {
      return c.json({ error: "from_after_to" }, 400);
    }

    const metrics = await deps.analyticsRepo.getMetrics({ from, to });
    return c.json({
      ...metrics,
      period: { from: from.toISOString(), to: to.toISOString(), granularity },
    });
  });

  return app;
}

export function createDefaultAnalyticsRouter(): Hono {
  return createAnalyticsRouter({ analyticsRepo: createAnalyticsRepo(getDb()) });
}
