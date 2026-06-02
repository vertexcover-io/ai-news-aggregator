import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { Queue } from "bullmq";
import { requireAdmin } from "../../auth/middleware.js";
import {
  createHealthCheckRouter,
  ALL_COLLECTORS,
} from "../admin-health-check.js";
import { issueToken, COOKIE_NAME } from "../../auth/session.js";

const SESSION_SECRET = "test-session-secret";

function makeQueue(): Queue {
  return {
    add: vi.fn().mockResolvedValue({ id: "mock-job-1" }),
  } as unknown as Queue;
}

function makeApp(queue?: Queue) {
  const q = queue ?? makeQueue();
  const router = createHealthCheckRouter({ processingQueue: q });

  const app = new Hono();
  app.use("/api/admin/*", requireAdmin(SESSION_SECRET));
  app.route("/api/admin/health-check", router);
  return { app, queue: q };
}

function makeAuthenticatedRequest(app: Hono, path: string, method = "POST") {
  const token = issueToken(SESSION_SECRET);
  return app.request(path, {
    method,
    headers: { cookie: `${COOKIE_NAME}=${token}` },
  });
}

describe("POST /api/admin/health-check", () => {
  it("returns 401 without authentication", async () => {
    const { app } = makeApp();
    const res = await app.request("/api/admin/health-check", {
      method: "POST",
    });
    expect(res.status).toBe(401);
  });

  it("returns 202 with jobId and all collectors when authenticated", async () => {
    const { app } = makeApp();
    const res = await makeAuthenticatedRequest(app, "/api/admin/health-check");
    expect(res.status).toBe(202);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const body: Record<string, unknown> = await res.json();
    expect(body.jobId).toBeDefined();
    expect(body.collectors).toEqual(ALL_COLLECTORS);
  });

  it("enqueues a health-check job with collectorType undefined for all", async () => {
    const q = makeQueue();
    const { app } = makeApp(q);
    await makeAuthenticatedRequest(app, "/api/admin/health-check");
    const calls = (q.add as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0]).toBe("health-check");
    expect(calls[0][1]).toEqual({ collectorType: undefined, triggeredBy: "manual" });
  });
});

describe("POST /api/admin/health-check/:collectorType", () => {
  it("returns 202 with jobId and collector for valid collector types", async () => {
    const validTypes = ["hn", "reddit", "twitter", "web_search", "blog"] as const;
    for (const ct of validTypes) {
      const { app } = makeApp();
      const res = await makeAuthenticatedRequest(
        app,
        `/api/admin/health-check/${ct}`,
      );
      expect(res.status).toBe(202);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const body: Record<string, unknown> = await res.json();
      expect(body.jobId).toBeDefined();
      expect(body.collector).toBe(ct);
    }
  });

  it("enqueues a health-check job with the specified collectorType", async () => {
    const q = makeQueue();
    const { app } = makeApp(q);
    await makeAuthenticatedRequest(app, "/api/admin/health-check/hn");
    const calls = (q.add as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0]).toBe("health-check");
    expect(calls[0][1]).toEqual({ collectorType: "hn", triggeredBy: "manual" });
  });

  it("returns 400 for an invalid collector type", async () => {
    const { app } = makeApp();
    const res = await makeAuthenticatedRequest(
      app,
      "/api/admin/health-check/invalid",
    );
    expect(res.status).toBe(400);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const body: Record<string, unknown> = await res.json();
    expect(body).toHaveProperty("error");
  });
});
