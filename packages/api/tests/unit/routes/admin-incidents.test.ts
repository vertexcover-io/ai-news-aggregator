/**
 * Unit tests for GET /api/admin/incidents and PATCH /api/admin/incidents/:id.
 *
 * REQ-020: list returns incidents filtered by status/severity newest-first.
 * REQ-021: PATCH updates status; invalid status → 400; unknown id → 404.
 * REQ-023: routes require admin auth → 401 unauthenticated.
 * EDGE-009: PATCH with invalid status → 400.
 */
import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { requireAdmin } from "@api/auth/middleware.js";
import { issueToken, COOKIE_NAME } from "@api/auth/session.js";
import {
  createAdminIncidentsRouter,
} from "@api/routes/admin-incidents.js";
import type { IncidentRepository, Incident } from "@newsletter/shared/alerting";

const SESSION_SECRET = "test-session-secret-for-incidents";

function makeToken() {
  return issueToken(SESSION_SECRET);
}

function makeAuthHeader() {
  return { cookie: `${COOKIE_NAME}=${makeToken()}` };
}

function makeIncident(overrides: Partial<Incident> = {}): Incident {
  const now = new Date();
  return {
    id: "aaaaaaaa-0000-0000-0000-000000000001",
    fingerprint: "test-fp-1",
    severity: "error",
    category: "api_5xx",
    title: "Test Incident",
    message: "Something went wrong",
    source: "test-source",
    runId: null,
    context: { path: "/api/test" },
    status: "open",
    occurrences: 1,
    deliveryAttempts: 0,
    firstSeenAt: now,
    lastSeenAt: now,
    notifiedAt: null,
    ...overrides,
  };
}

function makeRepo(overrides: Partial<IncidentRepository> = {}): IncidentRepository {
  return {
    upsertByFingerprint: vi.fn(),
    markDelivered: vi.fn(),
    incrementDeliveryAttempts: vi.fn(),
    listUndelivered: vi.fn().mockResolvedValue([]),
    list: vi.fn().mockResolvedValue([]),
    setStatus: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

function makeApp(repo: IncidentRepository) {
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

describe("GET /api/admin/incidents", () => {
  it("test_REQ_023_incidents_routes_require_admin — returns 401 without auth", async () => {
    const repo = makeRepo();
    const app = makeApp(repo);
    const res = await app.request("/api/admin/incidents");
    expect(res.status).toBe(401);
  });

  it("returns 200 with incident list when authenticated", async () => {
    const incident = makeIncident();
    const repo = makeRepo({ list: vi.fn().mockResolvedValue([incident]) });
    const app = makeApp(repo);
    const res = await app.request("/api/admin/incidents", {
      headers: makeAuthHeader(),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Incident[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(1);
  });

  it("passes status query param to repo.list", async () => {
    const listSpy = vi.fn().mockResolvedValue([]);
    const repo = makeRepo({ list: listSpy });
    const app = makeApp(repo);
    await app.request("/api/admin/incidents?status=open", {
      headers: makeAuthHeader(),
    });
    expect(listSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: "open" }),
    );
  });

  it("passes severity query param to repo.list", async () => {
    const listSpy = vi.fn().mockResolvedValue([]);
    const repo = makeRepo({ list: listSpy });
    const app = makeApp(repo);
    await app.request("/api/admin/incidents?severity=critical", {
      headers: makeAuthHeader(),
    });
    expect(listSpy).toHaveBeenCalledWith(
      expect.objectContaining({ severity: "critical" }),
    );
  });

  it("returns 400 on invalid status query param", async () => {
    const repo = makeRepo();
    const app = makeApp(repo);
    const res = await app.request("/api/admin/incidents?status=INVALID_STATUS", {
      headers: makeAuthHeader(),
    });
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/admin/incidents/:id", () => {
  it("test_REQ_023_incidents_routes_require_admin — PATCH returns 401 without auth", async () => {
    const repo = makeRepo();
    const app = makeApp(repo);
    const res = await app.request("/api/admin/incidents/aaaaaaaa-0000-0000-0000-000000000001", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "resolved" }),
    });
    expect(res.status).toBe(401);
  });

  it("test_REQ_021_patch_status_updates_incident — returns 200 with updated incident", async () => {
    const updated = makeIncident({ status: "resolved" });
    const repo = makeRepo({ setStatus: vi.fn().mockResolvedValue(updated) });
    const app = makeApp(repo);
    const res = await app.request(
      "/api/admin/incidents/aaaaaaaa-0000-0000-0000-000000000001",
      {
        method: "PATCH",
        headers: { ...makeAuthHeader(), "content-type": "application/json" },
        body: JSON.stringify({ status: "resolved" }),
      },
    );
    expect(res.status).toBe(200);
    const body = await res.json() as Incident;
    expect(body.status).toBe("resolved");
  });

  it("test_EDGE_009_patch_invalid_status_400 — returns 400 on invalid status", async () => {
    const repo = makeRepo();
    const app = makeApp(repo);
    const res = await app.request(
      "/api/admin/incidents/aaaaaaaa-0000-0000-0000-000000000001",
      {
        method: "PATCH",
        headers: { ...makeAuthHeader(), "content-type": "application/json" },
        body: JSON.stringify({ status: "INVALID" }),
      },
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 for non-UUID id", async () => {
    const repo = makeRepo();
    const app = makeApp(repo);
    const res = await app.request("/api/admin/incidents/not-a-uuid", {
      method: "PATCH",
      headers: { ...makeAuthHeader(), "content-type": "application/json" },
      body: JSON.stringify({ status: "resolved" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 when setStatus returns null (not found)", async () => {
    const repo = makeRepo({ setStatus: vi.fn().mockResolvedValue(null) });
    const app = makeApp(repo);
    const res = await app.request(
      "/api/admin/incidents/aaaaaaaa-0000-0000-0000-000000000001",
      {
        method: "PATCH",
        headers: { ...makeAuthHeader(), "content-type": "application/json" },
        body: JSON.stringify({ status: "muted" }),
      },
    );
    expect(res.status).toBe(404);
  });
});
