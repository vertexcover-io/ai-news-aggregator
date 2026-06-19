/**
 * E2E integration test for run-archives repository — pre_review_snapshot column.
 *
 * REQ-001: successful upsert with preReviewSnapshot populates the column.
 * REQ-008: a subsequent upsert that omits the field does NOT overwrite it.
 * EDGE-006: a failed-status upsert does not write a snapshot.
 *
 * Requires a real Postgres test DB (DATABASE_URL in .env.test).
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { config } from "dotenv";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { runArchives } from "@newsletter/shared/db";
import { createRunArchivesRepo } from "@pipeline/repositories/run-archives.js";
import { getTestDb, truncateAll } from "@pipeline-tests/e2e/setup/test-db.js";
import { ensurePipelineTenant } from "@pipeline-tests/e2e/setup/tenant.js";
import type { TenantContext } from "@newsletter/shared/types/tenant-context";
import type { AppDb } from "@newsletter/shared/db";
import type { PreReviewSnapshot } from "@newsletter/shared/review-edits";

config({ path: resolve(import.meta.dirname, "../../../../../.env.test") });

function makeSnapshot(suffix: string): PreReviewSnapshot {
  return {
    capturedAt: "2026-05-28T12:00:00.000Z",
    rankedItemIds: [1, 2, 3],
    recap: {
      1: { title: `Title ${suffix}`, summary: "Sum", bullets: ["B1"], bottomLine: "BL" },
      2: { title: "T2", summary: "S2", bullets: [], bottomLine: "BL2" },
      3: { title: "T3", summary: "S3", bullets: ["X"], bottomLine: "BL3" },
    },
    digestMeta: {
      headline: `Headline ${suffix}`,
      summary: "Digest summary",
      hook: null,
      twitterSummary: "tweet",
    },
  };
}

describe("run-archives repo e2e — pre_review_snapshot (REQ-001, REQ-008, EDGE-006)", () => {
  let db: AppDb;
  let tenant: TenantContext;

  beforeAll(async () => {
    db = getTestDb() as AppDb;
    // tenant_id is NOT NULL — every repo write must stamp the e2e tenant
    tenant = await ensurePipelineTenant();
  });

  beforeEach(async () => {
    await truncateAll();
  });

  // REQ-001: snapshot is written on a successful upsert and round-trips correctly
  it("populates pre_review_snapshot after a completed upsert (REQ-001)", async () => {
    const runId = randomUUID();
    const repo = createRunArchivesRepo(db, tenant);
    const snapshot = makeSnapshot("initial");

    await repo.upsert({
      id: runId,
      status: "completed",
      rankedItems: [],
      topN: 3,
      completedAt: new Date("2026-05-28T12:00:00Z"),
      preReviewSnapshot: snapshot,
    });

    const rows = await db
      .select({ preReviewSnapshot: runArchives.preReviewSnapshot })
      .from(runArchives)
      .where(eq(runArchives.id, runId));

    expect(rows).toHaveLength(1);
    const stored = rows[0]?.preReviewSnapshot;
    expect(stored).not.toBeNull();
    expect(stored?.capturedAt).toBe("2026-05-28T12:00:00.000Z");
    expect(stored?.rankedItemIds).toEqual([1, 2, 3]);
    expect(stored?.digestMeta.headline).toBe("Headline initial");
  });

  // REQ-008: a second upsert that OMITS preReviewSnapshot must not overwrite the existing value
  it("does NOT overwrite pre_review_snapshot on a subsequent upsert that omits the field (REQ-008)", async () => {
    const runId = randomUUID();
    const repo = createRunArchivesRepo(db, tenant);
    const snapshot = makeSnapshot("first");

    // First upsert — writes snapshot
    await repo.upsert({
      id: runId,
      status: "completed",
      rankedItems: [],
      topN: 3,
      completedAt: new Date("2026-05-28T12:00:00Z"),
      preReviewSnapshot: snapshot,
    });

    // Second upsert — omits snapshot
    await repo.upsert({
      id: runId,
      status: "completed",
      rankedItems: [],
      topN: 3,
      completedAt: new Date("2026-05-28T13:00:00Z"),
      // no preReviewSnapshot
    });

    const rows = await db
      .select({ preReviewSnapshot: runArchives.preReviewSnapshot })
      .from(runArchives)
      .where(eq(runArchives.id, runId));

    const stored = rows[0]?.preReviewSnapshot;
    // Must still be the original snapshot
    expect(stored).not.toBeNull();
    expect(stored?.digestMeta.headline).toBe("Headline first");
  });

  // EDGE-006: failed-status upsert does not write a snapshot
  it("does not write pre_review_snapshot when status is 'failed' (EDGE-006)", async () => {
    const runId = randomUUID();
    const repo = createRunArchivesRepo(db, tenant);

    await repo.upsert({
      id: runId,
      status: "failed",
      rankedItems: [],
      topN: 0,
      completedAt: new Date("2026-05-28T12:00:00Z"),
      // no preReviewSnapshot (failed path never passes it)
    });

    const rows = await db
      .select({ preReviewSnapshot: runArchives.preReviewSnapshot })
      .from(runArchives)
      .where(eq(runArchives.id, runId));

    expect(rows[0]?.preReviewSnapshot).toBeNull();
  });

  // Verify COALESCE semantics: if the existing snapshot is null, the new value wins
  it("writes snapshot on first upsert even when previous value was null (COALESCE semantics)", async () => {
    const runId = randomUUID();
    const repo = createRunArchivesRepo(db, tenant);

    // First upsert without snapshot
    await repo.upsert({
      id: runId,
      status: "failed",
      rankedItems: [],
      topN: 0,
      completedAt: new Date("2026-05-28T10:00:00Z"),
    });

    // Second upsert with snapshot
    const snapshot = makeSnapshot("second");
    await repo.upsert({
      id: runId,
      status: "completed",
      rankedItems: [],
      topN: 3,
      completedAt: new Date("2026-05-28T12:00:00Z"),
      preReviewSnapshot: snapshot,
    });

    const rows = await db
      .select({ preReviewSnapshot: runArchives.preReviewSnapshot })
      .from(runArchives)
      .where(eq(runArchives.id, runId));

    // COALESCE(existing_null, excluded_value) = excluded_value
    expect(rows[0]?.preReviewSnapshot).not.toBeNull();
    expect(rows[0]?.preReviewSnapshot?.digestMeta.headline).toBe("Headline second");
  });
});
