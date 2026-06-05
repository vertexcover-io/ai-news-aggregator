import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import type { AnalyticsMetrics } from "@newsletter/shared";
import { createAnalyticsRouter } from "@api/routes/analytics.js";
import type { AnalyticsRepo } from "@api/repositories/analytics.js";

interface MetricsResult {
  totalSubscriptions: number;
  totalUnsubscriptions: number;
  emailsSent: number;
  bounces: number;
  complaints: number;
  opens: number;
  clicks: number;
}

function makeRepo(metrics: Partial<MetricsResult> = {}): AnalyticsRepo {
  return {
    getMetrics: () =>
      Promise.resolve({
        totalSubscriptions: metrics.totalSubscriptions ?? 0,
        totalUnsubscriptions: metrics.totalUnsubscriptions ?? 0,
        emailsSent: metrics.emailsSent ?? 0,
        bounces: metrics.bounces ?? 0,
        complaints: metrics.complaints ?? 0,
        opens: metrics.opens ?? 0,
        clicks: metrics.clicks ?? 0,
      }),
  };
}

function buildApp(repo: AnalyticsRepo): Hono {
  const app = new Hono();
  app.route("/api/admin/analytics", createAnalyticsRouter({ analyticsRepo: repo }));
  return app;
}

describe("GET /api/admin/analytics", () => {
  it("REQ-A01: returns 200 with all 7 metrics", async () => {
    const repo = makeRepo({
      totalSubscriptions: 10,
      totalUnsubscriptions: 2,
      emailsSent: 50,
      bounces: 1,
      complaints: 0,
      opens: 30,
      clicks: 15,
    });
    const app = buildApp(repo);
    const res = await app.request("/api/admin/analytics");
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnalyticsMetrics;
    expect(body.totalSubscriptions).toBe(10);
    expect(body.totalUnsubscriptions).toBe(2);
    expect(body.emailsSent).toBe(50);
    expect(body.bounces).toBe(1);
    expect(body.complaints).toBe(0);
    expect(body.opens).toBe(30);
    expect(body.clicks).toBe(15);
    expect(body.period).toBeDefined();
    expect(body.period.granularity).toBe("daily");
  });

  it("REQ-A02: returns 400 when from > to", async () => {
    const app = buildApp(makeRepo());
    const res = await app.request(
      "/api/admin/analytics?from=2026-01-01&to=2025-12-01",
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("from_after_to");
  });

  it.each<{ name: string; query: string }>([
    { name: "REQ-A03: from is invalid date", query: "?from=invalid" },
    { name: "REQ-A05: to is invalid date", query: "?to=not-a-date" },
  ])("returns 400 when $name", async ({ query }) => {
    const app = buildApp(makeRepo());
    const res = await app.request(`/api/admin/analytics${query}`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_date");
  });

  it("REQ-A04: uses last 30 days as default range when no params", async () => {
    const app = buildApp(makeRepo());
    const res = await app.request("/api/admin/analytics");
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnalyticsMetrics;
    const fromDate = new Date(body.period.from);
    const toDate = new Date(body.period.to);
    const diffMs = toDate.getTime() - fromDate.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeCloseTo(30, 0);
  });

  it("REQ-A06: respects granularity query param", async () => {
    const app = buildApp(makeRepo());
    const res = await app.request(
      "/api/admin/analytics?granularity=monthly",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnalyticsMetrics;
    expect(body.period.granularity).toBe("monthly");
  });

  it("REQ-A07: period from/to are ISO strings", async () => {
    const app = buildApp(makeRepo());
    const res = await app.request(
      "/api/admin/analytics?from=2026-01-01&to=2026-02-01",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnalyticsMetrics;
    expect(body.period.from).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.period.to).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
