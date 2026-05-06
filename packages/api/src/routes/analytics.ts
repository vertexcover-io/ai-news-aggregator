import { Hono } from "hono";
import { createLogger, getDb } from "@newsletter/shared";
import { createAnalyticsRepo, type AnalyticsRepo } from "@api/repositories/analytics.js";

export interface AnalyticsRouterDeps {
  analyticsRepo: AnalyticsRepo;
  logger?: ReturnType<typeof createLogger>;
}

export function createAnalyticsRouter(deps: AnalyticsRouterDeps): Hono {
  const app = new Hono();
  const logger = deps.logger ?? createLogger("api:analytics");

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
      logger.warn(
        { event: "analytics.invalid_date", fromStr, toStr },
        "analytics: invalid date in query",
      );
      return c.json({ error: "invalid_date" }, 400);
    }
    if (from > to) {
      logger.warn(
        { event: "analytics.from_after_to", from: from.toISOString(), to: to.toISOString() },
        "analytics: from is after to",
      );
      return c.json({ error: "from_after_to" }, 400);
    }

    const startedAt = Date.now();
    const metrics = await deps.analyticsRepo.getMetrics({ from, to });
    logger.info(
      {
        event: "analytics.fetched",
        from: from.toISOString(),
        to: to.toISOString(),
        granularity,
        durationMs: Date.now() - startedAt,
        totalSubscriptions: metrics.totalSubscriptions,
        totalUnsubscriptions: metrics.totalUnsubscriptions,
        emailsSent: metrics.emailsSent,
        bounces: metrics.bounces,
        complaints: metrics.complaints,
        opens: metrics.opens,
        clicks: metrics.clicks,
      },
      "analytics: metrics fetched",
    );
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
