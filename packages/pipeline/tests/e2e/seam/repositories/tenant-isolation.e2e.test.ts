/**
 * E2E integration: tenant isolation across pipeline repositories (REQ-012/013).
 *
 * Two tenants are seeded; repos created with tenant A's context must never
 * surface tenant B's raw_items / run_archives / user_settings / subscribers.
 *
 * Requires a real Postgres test DB (DATABASE_URL in .env.test).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { config } from "dotenv";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  tenants,
  userSettings,
  subscribers,
  rawItems as rawItemsTable,
} from "@newsletter/shared/db";
import type { TenantContext } from "@newsletter/shared/types/tenant-context";
import { createRawItemsRepo } from "@pipeline/repositories/raw-items.js";
import { createRunArchivesRepo } from "@pipeline/repositories/run-archives.js";
import { createUserSettingsRepo } from "@pipeline/repositories/user-settings.js";
import { createPipelineSubscribersRepo } from "@pipeline/repositories/subscribers.js";
import { getTestDb } from "@pipeline-tests/e2e/setup/test-db.js";

config({ path: resolve(import.meta.dirname, "../../../../../../.env.test") });

const MARKER = "pipeline-tenant-isolation";

let tenantAId: string;
let tenantBId: string;
let ctxA: TenantContext;
let ctxB: TenantContext;

beforeAll(async () => {
  const db = getTestDb();
  for (const table of [
    "raw_items",
    "run_archives",
    "user_settings",
    "subscribers",
  ]) {
    await db.execute(
      sql.raw(
        `DELETE FROM ${table} WHERE tenant_id IN (SELECT id FROM tenants WHERE slug LIKE '${MARKER}%')`,
      ),
    );
  }
  await db.execute(
    sql.raw(`DELETE FROM tenants WHERE slug LIKE '${MARKER}%'`),
  );
  const rows = await db
    .insert(tenants)
    .values([
      { slug: `${MARKER}-a`, name: "Pipeline Tenant A", status: "active" },
      { slug: `${MARKER}-b`, name: "Pipeline Tenant B", status: "active" },
    ])
    .returning({ id: tenants.id });
  tenantAId = rows[0].id;
  tenantBId = rows[1].id;
  ctxA = { tenantId: tenantAId, role: "tenant_admin" };
  ctxB = { tenantId: tenantBId, role: "tenant_admin" };
});

describe("test_REQ_012_repo_queries_scope_by_tenant (pipeline)", () => {
  it("raw items: upsert stamps tenant_id and reads are fenced", async () => {
    const db = getTestDb();
    const repoA = createRawItemsRepo(db, ctxA);
    const repoB = createRawItemsRepo(db, ctxB);

    await repoA.upsertItems([
      {
        sourceType: "hn",
        externalId: `${MARKER}-a-1`,
        title: "A item",
        url: "https://example.com/a",
      },
    ]);
    await repoB.upsertItems([
      {
        sourceType: "hn",
        externalId: `${MARKER}-b-1`,
        title: "B item",
        url: "https://example.com/b",
      },
    ]);

    const aSeen = await repoA.findExistingExternalIds("hn", [
      `${MARKER}-a-1`,
      `${MARKER}-b-1`,
    ]);
    expect(aSeen.has(`${MARKER}-a-1`)).toBe(true);
    expect(aSeen.has(`${MARKER}-b-1`)).toBe(false);

    // REQ-013: by-id style lookup across the fence resolves to not-found.
    expect(
      await repoA.findBySourceAndExternalId("hn", `${MARKER}-b-1`),
    ).toBeNull();
    const bRow = await repoB.findBySourceAndExternalId("hn", `${MARKER}-b-1`);
    expect(bRow).not.toBeNull();
    if (bRow) {
      expect(await repoA.findByIds([bRow.id])).toHaveLength(0);
    }
  });

  it("raw items: two tenants collecting the SAME story keep independent rows (REQ-064)", async () => {
    const db = getTestDb();
    const repoA = createRawItemsRepo(db, ctxA);
    const repoB = createRawItemsRepo(db, ctxB);
    const runA = randomUUID();
    const runB = randomUUID();
    const sharedId = `${MARKER}-shared-1`;

    await repoA.upsertItems([
      {
        sourceType: "hn",
        externalId: sharedId,
        title: "Shared story",
        url: "https://example.com/shared",
        runId: runA,
      },
    ]);
    // Tenant B collecting the same story must NOT rewrite tenant A's row
    // (previously the global (source_type, external_id) unique made this
    // upsert clobber A's runId while storing nothing for B).
    await repoB.upsertItems([
      {
        sourceType: "hn",
        externalId: sharedId,
        title: "Shared story",
        url: "https://example.com/shared",
        runId: runB,
      },
    ]);

    const aRow = await repoA.findBySourceAndExternalId("hn", sharedId);
    const bRow = await repoB.findBySourceAndExternalId("hn", sharedId);
    expect(aRow).not.toBeNull();
    expect(bRow).not.toBeNull();
    expect(aRow?.id).not.toBe(bRow?.id);
    // Lineage stays per tenant: A's row still points at A's run.
    const aRunIds = await db
      .select({ runId: rawItemsTable.runId })
      .from(rawItemsTable)
      .where(sql`${rawItemsTable.id} = ${aRow?.id ?? -1}`);
    expect(aRunIds[0]?.runId).toBe(runA);
  });

  it("run archives: upsert stamps tenant_id; findById is fenced (REQ-013)", async () => {
    const db = getTestDb();
    const repoA = createRunArchivesRepo(db, ctxA);
    const repoB = createRunArchivesRepo(db, ctxB);

    const bRunId = randomUUID();
    await repoB.upsert({
      id: bRunId,
      status: "completed",
      rankedItems: [],
      topN: 10,
      completedAt: new Date(),
    });

    expect(await repoA.findById(bRunId)).toBeNull();
    expect(await repoB.findById(bRunId)).not.toBeNull();

    // Cross-tenant mutation is a silent no-op on B's row.
    await repoA.markEmailSent(bRunId, new Date());
    const bRow = await repoB.findById(bRunId);
    expect(bRow?.emailSentAt ?? null).toBeNull();
  });

  it("user settings: get() resolves the calling tenant's row only", async () => {
    const db = getTestDb();
    await db.insert(userSettings).values([
      settingsRow(tenantAId, 7),
      settingsRow(tenantBId, 13),
    ]);

    const repoA = createUserSettingsRepo(db, ctxA);
    const repoB = createUserSettingsRepo(db, ctxB);
    expect((await repoA.get())?.topN).toBe(7);
    expect((await repoB.get())?.topN).toBe(13);
  });

  it("subscribers: confirmed list and findByIds are fenced", async () => {
    const db = getTestDb();
    const inserted = await db
      .insert(subscribers)
      .values([
        {
          email: `${MARKER}-a@example.com`,
          status: "confirmed",
          tenantId: tenantAId,
        },
        {
          email: `${MARKER}-b@example.com`,
          status: "confirmed",
          tenantId: tenantBId,
        },
      ])
      .returning({ id: subscribers.id, tenantId: subscribers.tenantId });

    const bId = inserted.find((r) => r.tenantId === tenantBId)?.id;
    const repoA = createPipelineSubscribersRepo(db, ctxA);

    const aList = await repoA.listConfirmed();
    expect(aList.map((s) => s.tenantId)).not.toContain(tenantBId);
    expect(await repoA.countConfirmed()).toBe(1);
    if (bId !== undefined) {
      expect(await repoA.findByIds([bId])).toHaveLength(0);
    }
  });
});

function settingsRow(
  tenantId: string,
  topN: number,
): typeof userSettings.$inferInsert {
  return {
    tenantId,
    singleton: true,
    topN,
    halfLifeHours: 24,
    hnEnabled: true,
    redditEnabled: false,
    webEnabled: false,
    twitterEnabled: false,
    webSearchEnabled: false,
    posthogEnabled: false,
    pipelineTime: "06:00",
    emailTime: "08:00",
    linkedinTime: "09:00",
    twitterTime: "09:30",
    scheduleTimezone: "UTC",
    scheduleEnabled: false,
    emailEnabled: false,
    linkedinEnabled: false,
    twitterPostEnabled: false,
    autoReview: false,
    rankingPrompt: "rank",
    shortlistPrompt: "shortlist",
    shortlistSize: 30,
  };
}
