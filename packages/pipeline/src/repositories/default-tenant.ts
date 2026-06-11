/**
 * Default (single-tenant bridge) tenant resolution for pipeline workers.
 *
 * Until P9 threads a tenant id through every BullMQ job payload, the pipeline
 * runs single-tenant as AGENTLOOP. Every tenant-owned write (raw_items,
 * run_archives, run_logs, email_sends, social_credentials, social_tokens)
 * must stamp a concrete `tenant_id` — the column is NOT NULL with no DB
 * DEFAULT — so worker bootstrap resolves the AGENTLOOP tenant once and the
 * default-deps builders construct every repo with that ctx.
 *
 * - `primeDefaultTenantScope()` — awaited once in the pipeline entrypoint
 *   BEFORE any worker is created (and lazily by async per-job factories).
 * - `getDefaultTenantScope()` — sync read for construction-time wiring; falls
 *   back to `undefined` (legacy unscoped mode) when never primed, which is
 *   the case in unit tests that inject fake repos.
 *
 * P9 deletes this module in favor of per-job tenant contexts.
 */
import { eq, asc } from "drizzle-orm";
import { tenants, type AppDb } from "@newsletter/shared/db";
import type { TenantContext } from "@newsletter/shared/types/tenant-context";

const DEFAULT_TENANT_SLUG = "agentloop";

let cachedScope: TenantContext | undefined;
let inflight: Promise<TenantContext | undefined> | undefined;

async function resolve(db: AppDb): Promise<TenantContext | undefined> {
  const bySlug = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, DEFAULT_TENANT_SLUG))
    .limit(1);
  if (bySlug.length > 0) {
    return { tenantId: bySlug[0].id, role: "tenant_admin" };
  }
  const oldest = await db
    .select({ id: tenants.id })
    .from(tenants)
    .orderBy(asc(tenants.createdAt))
    .limit(1);
  if (oldest.length === 0) return undefined;
  return { tenantId: oldest[0].id, role: "tenant_admin" };
}

/**
 * Resolve and cache the default tenant scope. Safe to call concurrently;
 * subsequent calls return the cached value without re-querying.
 */
export async function primeDefaultTenantScope(
  db: AppDb,
): Promise<TenantContext | undefined> {
  if (cachedScope) return cachedScope;
  inflight ??= resolve(db).then((scope) => {
    cachedScope = scope;
    inflight = undefined;
    return scope;
  });
  return inflight;
}

/** Construction-time sync read; `undefined` until primed (legacy mode). */
export function getDefaultTenantScope(): TenantContext | undefined {
  return cachedScope;
}

/** Test-only reset hook. */
export function resetDefaultTenantScopeForTests(): void {
  cachedScope = undefined;
  inflight = undefined;
}
