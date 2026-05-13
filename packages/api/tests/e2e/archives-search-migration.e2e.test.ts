/**
 * Phase 2 e2e: verifies the archive-keyword-search migration is applied.
 * Asserts column/index/function existence, immutability of the wrapper,
 * backfill correctness (override precedence), and idempotency of the SQL.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
config({ path: resolve(REPO_ROOT, ".env") });

const { getDb, rawItems, runArchives } = await import("@newsletter/shared/db");
const migrationsDir = resolve(HERE, "../../../shared/src/db/migrations");

function readSearchMigration(): string {
  const files = readdirSync(migrationsDir).filter((f) => /^0014_.*\.sql$/.test(f));
  if (files.length !== 1) {
    throw new Error(`Expected exactly one 0014_*.sql migration, found: ${files.join(", ")}`);
  }
  const [first] = files;
  return readFileSync(resolve(migrationsDir, first), "utf8");
}

function splitStatements(raw: string): string[] {
  return raw
    .split(/-->\s*statement-breakpoint/g)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function applyMigration(): Promise<void> {
  const stmts = splitStatements(readSearchMigration());
  for (const stmt of stmts) {
    await db.execute(sql.raw(stmt));
  }
}

const db = getDb();
const seedRunId = "11111111-1111-1111-1111-111111111111";
const seedExternalId = `phase2-search-${Date.now()}`;
let seedRawItemId = 0;

beforeAll(async () => {
  await db.execute(sql`DELETE FROM run_archives WHERE id = ${seedRunId}::uuid`);
  await db.execute(sql`DELETE FROM raw_items WHERE external_id = ${seedExternalId}`);

  const inserted = await db
    .insert(rawItems)
    .values({
      sourceType: "hn",
      externalId: seedExternalId,
      title: "Quantum Cromulence in Café Society",
      url: "https://example.com/articles/quantum-cromulence",
      author: "alice",
      engagement: { points: 0, commentCount: 0 },
      metadata: {
        comments: [],
        recap: {
          title: "ORIGINAL_TITLE_TOKEN",
          summary: "ORIGINAL_SUMMARY_TOKEN",
          bullets: ["original_bullet_one"],
          bottomLine: "ORIGINAL_BOTTOM_TOKEN",
        },
      },
    })
    .returning({ id: rawItems.id });
  const [{ id }] = inserted;
  seedRawItemId = id;

  await db.insert(runArchives).values({
    id: seedRunId,
    status: "completed",
    rankedItems: [
      {
        rawItemId: seedRawItemId,
        score: 1,
        rationale: "test",
        summary: "OVERRIDE_SUMMARY_TOKEN",
        bullets: ["override_bullet_alpha"],
        bottomLine: "OVERRIDE_BOTTOM_TOKEN",
      },
    ],
    topN: 1,
    reviewed: true,
    completedAt: new Date(),
    digestHeadline: "DIGEST_HEAD_TOKEN today's stories",
    digestSummary: "DIGEST_SUMMARY_TOKEN overall theme",
  });

  // Re-run the migration so the freshly-seeded archive gets backfilled.
  await applyMigration();
});

afterAll(async () => {
  await db.execute(sql`DELETE FROM run_archives WHERE id = ${seedRunId}::uuid`);
  await db.execute(sql`DELETE FROM raw_items WHERE id = ${seedRawItemId}`);
});

describe("archive-keyword-search migration (e2e)", () => {
  it("adds search_text column to run_archives", async () => {
    const rows = await db.execute<{ data_type: string }>(sql`
      SELECT data_type FROM information_schema.columns
      WHERE table_name = 'run_archives' AND column_name = 'search_text'
    `);
    expect(rows.length).toBe(1);
    const [row] = rows;
    expect(row.data_type).toBe("text");
  });

  it("adds generated search_tsv tsvector column", async () => {
    const rows = await db.execute<{ data_type: string; is_generated: string }>(sql`
      SELECT data_type, is_generated FROM information_schema.columns
      WHERE table_name = 'run_archives' AND column_name = 'search_tsv'
    `);
    expect(rows.length).toBe(1);
    const [row] = rows;
    expect(row.data_type).toBe("tsvector");
    expect(row.is_generated).toBe("ALWAYS");
  });

  it("creates a GIN index on search_tsv", async () => {
    const rows = await db.execute<{ indexdef: string }>(sql`
      SELECT indexdef FROM pg_indexes
      WHERE tablename = 'run_archives' AND indexname = 'idx_run_archives_search_tsv'
    `);
    expect(rows.length).toBe(1);
    const [row] = rows;
    expect(row.indexdef.toLowerCase()).toContain("using gin");
  });

  it("creates the helper reviewed/completed_at index", async () => {
    const rows = await db.execute(sql`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'run_archives' AND indexname = 'idx_run_archives_reviewed_completed'
    `);
    expect(rows.length).toBe(1);
  });

  it("creates immutable_unaccent function as IMMUTABLE", async () => {
    const rows = await db.execute<{ provolatile: string }>(sql`
      SELECT provolatile FROM pg_proc WHERE proname = 'immutable_unaccent'
    `);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const [row] = rows;
    expect(row.provolatile).toBe("i");
  });

  it("backfills search_text using override precedence (override beats recap)", async () => {
    const rows = await db.execute<{ search_text: string | null }>(sql`
      SELECT search_text FROM run_archives WHERE id = ${seedRunId}::uuid
    `);
    expect(rows.length).toBe(1);
    const [row] = rows;
    const text = row.search_text ?? "";
    expect(text).toContain("OVERRIDE_SUMMARY_TOKEN");
    expect(text).toContain("override_bullet_alpha");
    expect(text).toContain("OVERRIDE_BOTTOM_TOKEN");
    expect(text).not.toContain("ORIGINAL_SUMMARY_TOKEN");
    expect(text).not.toContain("original_bullet_one");
    expect(text).not.toContain("ORIGINAL_BOTTOM_TOKEN");
    expect(text).toContain("DIGEST_HEAD_TOKEN");
    expect(text).toContain("DIGEST_SUMMARY_TOKEN");
    expect(text).toContain("Quantum Cromulence");
    expect(text).toContain("example.com");
    expect(text).toContain("hn");
    expect(text).toContain("alice");
  });

  it("populates search_tsv (generated) with tokens from search_text", async () => {
    const rows = await db.execute<{ matches: boolean }>(sql`
      SELECT (search_tsv @@ websearch_to_tsquery('english', 'quantum')) AS matches
      FROM run_archives WHERE id = ${seedRunId}::uuid
    `);
    expect(rows.length).toBe(1);
    const [row] = rows;
    expect(row.matches).toBe(true);
  });

  it("is idempotent — re-running migration leaves search_text unchanged and does not error", async () => {
    const before = await db.execute<{ search_text: string | null }>(sql`
      SELECT search_text FROM run_archives WHERE id = ${seedRunId}::uuid
    `);
    await applyMigration();
    const after = await db.execute<{ search_text: string | null }>(sql`
      SELECT search_text FROM run_archives WHERE id = ${seedRunId}::uuid
    `);
    const [b] = before;
    const [a] = after;
    expect(a.search_text).toBe(b.search_text);
  });
});
