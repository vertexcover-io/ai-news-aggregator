/**
 * Phase 4 e2e: admin must-read CRUD + preview against the real DB.
 * Covers REQ-020, REQ-021, REQ-022, REQ-023, REQ-024, REQ-025, REQ-026, REQ-027,
 *        NF-002, NF-006, NF-008, EDGE-004, EDGE-006, EDGE-008, EDGE-009, EDGE-010.
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import type {
  StaticFetchError,
  StaticFetchOk,
} from "@newsletter/shared/services/static-page-fetcher";
import {
  createAdminMustReadRouter,
  type FetchPageStaticFn,
} from "@api/routes/admin-must-read.js";
import { createMustReadRepo } from "@api/repositories/must-read.js";
import { buildApp } from "@api/app.js";
import { createAdminRouter } from "@api/routes/admin.js";
import { requireAdmin } from "@api/auth/middleware.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
config({ path: resolve(REPO_ROOT, ".env") });

const { getDb } = await import("@newsletter/shared/db");

const db = getDb();
const repo = createMustReadRepo(db);

const URL_PREFIX = "https://admin-must-read-e2e.example.com/";

async function wipe(): Promise<void> {
  await db.execute(
    sql`DELETE FROM must_read_entries WHERE url LIKE ${URL_PREFIX + "%"}`,
  );
}

beforeAll(wipe);
afterAll(wipe);
beforeEach(wipe);

function buildRouterApp(
  fetchPage?: FetchPageStaticFn,
  previewTimeoutMs?: number,
): Hono {
  const app = new Hono();
  app.route(
    "/admin/must-read",
    createAdminMustReadRouter({
      getRepo: () => repo,
      fetchPage,
      previewTimeoutMs,
    }),
  );
  return app;
}

const SAMPLE_HTML = `
<!doctype html>
<html>
<head>
  <meta property="og:title" content="The Mythical Man-Month" />
  <meta property="article:author" content="Fred Brooks" />
  <meta property="article:published_time" content="1975-01-01T00:00:00Z" />
</head>
<body><p>hi</p></body>
</html>`;

function okResult(html = SAMPLE_HTML, finalUrl = "https://example.com/a"): StaticFetchOk {
  return { html, finalUrl };
}

function fetchOk(): FetchPageStaticFn {
  return vi.fn(() => Promise.resolve(okResult()));
}

function fetchErr(err: StaticFetchError): FetchPageStaticFn {
  return vi.fn(() => Promise.resolve({ error: err }));
}

function countRows(): Promise<number> {
  return repo.count();
}

describe("POST /admin/must-read/preview (e2e)", () => {
  it("REQ-020: returns 200 + extracted on a successful fetch", async () => {
    const app = buildRouterApp(fetchOk());
    const res = await app.request("/admin/must-read/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/a" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      suggested?: { title: string; author: string | null; year: number | null };
    };
    expect(body.status).toBe("extracted");
    expect(body.suggested?.title).toBe("The Mythical Man-Month");
    expect(body.suggested?.author).toBe("Fred Brooks");
    expect(body.suggested?.year).toBe(1975);
  });

  it("REQ-021 / EDGE-004: returns 200 + extraction_failed on unreachable URL", async () => {
    const app = buildRouterApp(fetchErr("network"));
    const res = await app.request("/admin/must-read/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/missing" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; error: string };
    expect(body.status).toBe("extraction_failed");
    expect(body.error).toBeTruthy();
    expect(body.error.length).toBeGreaterThan(0);
  });

  it("REQ-022: row count is unchanged before/after preview", async () => {
    const before = await countRows();
    const app = buildRouterApp(fetchOk());
    const res = await app.request("/admin/must-read/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/persist-check" }),
    });
    expect(res.status).toBe(200);
    const after = await countRows();
    expect(after).toBe(before);
  });

  it("NF-002: mocked slow fetch with override timeout returns 'timeout'", async () => {
    // Use the REAL fetchPageStatic (not a mock) — only stub globalThis.fetch
    // to never resolve, so we exercise the AbortController + timeout path.
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(
        (_input, init) =>
          new Promise((_resolve, reject) => {
            const signal = init?.signal;
            if (signal) {
              signal.addEventListener("abort", () => {
                const err = new Error("aborted");
                err.name = "AbortError";
                reject(err);
              });
            }
          }),
      );
    try {
      // 100ms timeout — we use the real fetcher by NOT passing fetchPage.
      const app = buildRouterApp(undefined, 100);
      const res = await app.request("/admin/must-read/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/slow" }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string; error: string };
      expect(body.status).toBe("extraction_failed");
      expect(body.error).toBe("timeout");
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("NF-008 / EDGE-010: private/loopback URL returns extraction_failed and never calls fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      // Use real fetcher (no fetchPage override) so canonicalizeFetchUrl runs.
      const app = buildRouterApp();
      const res = await app.request("/admin/must-read/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "http://10.0.0.1/" }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string; error: string };
      expect(body.status).toBe("extraction_failed");
      expect(body.error).toMatch(/private|loopback|blocked|ssrf|refused/i);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("returns 400 on invalid JSON body", async () => {
    const app = buildRouterApp(fetchOk());
    const res = await app.request("/admin/must-read/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /admin/must-read (e2e)", () => {
  it("REQ-023: 201 with full row on valid body; count +1", async () => {
    const before = await countRows();
    const app = buildRouterApp();
    const url = `${URL_PREFIX}create-ok`;
    const res = await app.request("/admin/must-read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        title: "The Pragmatic Programmer",
        author: "Hunt & Thomas",
        year: 1999,
        annotation: "Essential reading.",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      id: string;
      url: string;
      title: string;
      author: string | null;
      year: number | null;
      annotation: string;
      addedAt: string;
      updatedAt: string;
    };
    expect(body.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(body.url).toBe(url);
    expect(body.title).toBe("The Pragmatic Programmer");
    expect(body.author).toBe("Hunt & Thomas");
    expect(body.year).toBe(1999);
    expect(body.annotation).toBe("Essential reading.");
    const after = await countRows();
    expect(after - before).toBe(1);
  });

  it("REQ-024 / EDGE-006: 409 on duplicate URL; count unchanged", async () => {
    const url = `${URL_PREFIX}dup`;
    const first = await repo.create({
      url,
      title: "First",
      author: null,
      year: null,
      annotation: "dup test",
    });
    const before = await countRows();
    const app = buildRouterApp();
    const res = await app.request("/admin/must-read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        title: "Second",
        author: null,
        year: null,
        annotation: "should not insert",
      }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; existingId: string };
    expect(body.error).toBe("duplicate_url");
    expect(body.existingId).toBe(first.id);
    const after = await countRows();
    expect(after).toBe(before);
  });

  it("rejects invalid body with 400", async () => {
    const app = buildRouterApp();
    const res = await app.request("/admin/must-read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "not-a-url" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /admin/must-read (e2e)", () => {
  it("REQ-025: returns full rows including updatedAt", async () => {
    await repo.create({
      url: `${URL_PREFIX}list-1`,
      title: "L1",
      author: null,
      year: null,
      annotation: "a",
    });
    await repo.create({
      url: `${URL_PREFIX}list-2`,
      title: "L2",
      author: "auth",
      year: 2020,
      annotation: "b",
    });
    const app = buildRouterApp();
    const res = await app.request("/admin/must-read");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>[];
    expect(Array.isArray(body)).toBe(true);
    const ours = body.filter(
      (row) => typeof row.url === "string" && row.url.startsWith(URL_PREFIX),
    );
    expect(ours.length).toBe(2);
    for (const row of ours) {
      expect("updatedAt" in row).toBe(true);
      expect("addedAt" in row).toBe(true);
    }
  });
});

describe("PATCH /admin/must-read/:id (e2e)", () => {
  it("REQ-026 / EDGE-009: updates fields; addedAt unchanged; updatedAt strictly greater", async () => {
    const created = await repo.create({
      url: `${URL_PREFIX}patch-1`,
      title: "Old",
      author: "Old Author",
      year: 2000,
      annotation: "old annotation",
    });
    const originalAdded = created.addedAt.getTime();
    const originalUpdated = created.updatedAt.getTime();
    await new Promise((r) => setTimeout(r, 30));

    const app = buildRouterApp();
    const res = await app.request(`/admin/must-read/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "New",
        annotation: "new annotation",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      title: string;
      annotation: string;
      addedAt: string;
      updatedAt: string;
    };
    expect(body.id).toBe(created.id);
    expect(body.title).toBe("New");
    expect(body.annotation).toBe("new annotation");
    expect(new Date(body.addedAt).getTime()).toBe(originalAdded);
    expect(new Date(body.updatedAt).getTime()).toBeGreaterThan(originalUpdated);
  });

  it("returns 404 for unknown id", async () => {
    const app = buildRouterApp();
    const res = await app.request(
      `/admin/must-read/00000000-0000-0000-0000-000000000000`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "x" }),
      },
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 for non-UUID id", async () => {
    const app = buildRouterApp();
    const res = await app.request(`/admin/must-read/not-a-uuid`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "x" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /admin/must-read/:id (e2e)", () => {
  it("REQ-027: 204 on success; subsequent GET / does not include the row", async () => {
    const created = await repo.create({
      url: `${URL_PREFIX}delete-1`,
      title: "Doomed",
      author: null,
      year: null,
      annotation: "to be deleted",
    });
    const app = buildRouterApp();
    const res = await app.request(`/admin/must-read/${created.id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(204);
    const text = await res.text();
    expect(text).toBe("");

    const listRes = await app.request("/admin/must-read");
    const list = (await listRes.json()) as { id: string }[];
    expect(list.find((r) => r.id === created.id)).toBeUndefined();
  });

  it("returns 404 when row does not exist", async () => {
    const app = buildRouterApp();
    const res = await app.request(
      `/admin/must-read/00000000-0000-0000-0000-000000000000`,
      { method: "DELETE" },
    );
    expect(res.status).toBe(404);
  });
});

describe("EDGE-008: client aborts mid-extraction; no row created", () => {
  it("does not create any must_read_entries when the client aborts the preview", async () => {
    const before = await countRows();
    // Slow fetch that resolves only after the abort timer fires.
    let resolveSlow: ((value: { error: StaticFetchError }) => void) | null = null;
    const fetchPage: FetchPageStaticFn = () =>
      new Promise((resolve) => {
        resolveSlow = resolve;
      });
    const app = buildRouterApp(fetchPage, 5_000);
    const controller = new AbortController();
    const reqPromise = app.request("/admin/must-read/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/abandoned" }),
      signal: controller.signal,
    });
    // Abort the client request.
    setTimeout(() => {
      controller.abort();
    }, 20);
    // Make the fetch resolve a moment later so the server pipeline can drain.
    setTimeout(() => {
      resolveSlow?.({ error: "timeout" });
    }, 50);
    await reqPromise.catch(() => {
      /* aborted */
    });
    // Allow any post-handler microtasks to settle.
    await new Promise((r) => setTimeout(r, 50));
    const after = await countRows();
    expect(after).toBe(before);
  });
});

describe("NF-006: SameSite cookie on /api/admin/login", () => {
  function buildFullApp(): Hono {
    const adminPassword = "test-pw-nf006";
    const sessionSecret = "test-secret-at-least-32-bytes-long-x";
    return buildApp({
      sessionSecret,
      publicArchivesRouter: new Hono(),
      publicHomeRouter: new Hono(),
      publicMustReadRouter: new Hono(),
      archivesSearchRouter: new Hono(),
      adminArchivesRouter: new Hono(),
      adminRunsRouter: new Hono(),
      adminSocialCredentialsRouter: new Hono(),
      adminMustReadRouter: new Hono(),
      runsRouter: new Hono(),
      settingsRouter: new Hono(),
      adminRouter: createAdminRouter({
        adminPassword,
        sessionSecret,
        logger: { info: vi.fn(), warn: vi.fn() },
      }),
      requireAdminFactory: requireAdmin,
      subscribeRouter: new Hono(),
      webhooksRouter: new Hono(),
      analyticsRouter: new Hono(),
      analyticsConfigRouter: new Hono(),
    });
  }

  it("Set-Cookie on /api/admin/login contains SameSite=Lax or SameSite=Strict", async () => {
    const app = buildFullApp();
    const res = await app.request("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "test-pw-nf006" }),
    });
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie");
    if (!setCookie) throw new Error("expected Set-Cookie header");
    expect(setCookie).toMatch(/SameSite=(Lax|Strict)/i);
  });
});

// Ensures the previous SameSite test does not leak side effects.
afterEach(() => {
  vi.restoreAllMocks();
});
