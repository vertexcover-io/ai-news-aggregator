import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { setTestTenant, TEST_TENANT_ID } from "../../helpers/tenant.js";
import { createSourcesAdminRouter } from "@api/routes/sources-admin.js";
import type {
  SourceCreateInput,
  SourceRecord,
  SourcesRepo,
  SourceUpdateInput,
} from "@api/repositories/sources.js";
import {
  createSourceDiscovery,
  type SourceCandidate,
  type SourceDiscovery,
} from "@api/services/source-discovery.js";

function makeStubRepo(seed: SourceRecord[] = []) {
  const rows = new Map<string, SourceRecord>(seed.map((r) => [r.id, r]));
  const repo: SourcesRepo = {
    list: vi.fn(() => Promise.resolve([...rows.values()])),
    listEnabled: vi.fn(() =>
      Promise.resolve([...rows.values()].filter((r) => r.enabled)),
    ),
    getById: vi.fn((id: string) => Promise.resolve(rows.get(id) ?? null)),
    create: vi.fn((input: SourceCreateInput) => {
      const row = {
        id: randomUUID(),
        type: input.type,
        config: input.config,
        enabled: input.enabled ?? true,
        health: null,
        createdAt: new Date("2026-06-01T00:00:00Z"),
        updatedAt: new Date("2026-06-01T00:00:00Z"),
      } as SourceRecord;
      rows.set(row.id, row);
      return Promise.resolve(row);
    }),
    update: vi.fn((id: string, patch: SourceUpdateInput) => {
      const existing = rows.get(id);
      if (!existing) return Promise.resolve(null);
      const updated = {
        ...existing,
        ...(patch.config !== undefined ? { config: patch.config } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        updatedAt: new Date("2026-06-02T00:00:00Z"),
      } as SourceRecord;
      rows.set(id, updated);
      return Promise.resolve(updated);
    }),
    delete: vi.fn((id: string) => Promise.resolve(rows.delete(id))),
    updateHealth: vi.fn(() => Promise.resolve(null)),
  };
  return { repo, rows };
}

function buildApp(opts: {
  repo: SourcesRepo;
  discovery?: SourceDiscovery | null;
  onTenant?: (tenantId: string) => void;
}) {
  const app = new Hono();
  app.use("*", setTestTenant());
  app.route(
    "/api/admin/sources",
    createSourcesAdminRouter({
      getSourcesRepo: (tenantId) => {
        opts.onTenant?.(tenantId);
        return opts.repo;
      },
      discovery: opts.discovery ?? null,
    }),
  );
  return app;
}

const webRow: SourceRecord = {
  id: randomUUID(),
  type: "web",
  config: { name: "Anthropic", listingUrl: "https://www.anthropic.com/research" },
  enabled: true,
  health: { status: "ok", lastCheckedAt: "2026-06-01T00:00:00Z" },
  createdAt: new Date("2026-05-01T00:00:00Z"),
  updatedAt: new Date("2026-05-01T00:00:00Z"),
};

describe("GET /api/admin/sources", () => {
  it("REQ-070: lists rows with health, dates serialized to ISO", async () => {
    const { repo } = makeStubRepo([webRow]);
    const app = buildApp({ repo });
    const res = await app.request("/api/admin/sources");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sources: Record<string, unknown>[] };
    expect(body.sources).toHaveLength(1);
    expect(body.sources[0]).toEqual({
      id: webRow.id,
      type: "web",
      config: webRow.config,
      enabled: true,
      health: { status: "ok", lastCheckedAt: "2026-06-01T00:00:00Z" },
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    });
  });

  it("constructs the repo with the session tenant (scoping comes from repo construction)", async () => {
    const { repo } = makeStubRepo();
    const seen: string[] = [];
    const app = buildApp({ repo, onTenant: (t) => seen.push(t) });
    await app.request("/api/admin/sources");
    expect(seen).toEqual([TEST_TENANT_ID]);
  });
});

describe("POST /api/admin/sources (REQ-072 add)", () => {
  it.each([
    ["hn", { sinceDays: 1, pointsThreshold: 50 }],
    ["reddit", { subreddit: "LocalLLaMA", sinceDays: 2, sort: "top" }],
    ["web", { name: "Blog", listingUrl: "https://example.com/blog" }],
    ["twitter", { kind: "list", listId: "123" }],
    ["web_search", { query: "AI agents", sinceDays: 1, maxItems: 5 }],
  ])("creates a %s source", async (type, config) => {
    const { repo } = makeStubRepo();
    const app = buildApp({ repo });
    const res = await app.request("/api/admin/sources", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type, config }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { type: string; config: unknown; enabled: boolean };
    expect(body.type).toBe(type);
    expect(body.config).toEqual(config);
    expect(body.enabled).toBe(true);
    expect(repo.create).toHaveBeenCalledOnce();
  });

  it("rejects a config that does not match the declared type", async () => {
    const { repo } = makeStubRepo();
    const app = buildApp({ repo });
    const res = await app.request("/api/admin/sources", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "web", config: { subreddit: "nope", sinceDays: 1 } }),
    });
    expect(res.status).toBe(400);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("rejects an unknown type and invalid json", async () => {
    const { repo } = makeStubRepo();
    const app = buildApp({ repo });
    const badType = await app.request("/api/admin/sources", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "rss", config: {} }),
    });
    expect(badType.status).toBe(400);
    const badJson = await app.request("/api/admin/sources", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{nope",
    });
    expect(badJson.status).toBe(400);
  });
});

describe("PATCH /api/admin/sources/:id", () => {
  it("toggles enabled", async () => {
    const { repo } = makeStubRepo([webRow]);
    const app = buildApp({ repo });
    const res = await app.request(`/api/admin/sources/${webRow.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { enabled: boolean };
    expect(body.enabled).toBe(false);
  });

  it("updates config validated against the row's type", async () => {
    const { repo } = makeStubRepo([webRow]);
    const app = buildApp({ repo });
    const res = await app.request(`/api/admin/sources/${webRow.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ config: { name: "Renamed", listingUrl: "https://example.com" } }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { config: { name: string } };
    expect(body.config.name).toBe("Renamed");
  });

  it("rejects a config that does not match the row's type", async () => {
    const { repo } = makeStubRepo([webRow]);
    const app = buildApp({ repo });
    const res = await app.request(`/api/admin/sources/${webRow.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ config: { subreddit: "nope", sinceDays: 1 } }),
    });
    expect(res.status).toBe(400);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("404s on unknown or non-uuid ids and 400s on an empty patch", async () => {
    const { repo } = makeStubRepo([webRow]);
    const app = buildApp({ repo });
    const missing = await app.request(`/api/admin/sources/${randomUUID()}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });
    expect(missing.status).toBe(404);
    const badId = await app.request("/api/admin/sources/not-a-uuid", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });
    expect(badId.status).toBe(404);
    const empty = await app.request(`/api/admin/sources/${webRow.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(empty.status).toBe(400);
  });
});

describe("DELETE /api/admin/sources/:id (REQ-072 remove)", () => {
  it("deletes an existing row", async () => {
    const { repo, rows } = makeStubRepo([webRow]);
    const app = buildApp({ repo });
    const res = await app.request(`/api/admin/sources/${webRow.id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(204);
    expect(rows.size).toBe(0);
  });

  it("404s on unknown id", async () => {
    const { repo } = makeStubRepo();
    const app = buildApp({ repo });
    const res = await app.request(`/api/admin/sources/${randomUUID()}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/admin/sources/discover", () => {
  const candidates: SourceCandidate[] = [
    {
      type: "web",
      title: "Simon Willison's Weblog",
      url: "https://simonwillison.net",
      description: "Daily LLM engineering notes",
    },
    {
      type: "reddit",
      title: "r/LocalLLaMA",
      url: "https://reddit.com/r/LocalLLaMA",
      description: "Open-weights model community",
    },
  ];

  it("REQ-071: returns stubbed candidates and never persists them", async () => {
    const { repo, rows } = makeStubRepo();
    const search = vi.fn(() =>
      Promise.resolve([{ title: "t", url: "u", content: "c" }]),
    );
    const filter = vi.fn(() => Promise.resolve(candidates));
    const app = buildApp({
      repo,
      discovery: createSourceDiscovery({ search, filter }),
    });
    const res = await app.request("/api/admin/sources/discover", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ topic: "local LLMs" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { candidates: SourceCandidate[] };
    expect(body.candidates).toEqual(candidates);
    expect(search).toHaveBeenCalledOnce();
    expect(filter).toHaveBeenCalledWith("local LLMs", [
      { title: "t", url: "u", content: "c" },
    ]);
    // candidates only — nothing was added
    expect(repo.create).not.toHaveBeenCalled();
    expect(rows.size).toBe(0);
  });

  it("returns [] without calling the filter when search has no hits", async () => {
    const { repo } = makeStubRepo();
    const search = vi.fn(() => Promise.resolve([]));
    const filter = vi.fn(() => Promise.resolve(candidates));
    const app = buildApp({
      repo,
      discovery: createSourceDiscovery({ search, filter }),
    });
    const res = await app.request("/api/admin/sources/discover", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ topic: "local LLMs" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ candidates: [] });
    expect(filter).not.toHaveBeenCalled();
  });

  it("returns 503 with a clear error when discovery is disabled", async () => {
    const { repo } = makeStubRepo();
    const app = buildApp({ repo, discovery: null });
    const res = await app.request("/api/admin/sources/discover", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ topic: "local LLMs" }),
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("source_discovery_disabled");
  });

  it("400s on a missing topic", async () => {
    const { repo } = makeStubRepo();
    const app = buildApp({
      repo,
      discovery: createSourceDiscovery({
        search: vi.fn(() => Promise.resolve([])),
        filter: vi.fn(() => Promise.resolve([])),
      }),
    });
    const res = await app.request("/api/admin/sources/discover", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});
