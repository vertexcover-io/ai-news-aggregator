/**
 * E2E seam test for the pipeline sources repository (P8, REQ-070).
 *
 * The pipeline does not collect from source rows until P9 (REQ-073); this
 * seam guards the read contract it will rely on: `listEnabled()` returns
 * ONLY the scoped tenant's enabled rows — never another tenant's, never
 * disabled ones.
 *
 * Requires a real Postgres test DB (DATABASE_URL in .env.test).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { config } from "dotenv";
import { resolve } from "node:path";
import { sql } from "drizzle-orm";
import { tenants } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import type { TenantContext } from "@newsletter/shared/types/tenant-context";
import { createSourcesRepo } from "@pipeline/repositories/sources.js";
import { getTestDb } from "@pipeline-tests/e2e/setup/test-db.js";

config({ path: resolve(import.meta.dirname, "../../../../../../.env.test") });

const MARKER = `pipeline-sources-e2e-${Date.now().toString(36)}`;

describe("pipeline sources repo seam (REQ-070)", () => {
  let db: AppDb;
  let ctxA: TenantContext;
  let ctxB: TenantContext;

  beforeAll(async () => {
    db = getTestDb() as AppDb;
    await db.execute(
      sql.raw(
        `DELETE FROM sources WHERE tenant_id IN (SELECT id FROM tenants WHERE slug LIKE '${MARKER}%')`,
      ),
    );
    await db.execute(
      sql.raw(`DELETE FROM tenants WHERE slug LIKE '${MARKER}%'`),
    );
    const rows = await db
      .insert(tenants)
      .values([
        { slug: `${MARKER}-a`, name: "Pipeline Sources A", status: "active" },
        { slug: `${MARKER}-b`, name: "Pipeline Sources B", status: "active" },
      ])
      .returning({ id: tenants.id });
    ctxA = { tenantId: rows[0].id, role: "tenant_admin" };
    ctxB = { tenantId: rows[1].id, role: "tenant_admin" };
  });

  it("listEnabled returns only the tenant's enabled source rows", async () => {
    const repoA = createSourcesRepo(db, ctxA);
    const repoB = createSourcesRepo(db, ctxB);

    const aEnabled = await repoA.create({
      type: "reddit",
      config: { kind: "reddit", subreddit: "LocalLLaMA", sinceDays: 1 },
    });
    const aDisabled = await repoA.create({
      type: "blog",
      config: {
        kind: "web",
        name: "dead blog",
        listingUrl: "https://dead.example.com/blog",
      },
      enabled: false,
    });
    const bEnabled = await repoB.create({
      type: "hn",
      config: { kind: "hn", sinceDays: 1 },
    });

    const got = await repoA.listEnabled();
    const ids = got.map((r) => r.id);
    expect(ids).toContain(aEnabled.id);
    expect(ids).not.toContain(aDisabled.id);
    expect(ids).not.toContain(bEnabled.id);
    expect(got.every((r) => r.tenantId === ctxA.tenantId)).toBe(true);
  });
});
