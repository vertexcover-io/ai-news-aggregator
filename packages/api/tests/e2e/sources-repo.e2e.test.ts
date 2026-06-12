/**
 * Phase 5 e2e: sources repository CRUD + tenant scoping against the real DB.
 * Covers REQ-070 (per-tenant rows), REQ-072 (add/remove of each type) and the
 * Phase 3 seam invariant (cross-tenant ids resolve to null/false).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { sql } from "drizzle-orm";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
config({ path: resolve(REPO_ROOT, ".env") });

const { getDb } = await import("@newsletter/shared/db");
const { createSourcesRepo } = await import("@api/repositories/sources.js");

const db = getDb();

const SLUGS = { a: "sources-repo-e2e-a", b: "sources-repo-e2e-b" } as const;
const tenantIds = { a: "", b: "" };

async function cleanup(): Promise<void> {
  await db.execute(sql`
    DELETE FROM sources WHERE tenant_id IN (
      SELECT id FROM tenants WHERE slug IN (${SLUGS.a}, ${SLUGS.b})
    )
  `);
  await db.execute(
    sql`DELETE FROM tenants WHERE slug IN (${SLUGS.a}, ${SLUGS.b})`,
  );
}

beforeAll(async () => {
  await cleanup();
  for (const key of ["a", "b"] as const) {
    const rows = await db.execute<{ id: string }>(sql`
      INSERT INTO tenants (slug, name, status)
      VALUES (${SLUGS[key]}, ${`Sources E2E ${key.toUpperCase()}`}, 'active')
      RETURNING id
    `);
    tenantIds[key] = rows[0].id;
  }
});

afterAll(async () => {
  await cleanup();
});

describe("createSourcesRepo (e2e)", () => {
  it("REQ-072: creates and deletes a source of each supported type", async () => {
    const repo = createSourcesRepo(db, tenantIds.a);
    const inputs = [
      { type: "hn", config: { sinceDays: 1, pointsThreshold: 50 } },
      { type: "reddit", config: { subreddit: "LocalLLaMA", sinceDays: 2 } },
      { type: "web", config: { name: "Blog", listingUrl: "https://example.com/blog" } },
      { type: "twitter", config: { kind: "list", listId: "123" } },
      { type: "web_search", config: { query: "AI agents", sinceDays: 1, maxItems: 5 } },
    ] as const;

    const created = [];
    for (const input of inputs) {
      const row = await repo.create(input);
      expect(row.type).toBe(input.type);
      expect(row.config).toEqual(input.config);
      expect(row.enabled).toBe(true);
      created.push(row);
    }

    expect((await repo.list()).map((r) => r.type).sort()).toEqual(
      ["hn", "reddit", "twitter", "web", "web_search"],
    );

    for (const row of created) {
      expect(await repo.delete(row.id)).toBe(true);
    }
    expect(await repo.list()).toEqual([]);
  });

  it("REQ-070: rows are tenant-scoped — tenant B never sees tenant A's rows", async () => {
    const repoA = createSourcesRepo(db, tenantIds.a);
    const repoB = createSourcesRepo(db, tenantIds.b);

    const rowA = await repoA.create({
      type: "web",
      config: { name: "A only", listingUrl: "https://a.example.com" },
    });

    expect(await repoB.list()).toEqual([]);
    expect(await repoB.listEnabled()).toEqual([]);
    expect(await repoB.getById(rowA.id)).toBeNull();
    expect(await repoB.update(rowA.id, { enabled: false })).toBeNull();
    expect(await repoB.updateHealth(rowA.id, { status: "failing", lastCheckedAt: new Date().toISOString() })).toBeNull();
    expect(await repoB.delete(rowA.id)).toBe(false);

    // A still owns the untouched row.
    const stillThere = await repoA.getById(rowA.id);
    expect(stillThere?.enabled).toBe(true);
    expect(stillThere?.health).toBeNull();
    await repoA.delete(rowA.id);
  });

  it("REQ-073 precondition: listEnabled excludes disabled rows", async () => {
    const repo = createSourcesRepo(db, tenantIds.a);
    const enabledRow = await repo.create({
      type: "hn",
      config: { sinceDays: 1 },
    });
    const disabledRow = await repo.create({
      type: "reddit",
      config: { subreddit: "MachineLearning", sinceDays: 1 },
      enabled: false,
    });

    const enabled = await repo.listEnabled();
    expect(enabled.map((r) => r.id)).toEqual([enabledRow.id]);

    await repo.delete(enabledRow.id);
    await repo.delete(disabledRow.id);
  });

  it("replaceAll swaps a tenant's rows wholesale without touching other tenants (incl. ordering tiebreaker)", async () => {
    const repoA = createSourcesRepo(db, tenantIds.a);
    const repoB = createSourcesRepo(db, tenantIds.b);
    const rowB = await repoB.create({ type: "hn", config: { sinceDays: 1 } });
    await repoA.create({ type: "hn", config: { sinceDays: 9 } });

    const replaced = await repoA.replaceAll([
      { type: "reddit", config: { subreddit: "LocalLLaMA", sinceDays: 2 } },
      { type: "reddit", config: { subreddit: "MachineLearning", sinceDays: 2 }, enabled: false },
    ]);
    expect(replaced).toHaveLength(2);

    // Same-statement inserts share created_at — the id tiebreaker must make
    // list order deterministic (stable across reads, not insert-order).
    const first = await repoA.list();
    const second = await repoA.list();
    expect(second.map((r) => r.id)).toEqual(first.map((r) => r.id));
    expect(
      first
        .map((r) => (r.type === "reddit" ? r.config.subreddit : r.type))
        .sort(),
    ).toEqual(["LocalLLaMA", "MachineLearning"]);

    // Tenant B untouched.
    expect((await repoB.list()).map((r) => r.id)).toEqual([rowB.id]);

    await repoA.replaceAll([]);
    expect(await repoA.list()).toEqual([]);
    await repoB.delete(rowB.id);
  });

  it("update patches config and enabled; updateHealth stamps health", async () => {
    const repo = createSourcesRepo(db, tenantIds.a);
    const row = await repo.create({
      type: "web",
      config: { name: "Before", listingUrl: "https://before.example.com" },
    });

    const updated = await repo.update(row.id, {
      config: { name: "After", listingUrl: "https://after.example.com" },
      enabled: false,
    });
    expect(updated?.config).toEqual({
      name: "After",
      listingUrl: "https://after.example.com",
    });
    expect(updated?.enabled).toBe(false);

    const health = { status: "ok" as const, lastCheckedAt: "2026-06-10T00:00:00.000Z" };
    const stamped = await repo.updateHealth(row.id, health);
    expect(stamped?.health).toEqual(health);

    expect(await repo.getById("not-a-uuid")).toBeNull();
    await repo.delete(row.id);
  });
});
