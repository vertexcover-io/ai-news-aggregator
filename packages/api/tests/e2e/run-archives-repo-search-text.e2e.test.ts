/**
 * Phase 3 e2e: verifies updateRankedItems writes search_text via the shared
 * serializer. Covers REQ-008/EDGE-004 (override precedence) and the
 * removed-item case.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { AGENTLOOP_TENANT_ID } from "@newsletter/shared";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
config({ path: resolve(REPO_ROOT, ".env") });

const { getDb, rawItems, runArchives } = await import("@newsletter/shared/db");
const { serializeArchiveSearchText } = await import("@newsletter/shared");
const { createRunArchivesRepo } = await import(
  "@api/repositories/run-archives.js"
);
const { createRawItemsRepo } = await import("@api/repositories/raw-items.js");

const db = getDb();
const repo = createRunArchivesRepo(db);
const rawRepo = createRawItemsRepo(db);

const seedRunId = "22222222-2222-2222-2222-222222222222";
const seedExternalIdA = `phase3-search-A-${Date.now()}`;
const seedExternalIdB = `phase3-search-B-${Date.now()}`;
let rawItemIdA = 0;
let rawItemIdB = 0;

beforeAll(async () => {
  await db.execute(sql`DELETE FROM run_archives WHERE id = ${seedRunId}::uuid`);
  await db.execute(
    sql`DELETE FROM raw_items WHERE external_id IN (${seedExternalIdA}, ${seedExternalIdB})`,
  );

  const [{ id: idA }] = await db
    .insert(rawItems)
    .values({
      tenantId: AGENTLOOP_TENANT_ID,
      sourceType: "hn",
      externalId: seedExternalIdA,
      title: "Quantum Cromulence in Café Society",
      url: "https://example.com/articles/quantum-cromulence",
      author: "alice",
      engagement: { points: 0, commentCount: 0 },
      metadata: {
        comments: [],
        recap: {
          title: "ORIGINAL_TITLE_TOKEN_A",
          summary: "ORIGINAL_SUMMARY_TOKEN_A",
          bullets: ["original_bullet_one_a"],
          bottomLine: "ORIGINAL_BOTTOM_TOKEN_A",
        },
      },
    })
    .returning({ id: rawItems.id });
  rawItemIdA = idA;

  const [{ id: idB }] = await db
    .insert(rawItems)
    .values({
      tenantId: AGENTLOOP_TENANT_ID,
      sourceType: "reddit",
      externalId: seedExternalIdB,
      title: "REMOVED_ITEM_TITLE_TOKEN",
      url: "https://reddit.example.com/r/x",
      author: "bob",
      engagement: { points: 0, commentCount: 0 },
      metadata: {
        comments: [],
        recap: {
          title: "REMOVED_ITEM_TITLE",
          summary: "REMOVED_ITEM_SUMMARY_TOKEN",
          bullets: ["removed_item_bullet"],
          bottomLine: "REMOVED_ITEM_BOTTOM",
        },
      },
    })
    .returning({ id: rawItems.id });
  rawItemIdB = idB;

  await db.insert(runArchives).values({
    id: seedRunId,
    tenantId: AGENTLOOP_TENANT_ID,
    status: "completed",
    rankedItems: [],
    topN: 2,
    reviewed: false,
    completedAt: new Date(),
    digestHeadline: "DIGEST_HEAD_PHASE3",
    digestSummary: "DIGEST_SUMMARY_PHASE3",
  });
});

afterAll(async () => {
  await db.execute(sql`DELETE FROM run_archives WHERE id = ${seedRunId}::uuid`);
  await db.execute(
    sql`DELETE FROM raw_items WHERE id IN (${rawItemIdA}, ${rawItemIdB})`,
  );
});

async function readSearchText(): Promise<string | null> {
  const rows = await db.execute<{ search_text: string | null }>(sql`
    SELECT search_text FROM run_archives WHERE id = ${seedRunId}::uuid
  `);
  return rows[0]?.search_text ?? null;
}

describe("run-archives-repo updateRankedItems writes search_text (e2e)", () => {
  it("writes search_text matching serializeArchiveSearchText output exactly (override precedence)", async () => {
    const refs = [
      {
        rawItemId: rawItemIdA,
        score: 1,
        rationale: "test",
        summary: "OVERRIDE_SUMMARY_TOKEN_A",
        bullets: ["override_bullet_alpha"],
        bottomLine: "OVERRIDE_BOTTOM_TOKEN_A",
      },
    ];
    const rawRows = await rawRepo.findByIds([rawItemIdA, rawItemIdB]);
    const rawItemsById = new Map(rawRows.map((r) => [r.id, r]));

    await repo.updateRankedItems(seedRunId, refs, {
      rawItemsById,
      digestHeadline: "DIGEST_HEAD_PHASE3",
      digestSummary: "DIGEST_SUMMARY_PHASE3",
    });

    const expected = serializeArchiveSearchText({
      digestHeadline: "DIGEST_HEAD_PHASE3",
      digestSummary: "DIGEST_SUMMARY_PHASE3",
      rankedItems: refs,
      rawItemsById,
    });

    const actual = await readSearchText();
    expect(actual).toBe(expected);
    expect(actual).toContain("OVERRIDE_SUMMARY_TOKEN_A");
    expect(actual).not.toContain("ORIGINAL_SUMMARY_TOKEN_A");
  });

  it("removed item content disappears from search_text on subsequent save", async () => {
    const rawRows = await rawRepo.findByIds([rawItemIdA, rawItemIdB]);
    const rawItemsById = new Map(rawRows.map((r) => [r.id, r]));

    // First save — both items present
    await repo.updateRankedItems(
      seedRunId,
      [
        { rawItemId: rawItemIdA, score: 1, rationale: "" },
        { rawItemId: rawItemIdB, score: 0.5, rationale: "" },
      ],
      {
        rawItemsById,
        digestHeadline: "DIGEST_HEAD_PHASE3",
        digestSummary: "DIGEST_SUMMARY_PHASE3",
      },
    );
    const first = await readSearchText();
    expect(first).toContain("REMOVED_ITEM_TITLE_TOKEN");
    expect(first).toContain("REMOVED_ITEM_SUMMARY_TOKEN");

    // Second save — only A remains
    await repo.updateRankedItems(
      seedRunId,
      [{ rawItemId: rawItemIdA, score: 1, rationale: "" }],
      {
        rawItemsById,
        digestHeadline: "DIGEST_HEAD_PHASE3",
        digestSummary: "DIGEST_SUMMARY_PHASE3",
      },
    );
    const second = await readSearchText();
    expect(second).not.toContain("REMOVED_ITEM_TITLE_TOKEN");
    expect(second).not.toContain("REMOVED_ITEM_SUMMARY_TOKEN");
    expect(second).not.toContain("removed_item_bullet");
    expect(second).toContain("Quantum Cromulence");
  });
});
