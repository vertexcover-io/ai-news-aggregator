/**
 * Shared pipeline e2e tenant fixture (P4 write-side).
 *
 * tenant_id is NOT NULL with no DB DEFAULT on every tenant-owned table
 * (migration 0041), so pre-tenancy e2e suites must seed a concrete tenant
 * and stamp `tenantId` on every write. The pipeline runs single-tenant as
 * AGENTLOOP until P9, so the fixture seeds the same `agentloop` slug the
 * production single-tenant bridge (`primeDefaultTenantScope`) resolves —
 * worker default-deps built during a test then stamp this tenant too.
 */
import { tenants } from "@newsletter/shared/db";
import type { TenantContext } from "@newsletter/shared/types/tenant-context";
import {
  primeDefaultTenantScope,
  resetDefaultTenantScopeForTests,
} from "@pipeline/repositories/default-tenant.js";
import { getTestDb } from "./test-db.js";

const E2E_TENANT_SLUG = "agentloop";

/**
 * Upserts (by slug) the AGENTLOOP tenant, primes the pipeline's default
 * tenant scope against the test DB, and returns the tenant context.
 * Idempotent and safe to call from every suite's beforeAll — the seam suite
 * runs single-forked, so the re-prime keeps the module-level cache pointed
 * at a live tenant row even across files.
 */
export async function ensurePipelineTenant(): Promise<TenantContext> {
  const db = getTestDb();
  await db
    .insert(tenants)
    .values({
      slug: E2E_TENANT_SLUG,
      name: "AgentLoop (pipeline e2e)",
      status: "active",
    })
    .onConflictDoUpdate({
      target: tenants.slug,
      set: { updatedAt: new Date() },
    });
  resetDefaultTenantScopeForTests();
  const scope = await primeDefaultTenantScope(db);
  if (!scope) {
    throw new Error("ensurePipelineTenant: failed to prime default tenant scope");
  }
  return scope;
}
