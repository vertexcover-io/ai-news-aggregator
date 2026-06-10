import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import type { SourceRow, TenantContext } from "@newsletter/shared";
import type { TenantVariables } from "../../middleware/types.js";
import {
  createTenantSourcesRouter,
  type SourceCandidate,
  type SourceDiscoverInput,
} from "../tenant-sources.js";
import type { SourcesRepo } from "../../repositories/sources.js";

function makeRepo(): { repo: SourcesRepo; rows: SourceRow[] } {
  const rows: SourceRow[] = [];
  let seq = 0;
  const repo: SourcesRepo = {
    listForTenant: () => Promise.resolve([...rows]),
    listEnabled: () => Promise.resolve(rows.filter((r) => r.enabled)),
    add: (insert) => {
      const row: SourceRow = {
        id: `src-${++seq}`,
        tenantId: "t1",
        type: insert.type,
        config: insert.config,
        enabled: insert.enabled ?? true,
        health: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      rows.push(row);
      return Promise.resolve(row);
    },
    remove: (id) => {
      const i = rows.findIndex((r) => r.id === id);
      if (i >= 0) rows.splice(i, 1);
      return Promise.resolve();
    },
    setEnabled: (id, enabled) => {
      const row = rows.find((r) => r.id === id);
      if (!row) return Promise.resolve(undefined as unknown as SourceRow);
      row.enabled = enabled;
      return Promise.resolve(row);
    },
  };
  return { repo, rows };
}

const CTX: TenantContext = { tenantId: "t1", role: "tenant_admin" };

describe("tenant-sources router", () => {
  let repo: SourcesRepo;
  let rows: SourceRow[];

  beforeEach(() => {
    ({ repo, rows } = makeRepo());
  });

  function build(
    extra?: Partial<Parameters<typeof createTenantSourcesRouter>[0]>,
  ): Hono<{ Variables: TenantVariables }> {
    const router = createTenantSourcesRouter({
      getSourcesRepo: () => repo,
      ...extra,
    });
    const app = new Hono<{ Variables: TenantVariables }>();
    app.use("*", async (c, next) => {
      c.set("tenantCtx", CTX);
      await next();
    });
    app.route("/", router);
    return app;
  }

  it("GET / lists tenant sources", async () => {
    await repo.add({ type: "hn", config: { feeds: ["best"] } });
    const app = build();
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as SourceRow[];
    expect(body).toHaveLength(1);
    expect(body[0].type).toBe("hn");
  });

  it("POST / adds a source and returns 201", async () => {
    const app = build();
    const res = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "reddit", config: { subreddits: ["ml"] } }),
    });
    expect(res.status).toBe(201);
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("reddit");
  });

  it("POST / rejects an invalid type", async () => {
    const app = build();
    const res = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "bogus", config: {} }),
    });
    expect(res.status).toBe(400);
    expect(rows).toHaveLength(0);
  });

  it("PATCH /:id toggles enabled", async () => {
    const added = await repo.add({ type: "hn", config: {} });
    const app = build();
    const res = await app.request(`/${added.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    expect(res.status).toBe(200);
    expect(rows[0].enabled).toBe(false);
  });

  it("PATCH /:id returns 404 when source not found", async () => {
    const app = build();
    const res = await app.request("/missing", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });
    expect(res.status).toBe(404);
  });

  it("DELETE /:id removes a source", async () => {
    const added = await repo.add({ type: "hn", config: {} });
    const app = build();
    const res = await app.request(`/${added.id}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(rows).toHaveLength(0);
  });

  it("GET /discover returns candidates without adding them", async () => {
    const candidates: SourceCandidate[] = [
      { type: "blog", title: "Example", url: "https://example.com" },
    ];
    const seen: SourceDiscoverInput[] = [];
    const app = build({
      discoverSources: (input) => {
        seen.push(input);
        return Promise.resolve(candidates);
      },
    });
    const res = await app.request("/discover?query=ai+news");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { candidates: SourceCandidate[] };
    expect(body.candidates).toEqual(candidates);
    expect(rows).toHaveLength(0);
    expect(seen[0].query).toBe("ai news");
    expect(seen[0].ctx.tenantId).toBe("t1");
  });

  it("GET /discover returns empty list when discovery is not configured", async () => {
    const app = build();
    const res = await app.request("/discover?query=ai");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { candidates: SourceCandidate[] };
    expect(body.candidates).toEqual([]);
  });

  it("GET /discover rejects a missing query", async () => {
    const app = build({ discoverSources: () => Promise.resolve([]) });
    const res = await app.request("/discover");
    expect(res.status).toBe(400);
  });

  it("GET /discover returns 502 when discovery throws", async () => {
    const app = build({
      discoverSources: () => Promise.reject(new Error("tavily down")),
    });
    const res = await app.request("/discover?query=ai");
    expect(res.status).toBe(502);
  });

  it("uses AGENTLOOP context when none is set", async () => {
    const app = createTenantSourcesRouter({ getSourcesRepo: () => repo });
    const res = await app.request("/");
    expect(res.status).toBe(200);
  });
});
