/**
 * e2e: Cross-tenant isolation against the real DB.
 * Verifies REQ-012 (repo queries scoped by tenant) and REQ-013 (cross-tenant id → not-found).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
config({ path: resolve(REPO_ROOT, ".env") });

const { getDb } = await import("@newsletter/shared/db");
const { createRunArchivesRepo } = await import(
  "@api/repositories/run-archives.js"
);
import type { TenantContext } from "@newsletter/shared/types/tenant-context";

const db = getDb();

const TENANT_A: TenantContext = {
  tenantId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  role: "tenant_admin",
};

const TENANT_B: TenantContext = {
  tenantId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  role: "tenant_admin",
};

const RUN_ID_A = "aaaa1111-aaaa-1111-aaaa-1111aaaaaaaa";
const RUN_ID_B = "bbbb1111-bbbb-1111-bbbb-1111bbbbbbbb";

async function wipe(): Promise<void> {
  await db.execute(
    sql`DELETE FROM run_archives WHERE id IN (${RUN_ID_A}::uuid, ${RUN_ID_B}::uuid)`,
  );
  await db.execute(
    sql`DELETE FROM users WHERE email IN ('tenant-a@test.com', 'tenant-b@test.com')`,
  );
  await db.execute(
    sql`DELETE FROM tenants WHERE id IN (${TENANT_A.tenantId}::uuid, ${TENANT_B.tenantId}::uuid)`,
  );
}

async function seed(): Promise<void> {
  // Create tenants
  await db.execute(sql`
    INSERT INTO tenants (id, slug, name, status)
    VALUES
      (${TENANT_A.tenantId}::uuid, 'tenant-a', 'Tenant A', 'active'),
      (${TENANT_B.tenantId}::uuid, 'tenant-b', 'Tenant B', 'active')
    ON CONFLICT (id) DO NOTHING
  `);

  // Create runs for each tenant
  await db.execute(sql`
    INSERT INTO run_archives (id, status, ranked_items, top_n, completed_at, created_at, updated_at, tenant_id)
    VALUES
      (${RUN_ID_A}::uuid, 'completed', '[]'::jsonb, 0, now(), now(), now(), ${TENANT_A.tenantId}::uuid),
      (${RUN_ID_B}::uuid, 'completed', '[]'::jsonb, 0, now(), now(), now(), ${TENANT_B.tenantId}::uuid)
    ON CONFLICT (id) DO NOTHING
  `);
}

beforeAll(async () => {
  await wipe();
  await seed();
});

afterAll(async () => {
  await wipe();
});

describe("Phase 4: Cross-tenant isolation (e2e)", () => {
  it("REQ-012: Tenant A can read its own data", async () => {
    const repo = createRunArchivesRepo(db, TENANT_A);
    const result = await repo.findById(RUN_ID_A);
    expect(result).not.toBeNull();
    expect(result?.id).toBe(RUN_ID_A);
  });

  it("REQ-012: Tenant B can read its own data", async () => {
    const repo = createRunArchivesRepo(db, TENANT_B);
    const result = await repo.findById(RUN_ID_B);
    expect(result).not.toBeNull();
    expect(result?.id).toBe(RUN_ID_B);
  });

  it("REQ-012: Tenant B cannot read Tenant A's data (cross-tenant isolation)", async () => {
    const repo = createRunArchivesRepo(db, TENANT_B);
    const result = await repo.findById(RUN_ID_A);
    expect(result).toBeNull();
  });

  it("REQ-013: Tenant A cannot read Tenant B's data (cross-tenant → not-found)", async () => {
    const repo = createRunArchivesRepo(db, TENANT_A);
    const result = await repo.findById(RUN_ID_B);
    expect(result).toBeNull();
  });

  it("BOOTSTRAP scoped to bootstrap tenant reads nothing from real tenants", async () => {
    const bootstrapCtx: TenantContext = {
      tenantId: "00000000-0000-0000-0000-000000000000",
      role: "super_admin",
    };
    const repo = createRunArchivesRepo(db, bootstrapCtx);
    const result = await repo.findById(RUN_ID_A);
    expect(result).toBeNull();
  });
});
