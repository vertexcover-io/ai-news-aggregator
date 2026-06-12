/**
 * Phase 3 e2e: public GET /api/must-read endpoint.
 * Covers REQ-014, REQ-015, NF-004.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { sql } from "drizzle-orm";
import { getDb } from "@newsletter/shared/db";
import { createMustReadRepo } from "@api/repositories/must-read.js";
import { createPublicMustReadRouter } from "@api/routes/must-read.js";
import { ensureE2eTenant } from "./helpers/tenant.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
config({ path: resolve(REPO_ROOT, ".env") });

const db = getDb();
const tenantCtx = await ensureE2eTenant();
const repo = createMustReadRepo(db, tenantCtx);

const URL_PREFIX = "https://must-read-public.example.com/";

async function wipe(): Promise<void> {
  await db.execute(
    sql`DELETE FROM must_read_entries WHERE url LIKE ${URL_PREFIX + "%"}`,
  );
}

beforeAll(wipe);
afterAll(wipe);
beforeEach(wipe);
afterEach(wipe);

function buildApp(): Hono {
  const app = new Hono();
  app.route(
    "/api/must-read",
    createPublicMustReadRouter({
      getMustReadRepo: () => repo,
    }),
  );
  return app;
}

interface MustReadJson {
  id: string;
  url: string;
  title: string;
  author: string | null;
  year: number | null;
  annotation: string;
  addedAt: string;
}

describe("GET /api/must-read (e2e)", () => {
  it("REQ-014: returns [] when the table has no rows in scope", async () => {
    const res = await buildApp().request("/api/must-read");
    expect(res.status).toBe(200);
    const body = (await res.json()) as MustReadJson[];
    const scoped = body.filter((e) => e.url.startsWith(URL_PREFIX));
    expect(scoped).toEqual([]);
  });

  it("REQ-015: returns rows ordered by addedAt DESC", async () => {
    const a = await repo.create({
      url: `${URL_PREFIX}a`,
      title: "First seeded",
      author: "Alice",
      year: 2001,
      annotation: "first",
    });
    await new Promise((r) => setTimeout(r, 15));
    const b = await repo.create({
      url: `${URL_PREFIX}b`,
      title: "Second seeded",
      author: null,
      year: null,
      annotation: "second",
    });
    await new Promise((r) => setTimeout(r, 15));
    const c = await repo.create({
      url: `${URL_PREFIX}c`,
      title: "Third seeded",
      author: "Carol",
      year: 2020,
      annotation: "third",
    });

    const res = await buildApp().request("/api/must-read");
    expect(res.status).toBe(200);
    const body = (await res.json()) as MustReadJson[];
    const scoped = body.filter((e) => e.url.startsWith(URL_PREFIX));
    const ids = scoped.map((e) => e.id);
    expect(ids.indexOf(c.id)).toBeLessThan(ids.indexOf(b.id));
    expect(ids.indexOf(b.id)).toBeLessThan(ids.indexOf(a.id));
  });

  it("NF-004: every element lacks the updatedAt key", async () => {
    await repo.create({
      url: `${URL_PREFIX}check`,
      title: "Check shape",
      author: null,
      year: null,
      annotation: "shape probe",
    });
    const res = await buildApp().request("/api/must-read");
    const body = (await res.json()) as MustReadJson[];
    const scoped = body.filter((e) => e.url.startsWith(URL_PREFIX));
    expect(scoped.length).toBeGreaterThan(0);
    for (const entry of scoped) {
      expect(entry).not.toHaveProperty("updatedAt");
    }
  });
});
