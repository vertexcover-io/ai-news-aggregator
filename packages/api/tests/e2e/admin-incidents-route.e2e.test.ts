/**
 * E2E integration tests for GET/PATCH /api/admin/incidents against the real DB.
 *
 * REQ-020: list + filter.
 * REQ-021: PATCH updates status + GET reflects the change.
 * REQ-023: unauthenticated → 401.
 * EDGE-009: invalid status → 400.
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
const { createAdminIncidentsRouter } = await import("@api/routes/admin-incidents.js");
const { requireAdmin } = await import("@api/auth/middleware.js");
const { issueToken, COOKIE_NAME } = await import("@api/auth/session.js");

const db = getDb();
const repo = createIncidentRepo(db);

const SESSION_SECRET = "test-session-secret-incidents-e2e";
const TEST_PREFIX = `test-admin-incidents-route-${Date.now()}`;

async function cleanUp(): Promise<void> {
  await db.execute(sql`DELETE FROM incidents WHERE source LIKE ${TEST_PREFIX + "%"}`);
}

beforeAll(cleanUp);
afterAll(cleanUp);
afterEach(cleanUp);

function makeToken() {
  return issueToken(SESSION_SECRET);
}

function makeAuthHeader() {
  return { cookie: `${COOKIE_NAME}=${makeToken()}` };
}

function buildApp() {
  const app = new Hono();
  const gate = requireAdmin(SESSION_SECRET);
  app.use("/api/admin/incidents/*", gate);
  app.use("/api/admin/incidents", gate);
  app.route(
    "/api/admin/incidents",
    createAdminIncidentsRouter({ getRepo: () => repo }),
  );
  return app;
}

function seedIncident(suffix: string, overrides: Record<string, unknown> = {}) {
  return repo.upsertByFingerprint(
    {
      severity: (overrides.severity as "error") ?? "error",
      category: (overrides.category as "api_5xx") ?? "api_5xx",
      title: `Test incident ${suffix}`,
      message: `Message for ${suffix}`,
      source: `${TEST_PREFIX}-${suffix}`,
      ...overrides,
    },
    3_600_000,
  );
}

describe("GET /api/admin/incidents (route + real DB)", () => {
  it("returns 401 without auth token", async () => {
    const app = buildApp();
    const res = await app.request("/api/admin/incidents");
    expect(res.status).toBe(401);
  });

  it("test_REQ_020_list_incidents_filtered — returns 200 with list + applies severity filter", async () => {
    const app = buildApp();
    await seedIncident("list-err", { severity: "error" });
    await seedIncident("list-warn", { severity: "warning", category: "run_degraded" });

    const res = await app.request("/api/admin/incidents?severity=error", {
      headers: makeAuthHeader(),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { severity: string; source: string }[];
    const ours = body.filter((r) => r.source?.startsWith(`${TEST_PREFIX}-list`));
    expect(ours.length).toBe(1);
    expect(ours[0].severity).toBe("error");
  });

  it("returns 400 on invalid status query param", async () => {
    const app = buildApp();
    const res = await app.request("/api/admin/incidents?status=BOGUS", {
      headers: makeAuthHeader(),
    });
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/admin/incidents/:id (route + real DB)", () => {
  it("test_REQ_021_patch_status_updates_incident — updates status and GET reflects the change", async () => {
    const app = buildApp();
    const { id } = await seedIncident("patch-test");

    const patchRes = await app.request(`/api/admin/incidents/${id}`, {
      method: "PATCH",
      headers: { ...makeAuthHeader(), "content-type": "application/json" },
      body: JSON.stringify({ status: "resolved" }),
    });
    expect(patchRes.status).toBe(200);
    const updated = await patchRes.json() as { status: string };
    expect(updated.status).toBe("resolved");

    // Verify GET reflects new status
    const getRes = await app.request("/api/admin/incidents?status=resolved", {
      headers: makeAuthHeader(),
    });
    const rows = await getRes.json() as { id: string; status: string }[];
    const found = rows.find((r) => r.id === id);
    expect(found?.status).toBe("resolved");
  });

  it("test_EDGE_009_patch_invalid_status_400 — invalid status → 400", async () => {
    const app = buildApp();
    const { id } = await seedIncident("bad-status");

    const res = await app.request(`/api/admin/incidents/${id}`, {
      method: "PATCH",
      headers: { ...makeAuthHeader(), "content-type": "application/json" },
      body: JSON.stringify({ status: "INVALID_STATUS" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 for a non-existent UUID", async () => {
    const app = buildApp();
    const res = await app.request(
      "/api/admin/incidents/00000000-dead-beef-0000-000000000000",
      {
        method: "PATCH",
        headers: { ...makeAuthHeader(), "content-type": "application/json" },
        body: JSON.stringify({ status: "resolved" }),
      },
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 for a non-UUID id string", async () => {
    const app = buildApp();
    const res = await app.request("/api/admin/incidents/not-a-uuid", {
      method: "PATCH",
      headers: { ...makeAuthHeader(), "content-type": "application/json" },
      body: JSON.stringify({ status: "resolved" }),
    });
    expect(res.status).toBe(404);
  });
});
