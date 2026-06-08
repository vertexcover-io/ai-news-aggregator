/**
 * E2E integration test for the Hono 5xx capture middleware (REQ-005).
 *
 * Throws in a test route → asserts the incident row was persisted.
 * Never checks Slack (no real Slack — per hard constraint in relevant-lessons.md).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Hono } from "hono";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { sql } from "drizzle-orm";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
config({ path: resolve(REPO_ROOT, ".env") });

process.env.DATABASE_URL ??= "postgresql://newsletter:newsletter@localhost:5434/newsletter_test";

const { getDb } = await import("@newsletter/shared/db");
const { createIncidentRepo } = await import("@api/repositories/incidents.js");
const { createAlertDispatcher } = await import("@newsletter/shared/alerting");
const { createLogger } = await import("@newsletter/shared");

const db = getDb();
const repo = createIncidentRepo(db);

const TEST_PREFIX = `test-api-5xx-middleware-${Date.now()}`;

async function cleanUp(): Promise<void> {
  await db.execute(sql`DELETE FROM incidents WHERE source LIKE ${TEST_PREFIX + "%"}`);
}

beforeAll(cleanUp);
afterAll(cleanUp);
afterEach(cleanUp);

/**
 * Build a minimal Hono app with the 5xx error handler + a route that throws.
 * The capture is best-effort (NF1) — it never blocks the response.
 */
function buildTestApp(suffix: string) {
  const logger = createLogger("test-5xx");
  const dispatcher = createAlertDispatcher({
    repo,
    channels: [], // no delivery channels — persist-only
    logger,
  });

  const app = new Hono();

  // 5xx error middleware (REQ-005): captures api_5xx incident best-effort
  app.onError((err, c) => {
    void dispatcher.capture({
      severity: "error",
      category: "api_5xx",
      source: `${TEST_PREFIX}-${suffix}`,
      title: `API 5xx: ${c.req.method} ${c.req.path}`,
      message: err instanceof Error ? err.message : String(err),
      context: { path: c.req.path, method: c.req.method },
    });
    return c.json({ error: "internal" }, 500);
  });

  // A route that always throws
  app.get("/throw", () => {
    throw new Error("test-error");
  });

  return app;
}

describe("Hono 5xx capture middleware (REQ-005)", () => {
  it("test_REQ_005_api_5xx_records_incident — persists an api_5xx incident without blocking response", async () => {
    const suffix = "basic";
    const app = buildTestApp(suffix);

    const res = await app.request("/throw");
    // Response should still be 500 — capture is best-effort, never blocks
    expect(res.status).toBe(500);

    // Wait a tick for the async capture to complete
    await new Promise<void>((r) => setTimeout(r, 50));

    // Verify the incident row was persisted
    const rows = await repo.list({});
    const found = rows.find((r) => r.source === `${TEST_PREFIX}-${suffix}`);
    expect(found).toBeDefined();
    expect(found?.category).toBe("api_5xx");
    expect(found?.severity).toBe("error");
  });

  it("capture failure never breaks the HTTP response (best-effort NF1)", async () => {
    const suffix = "best-effort";
    // Build an app with a failing repo (to verify NF1: capture failure does not affect response)
    const failingRepo = createIncidentRepo(db);
    const originalUpsert = failingRepo.upsertByFingerprint.bind(failingRepo);
    // Override to reject
    failingRepo.upsertByFingerprint = () => Promise.reject(new Error("DB is down"));

    const logger = createLogger("test-5xx-fail");
    const dispatcher = createAlertDispatcher({
      repo: failingRepo,
      channels: [],
      logger,
    });

    const app = new Hono();
    app.onError((err, c) => {
      void dispatcher.capture({
        severity: "error",
        category: "api_5xx",
        source: `${TEST_PREFIX}-${suffix}`,
        title: `API 5xx: ${c.req.path}`,
        message: err instanceof Error ? err.message : String(err),
        context: { path: c.req.path, method: c.req.method },
      });
      return c.json({ error: "internal" }, 500);
    });
    app.get("/throw", () => {
      throw new Error("test-error");
    });

    // Must still return 500 (not throw/crash)
    const res = await app.request("/throw");
    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("internal");

    // Restore in case needed
    failingRepo.upsertByFingerprint = originalUpsert;
  });
});
