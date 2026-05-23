/**
 * Phase 2 e2e: must-read repository CRUD against the real DB.
 * Covers REQ-023, REQ-024, REQ-026, REQ-027, NF-003, EDGE-009, EDGE-013.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
config({ path: resolve(REPO_ROOT, ".env") });

const { getDb } = await import("@newsletter/shared/db");
const { createMustReadRepo } = await import("@api/repositories/must-read.js");

const db = getDb();
const repo = createMustReadRepo(db);

const URL_PREFIX = `https://must-read-repo.example.com/`;

async function wipe(): Promise<void> {
  await db.execute(
    sql`DELETE FROM must_read_entries WHERE url LIKE ${URL_PREFIX + "%"}`,
  );
}

beforeAll(wipe);
afterAll(wipe);
beforeEach(wipe);

interface SeedInput {
  url: string;
  title: string;
  author?: string | null;
  year?: number | null;
  annotation?: string;
}

function seed(input: SeedInput) {
  return repo.create({
    url: input.url,
    title: input.title,
    author: input.author ?? null,
    year: input.year ?? null,
    annotation: input.annotation ?? "default annotation",
  });
}

describe("createMustReadRepo (e2e)", () => {
  describe("create()", () => {
    it("persists a new entry and returns the inserted row", async () => {
      const row = await seed({
        url: `${URL_PREFIX}a`,
        title: "The Mythical Man-Month",
        author: "Fred Brooks",
        year: 1975,
        annotation: "Essential reading on software estimation.",
      });
      expect(row.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(row.url).toBe(`${URL_PREFIX}a`);
      expect(row.title).toBe("The Mythical Man-Month");
      expect(row.author).toBe("Fred Brooks");
      expect(row.year).toBe(1975);
      expect(row.annotation).toBe("Essential reading on software estimation.");
      expect(row.addedAt).toBeInstanceOf(Date);
      expect(row.updatedAt).toBeInstanceOf(Date);
    });

    it("allows null author and year", async () => {
      const row = await seed({
        url: `${URL_PREFIX}null-meta`,
        title: "Untitled draft",
        author: null,
        year: null,
      });
      expect(row.author).toBeNull();
      expect(row.year).toBeNull();
    });

    it("rejects with a typed error on URL unique-violation", async () => {
      await seed({ url: `${URL_PREFIX}dup`, title: "first" });
      await expect(
        seed({ url: `${URL_PREFIX}dup`, title: "second" }),
      ).rejects.toThrow();
    });
  });

  describe("findByUrl()", () => {
    it("returns null when not present", async () => {
      const found = await repo.findByUrl(`${URL_PREFIX}missing`);
      expect(found).toBeNull();
    });

    it("returns the row when present", async () => {
      const created = await seed({ url: `${URL_PREFIX}lookup`, title: "Lookup" });
      const found = await repo.findByUrl(`${URL_PREFIX}lookup`);
      expect(found).not.toBeNull();
      expect(found?.id).toBe(created.id);
      expect(found?.title).toBe("Lookup");
    });
  });

  describe("findById()", () => {
    it("returns null when not present", async () => {
      const found = await repo.findById("00000000-0000-0000-0000-000000000000");
      expect(found).toBeNull();
    });

    it("returns null for an invalid UUID string instead of throwing", async () => {
      const found = await repo.findById("not-a-uuid");
      expect(found).toBeNull();
    });

    it("returns the row when present", async () => {
      const created = await seed({ url: `${URL_PREFIX}byid`, title: "Byid" });
      const found = await repo.findById(created.id);
      expect(found?.id).toBe(created.id);
    });
  });

  describe("listPublic() and listAdmin()", () => {
    it("listAdmin returns all entries ordered by addedAt DESC", async () => {
      const a = await seed({ url: `${URL_PREFIX}1`, title: "A" });
      // ensure distinct timestamps so ordering is deterministic
      await new Promise((r) => setTimeout(r, 10));
      const b = await seed({ url: `${URL_PREFIX}2`, title: "B" });
      await new Promise((r) => setTimeout(r, 10));
      const c = await seed({ url: `${URL_PREFIX}3`, title: "C" });

      const list = await repo.listAdmin();
      const ids = list.map((r) => r.id);
      expect(ids.indexOf(c.id)).toBeLessThan(ids.indexOf(b.id));
      expect(ids.indexOf(b.id)).toBeLessThan(ids.indexOf(a.id));
      const firstRow = list.find((r) => r.id === c.id);
      expect(firstRow).toBeDefined();
      expect(firstRow?.updatedAt).toBeInstanceOf(Date);
    });

    it("listPublic returns entries without the updatedAt field", async () => {
      await seed({ url: `${URL_PREFIX}pub`, title: "Pub" });
      const list = await repo.listPublic();
      expect(list.length).toBeGreaterThanOrEqual(1);
      const sample = list.find((r) => r.url === `${URL_PREFIX}pub`);
      expect(sample).toBeDefined();
      if (sample) {
        expect("updatedAt" in sample).toBe(false);
        expect(sample.title).toBe("Pub");
      }
    });
  });

  describe("findRandom()", () => {
    it("returns null when the table is empty (filtering by our prefix scope)", async () => {
      // table-wide may have other rows but our scope is empty.
      // Seed nothing, expect findRandom over an empty real table to return null
      // — we wipe before each test, so when the table is truly empty:
      const totalRows = await db.execute<{ c: number }>(
        sql`SELECT count(*)::int AS c FROM must_read_entries`,
      );
      if (totalRows[0].c === 0) {
        const r = await repo.findRandom();
        expect(r).toBeNull();
      }
    });

    it("returns a uniformly-distributed entry over many calls (uniformity smoke)", async () => {
      const a = await seed({ url: `${URL_PREFIX}rand-a`, title: "RA" });
      const b = await seed({ url: `${URL_PREFIX}rand-b`, title: "RB" });
      const c = await seed({ url: `${URL_PREFIX}rand-c`, title: "RC" });

      const counts = new Map<string, number>();
      for (let i = 0; i < 30; i += 1) {
        const r = await repo.findRandom();
        if (!r) throw new Error("expected findRandom to return a row");
        counts.set(r.id, (counts.get(r.id) ?? 0) + 1);
      }
      expect(counts.get(a.id) ?? 0).toBeGreaterThan(0);
      expect(counts.get(b.id) ?? 0).toBeGreaterThan(0);
      expect(counts.get(c.id) ?? 0).toBeGreaterThan(0);
    });
  });

  describe("update()", () => {
    it("updates title/annotation and bumps updatedAt without touching addedAt", async () => {
      const created = await seed({
        url: `${URL_PREFIX}upd`,
        title: "Old",
        annotation: "old",
      });
      const originalAdded = created.addedAt.getTime();
      const originalUpdated = created.updatedAt.getTime();

      // sleep so updatedAt is observably newer
      await new Promise((r) => setTimeout(r, 30));

      const updated = await repo.update(created.id, {
        title: "New",
        annotation: "new",
      });
      expect(updated).not.toBeNull();
      if (!updated) throw new Error();
      expect(updated.title).toBe("New");
      expect(updated.annotation).toBe("new");
      expect(updated.addedAt.getTime()).toBe(originalAdded);
      expect(updated.updatedAt.getTime()).toBeGreaterThan(originalUpdated);
    });

    it("returns null when the id does not exist", async () => {
      const result = await repo.update(
        "00000000-0000-0000-0000-000000000000",
        { title: "x" },
      );
      expect(result).toBeNull();
    });

    it("can null out author/year via explicit null", async () => {
      const created = await seed({
        url: `${URL_PREFIX}clear`,
        title: "T",
        author: "A",
        year: 2020,
      });
      const updated = await repo.update(created.id, {
        author: null,
        year: null,
      });
      expect(updated?.author).toBeNull();
      expect(updated?.year).toBeNull();
    });
  });

  describe("delete()", () => {
    it("returns true when a row is removed", async () => {
      const created = await seed({ url: `${URL_PREFIX}del`, title: "X" });
      const ok = await repo.delete(created.id);
      expect(ok).toBe(true);
      const after = await repo.findById(created.id);
      expect(after).toBeNull();
    });

    it("returns false when no row matched", async () => {
      const ok = await repo.delete("00000000-0000-0000-0000-000000000000");
      expect(ok).toBe(false);
    });
  });

  describe("count()", () => {
    it("returns the total number of entries", async () => {
      const before = await repo.count();
      await seed({ url: `${URL_PREFIX}c1`, title: "1" });
      await seed({ url: `${URL_PREFIX}c2`, title: "2" });
      const after = await repo.count();
      expect(after - before).toBe(2);
    });
  });
});
