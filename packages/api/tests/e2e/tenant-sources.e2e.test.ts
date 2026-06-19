/**
 * Phase 8 e2e: normalized per-tenant sources, against the real DB.
 *
 * REQ-070: sources stored in a normalized per-tenant table (type, config,
 *          enabled, health) — rows are tenant-fenced.
 * REQ-072: manual add and removal of sources of each supported type persists
 *          (through the /api/sources router, crossing the DB).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import type { TenantContext } from "@newsletter/shared/types/tenant-context";
import type { SourceConfig } from "@newsletter/shared/types";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
config({ path: resolve(REPO_ROOT, ".env") });

const { getDb, tenants } = await import("@newsletter/shared/db");
const { createSourcesRepo } = await import("@api/repositories/sources.js");
const { createTenantSourcesRouter } = await import(
  "@api/routes/tenant-sources.js"
);

const db = getDb();

const STAMP = Date.now().toString(36);
const MARKER = `sources-e2e-${STAMP}`;

let ctxA: TenantContext;
let ctxB: TenantContext;

async function cleanup(): Promise<void> {
  await db.execute(
    sql.raw(
      `DELETE FROM sources WHERE tenant_id IN (SELECT id FROM tenants WHERE slug LIKE '${MARKER}%')`,
    ),
  );
  await db.execute(sql.raw(`DELETE FROM tenants WHERE slug LIKE '${MARKER}%'`));
}

beforeAll(async () => {
  await cleanup();
  const rows = await db
    .insert(tenants)
    .values([
      { slug: `${MARKER}-a`, name: "Sources Tenant A", status: "active" },
      { slug: `${MARKER}-b`, name: "Sources Tenant B", status: "active" },
    ])
    .returning({ id: tenants.id });
  ctxA = { tenantId: rows[0].id, role: "tenant_admin" };
  ctxB = { tenantId: rows[1].id, role: "tenant_admin" };
});

afterAll(cleanup);

describe("test_REQ_070_sources_table_per_tenant_rows", () => {
  it("stores per-source rows with type/config/enabled/health, fenced by tenant", async () => {
    const repoA = createSourcesRepo(db, ctxA);
    const repoB = createSourcesRepo(db, ctxB);

    const aRow = await repoA.create({
      type: "reddit",
      config: { kind: "reddit", subreddit: "LocalLLaMA", sinceDays: 1 },
    });
    const bRow = await repoB.create({
      type: "blog",
      config: {
        kind: "web",
        name: "vLLM blog",
        listingUrl: "https://vllm.ai/blog",
      },
    });

    expect(aRow.tenantId).toBe(ctxA.tenantId);
    expect(aRow.type).toBe("reddit");
    expect(aRow.config).toEqual({
      kind: "reddit",
      subreddit: "LocalLLaMA",
      sinceDays: 1,
    });
    expect(aRow.enabled).toBe(true);
    expect(aRow.lastHealth).toBeNull();

    const aList = await repoA.list();
    expect(aList.map((r) => r.id)).toContain(aRow.id);
    expect(aList.map((r) => r.id)).not.toContain(bRow.id);

    // Cross-tenant ids behave as not-found (REQ-013 pattern).
    expect(await repoA.setEnabled(bRow.id, false)).toBeNull();
    expect(await repoA.delete(bRow.id)).toBe(false);
    const bList = await repoB.list();
    expect(bList.find((r) => r.id === bRow.id)?.enabled).toBe(true);
  });

  it("setEnabled toggles a tenant's own row", async () => {
    const repoA = createSourcesRepo(db, ctxA);
    const row = await repoA.create({
      type: "hn",
      config: { kind: "hn", sinceDays: 1 },
    });
    const off = await repoA.setEnabled(row.id, false);
    expect(off?.enabled).toBe(false);
    const on = await repoA.setEnabled(row.id, true);
    expect(on?.enabled).toBe(true);
  });
});

describe("test_REQ_072_manual_source_add_remove", () => {
  function buildApp(ctx: TenantContext): Hono {
    const app = new Hono();
    app.route(
      "/api/sources",
      createTenantSourcesRouter({
        getRepo: () => createSourcesRepo(db, ctx),
      }),
    );
    return app;
  }

  const CASES: { type: string; value: string; expected: Partial<SourceConfig> }[] = [
    { type: "reddit", value: "r/mlops", expected: { kind: "reddit", subreddit: "mlops" } },
    { type: "twitter", value: "@danielhanchen", expected: { kind: "twitter_user", handle: "danielhanchen" } },
    { type: "blog", value: "https://pytorch.org/blog", expected: { kind: "web", listingUrl: "https://pytorch.org/blog" } },
    { type: "github", value: "https://github.com/trending", expected: { kind: "web", listingUrl: "https://github.com/trending" } },
    { type: "hn", value: "", expected: { kind: "hn" } },
    { type: "web_search", value: "kv-cache optimization", expected: { kind: "web_search", query: "kv-cache optimization" } },
  ];

  it("adds and removes a source of each supported type through the router", async () => {
    const app = buildApp(ctxA);

    for (const c of CASES) {
      const res = await app.request("/api/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: c.type, value: c.value }),
      });
      expect(res.status, `POST ${c.type}`).toBe(201);
      const created = (await res.json()) as {
        id: string;
        type: string;
        config: Record<string, unknown>;
        enabled: boolean;
      };
      expect(created.type).toBe(c.type);
      expect(created.config).toMatchObject(c.expected);
      expect(created.enabled).toBe(true);

      // Persisted: visible via GET
      const listRes = await app.request("/api/sources");
      expect(listRes.status).toBe(200);
      const list = (await listRes.json()) as { sources: { id: string }[] };
      expect(list.sources.map((s) => s.id)).toContain(created.id);

      // Removal persists.
      const delRes = await app.request(`/api/sources/${created.id}`, {
        method: "DELETE",
      });
      expect(delRes.status).toBe(200);
      const after = (await (await app.request("/api/sources")).json()) as {
        sources: { id: string }[];
      };
      expect(after.sources.map((s) => s.id)).not.toContain(created.id);
    }
  });

  it("PATCH toggles enable/disable", async () => {
    const app = buildApp(ctxA);
    const res = await app.request("/api/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "reddit", value: "LocalLLaMA" }),
    });
    const created = (await res.json()) as { id: string };

    const patchRes = await app.request(`/api/sources/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()) as { enabled: boolean };
    expect(patched.enabled).toBe(false);
  });

  it("rejects invalid input with 400", async () => {
    const app = buildApp(ctxA);
    const badUrl = await app.request("/api/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "blog", value: "not a url" }),
    });
    expect(badUrl.status).toBe(400);

    const badType = await app.request("/api/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "nope", value: "x" }),
    });
    expect(badType.status).toBe(400);

    const missing = await app.request("/api/sources/not-a-uuid", {
      method: "DELETE",
    });
    expect(missing.status).toBe(404);
  });
});
