/**
 * e2e: tenant isolation at the repository seam, against the real DB.
 *
 * REQ-012: every repository read/write of tenant-owned data is filtered by
 *          the resolved tenant_id.
 * REQ-013: a resource id owned by another tenant behaves as not-found.
 * REQ-120: no repository path returns another tenant's data.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import type { TenantContext } from "@newsletter/shared/types/tenant-context";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
config({ path: resolve(REPO_ROOT, ".env") });

const { getDb, tenants, runArchives, runLogs } = await import(
  "@newsletter/shared/db"
);
const { createMustReadRepo } = await import("@api/repositories/must-read.js");
const { createSubscribersRepo } = await import(
  "@api/repositories/subscribers.js"
);
const { createEvalRunsRepo } = await import("@api/repositories/eval-runs.js");
const { createRunLogRepo } = await import("@api/repositories/run-logs.js");
const { createRunArchivesRepo } = await import(
  "@api/repositories/run-archives.js"
);

const db = getDb();

const STAMP = Date.now().toString(36);
const MARKER = `tenant-isolation-e2e-${STAMP}`;

let tenantAId: string;
let tenantBId: string;
let ctxA: TenantContext;
let ctxB: TenantContext;

async function cleanup(): Promise<void> {
  for (const table of [
    "must_read_entries",
    "subscribers",
    "eval_runs",
    "run_logs",
    "run_archives",
  ]) {
    await db.execute(
      sql.raw(
        `DELETE FROM ${table} WHERE tenant_id IN (SELECT id FROM tenants WHERE slug LIKE '${MARKER}%')`,
      ),
    );
  }
  await db.execute(sql.raw(`DELETE FROM tenants WHERE slug LIKE '${MARKER}%'`));
}

beforeAll(async () => {
  await cleanup();
  const rows = await db
    .insert(tenants)
    .values([
      { slug: `${MARKER}-a`, name: "Isolation Tenant A", status: "active" },
      { slug: `${MARKER}-b`, name: "Isolation Tenant B", status: "active" },
    ])
    .returning({ id: tenants.id });
  tenantAId = rows[0].id;
  tenantBId = rows[1].id;
  ctxA = { tenantId: tenantAId, role: "tenant_admin" };
  ctxB = { tenantId: tenantBId, role: "tenant_admin" };
});

afterAll(cleanup);

describe("test_REQ_012_repo_queries_scope_by_tenant", () => {
  it("must-read: tenant A cannot list or read tenant B's entries", async () => {
    const repoA = createMustReadRepo(db, ctxA);
    const repoB = createMustReadRepo(db, ctxB);

    const aEntry = await repoA.create({
      url: `https://example.com/${MARKER}/a`,
      title: `${MARKER} A entry`,
      author: null,
      year: null,
      annotation: "A only",
    });
    const bEntry = await repoB.create({
      url: `https://example.com/${MARKER}/b`,
      title: `${MARKER} B entry`,
      author: null,
      year: null,
      annotation: "B only",
    });

    const aList = await repoA.listAdmin();
    expect(aList.map((e) => e.id)).toContain(aEntry.id);
    expect(aList.map((e) => e.id)).not.toContain(bEntry.id);

    const aPublic = await repoA.listPublic();
    expect(aPublic.map((e) => e.id)).not.toContain(bEntry.id);

    expect(await repoA.count()).toBe(1);
  });

  it("subscribers: confirmed list is tenant-scoped", async () => {
    const repoA = createSubscribersRepo(db, ctxA);
    const repoB = createSubscribersRepo(db, ctxB);

    await repoA.create({
      email: `${MARKER}-a@example.com`,
      status: "confirmed",
    });
    const bSub = await repoB.create({
      email: `${MARKER}-b@example.com`,
      status: "confirmed",
    });

    const aConfirmed = await repoA.listConfirmed();
    expect(aConfirmed.map((s) => s.id)).not.toContain(bSub.id);
    expect(aConfirmed).toHaveLength(1);
    expect(await repoA.countConfirmed()).toBe(1);

    // findByEmail across the fence resolves nothing for tenant A.
    expect(await repoA.findByEmail(`${MARKER}-b@example.com`)).toBeNull();
  });

  it("eval runs: list is tenant-scoped", async () => {
    const repoA = createEvalRunsRepo(db, ctxA);
    const repoB = createEvalRunsRepo(db, ctxB);

    const aRun = await repoA.insert({
      mode: "scored",
      fixtureId: `${MARKER}-fixture`,
      date: null,
      windowSize: null,
      draftPromptHash: "hash-a",
      draftPromptSnapshot: "prompt A",
      savedPromptHash: null,
      savedPromptSnapshot: null,
    });
    const bRun = await repoB.insert({
      mode: "scored",
      fixtureId: `${MARKER}-fixture`,
      date: null,
      windowSize: null,
      draftPromptHash: "hash-b",
      draftPromptSnapshot: "prompt B",
      savedPromptHash: null,
      savedPromptSnapshot: null,
    });

    const aListing = await repoA.list({ page: 1, perPage: 50 });
    const aIds = aListing.runs.map((r) => r.id);
    expect(aIds).toContain(aRun.id);
    expect(aIds).not.toContain(bRun.id);
  });

  it("run logs: listForRun does not leak another tenant's run logs", async () => {
    const bRunId = randomUUID();
    await db.insert(runLogs).values({
      runId: bRunId,
      level: "info",
      stage: "collect",
      event: "stage_started",
      message: `${MARKER} B log`,
      tenantId: tenantBId,
    });

    const repoA = createRunLogRepo(db, ctxA);
    const repoB = createRunLogRepo(db, ctxB);
    expect(await repoA.listForRun(bRunId)).toHaveLength(0);
    expect(await repoB.listForRun(bRunId)).toHaveLength(1);
  });
});

describe("test_REQ_013_cross_tenant_id_returns_404", () => {
  it("must-read findById/update/delete behave as not-found across the fence", async () => {
    const repoB = createMustReadRepo(db, ctxB);
    const bEntry = await repoB.create({
      url: `https://example.com/${MARKER}/cross`,
      title: `${MARKER} cross entry`,
      author: null,
      year: null,
      annotation: "B only",
    });

    const repoA = createMustReadRepo(db, ctxA);
    expect(await repoA.findById(bEntry.id)).toBeNull();
    expect(await repoA.update(bEntry.id, { title: "hijacked" })).toBeNull();
    expect(await repoA.delete(bEntry.id)).toBe(false);

    // And the row is untouched for its owner.
    const stillThere = await repoB.findById(bEntry.id);
    expect(stillThere?.title).toBe(`${MARKER} cross entry`);
  });

  it("run archives findById is not-found across the fence", async () => {
    const bArchiveId = randomUUID();
    await db.insert(runArchives).values({
      id: bArchiveId,
      status: "completed",
      rankedItems: [],
      topN: 10,
      completedAt: new Date(),
      tenantId: tenantBId,
    });

    const repoA = createRunArchivesRepo(db, ctxA);
    const repoB = createRunArchivesRepo(db, ctxB);
    expect(await repoA.findById(bArchiveId)).toBeNull();
    expect(await repoB.findById(bArchiveId)).not.toBeNull();
  });

  it("eval runs getById is not-found across the fence", async () => {
    const repoB = createEvalRunsRepo(db, ctxB);
    const bRun = await repoB.insert({
      mode: "scored",
      fixtureId: `${MARKER}-cross`,
      date: null,
      windowSize: null,
      draftPromptHash: "hash-cross",
      draftPromptSnapshot: "prompt cross",
      savedPromptHash: null,
      savedPromptSnapshot: null,
    });

    const repoA = createEvalRunsRepo(db, ctxA);
    expect(await repoA.getById(bRun.id)).toBeNull();
    expect(await repoB.getById(bRun.id)).not.toBeNull();
  });

  it("subscribers findById/findByIds are not-found across the fence", async () => {
    const repoB = createSubscribersRepo(db, ctxB);
    const bSub = await repoB.create({
      email: `${MARKER}-cross@example.com`,
      status: "confirmed",
    });

    const repoA = createSubscribersRepo(db, ctxA);
    expect(await repoA.findById(bSub.id)).toBeNull();
    expect(await repoA.findByIds([bSub.id])).toHaveLength(0);
  });
});

describe("test_REQ_120_isolation_suite_zero_cross_tenant", () => {
  it("no tenant-A repository read surfaces any tenant-B row", async () => {
    const mustReadA = createMustReadRepo(db, ctxA);
    const subscribersA = createSubscribersRepo(db, ctxA);
    const evalRunsA = createEvalRunsRepo(db, ctxA);

    const leaked: string[] = [];
    const surfaces: (readonly [string, readonly { tenantId?: string | null }[]])[] = [
      ["mustRead.listAdmin", await mustReadA.listAdmin()],
      ["subscribers.listConfirmed", await subscribersA.listConfirmed()],
      [
        "evalRuns.list",
        // eval list rows do not carry tenantId on the wire; re-check via ids
        (await evalRunsA.list({ page: 1, perPage: 100 })).runs.map((r) => ({
          tenantId: undefined,
          id: r.id,
        })),
      ],
    ];

    for (const [name, rows] of surfaces) {
      for (const row of rows) {
        if (row.tenantId === tenantBId) leaked.push(name);
      }
    }
    // eval runs: assert by id non-membership instead.
    const evalIdsA = (await evalRunsA.list({ page: 1, perPage: 100 })).runs.map(
      (r) => r.id,
    );
    const evalRunsB = createEvalRunsRepo(db, ctxB);
    const evalIdsB = (await evalRunsB.list({ page: 1, perPage: 100 })).runs.map(
      (r) => r.id,
    );
    for (const idB of evalIdsB) {
      if (evalIdsA.includes(idB)) leaked.push(`evalRuns.list:${idB}`);
    }

    expect(leaked).toEqual([]);
  });
});
