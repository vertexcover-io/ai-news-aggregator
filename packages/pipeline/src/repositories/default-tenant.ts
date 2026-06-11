/**
 * Per-job tenant resolution (P9) + the default (single-tenant bridge) tenant
 * fallback for pipeline workers.
 *
 * Since P9, every job payload carries `tenantId` (REQ-060) and workers build
 * their repos from {@link jobTenantContext}. The AGENTLOOP default bridge
 * remains ONLY as the fallback for jobs with genuinely no tenant context:
 * in-flight jobs enqueued before the P9 deploy and scheduler entries created
 * pre-P9 (their persisted `data` lacks tenantId until the next reconcile).
 * Every tenant-owned write (raw_items, run_archives, run_logs, email_sends,
 * social_credentials, social_tokens) must stamp a concrete `tenant_id` — the
 * column is NOT NULL with no DB DEFAULT — so the fallback resolves the
 * AGENTLOOP tenant rather than ever writing unscoped.
 *
 * - `jobTenantContext(job.data)` — pure: the job's tenant ctx, if present.
 * - `resolveJobTenantScope(db, job.data)` — job ctx, else the primed bridge.
 * - `primeDefaultTenantScope()` — awaited once in the pipeline entrypoint
 *   BEFORE any worker is created (and lazily by async per-job factories).
 * - `getDefaultTenantScope()` — sync read for construction-time wiring; falls
 *   back to `undefined` (legacy unscoped mode) when never primed, which is
 *   the case in unit tests that inject fake repos.
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

/**
 * Tenant context carried by a P9 job payload (REQ-060), or `undefined` for
 * legacy in-flight jobs. Pure — safe for unit-tested handlers.
 */
export function jobTenantContext(
  data: { tenantId?: unknown } | undefined,
): TenantContext | undefined {
  const tenantId = data?.tenantId;
  if (typeof tenantId === "string" && tenantId.length > 0) {
    return { tenantId, role: "tenant_admin" };
  }
  return undefined;
}

/**
 * Scope for a job's repositories: the payload tenant (REQ-061/064), falling
 * back to the AGENTLOOP bridge for legacy jobs with no tenant context.
 */
export async function resolveJobTenantScope(
  db: AppDb,
  data: { tenantId?: unknown } | undefined,
): Promise<TenantContext | undefined> {
  return jobTenantContext(data) ?? primeDefaultTenantScope(db);
}
