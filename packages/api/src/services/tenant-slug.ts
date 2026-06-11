/**
 * Slug-change handler (P5, REQ-023). Validates the new slug against the
 * shared P1 constants (format + reserved words) and global uniqueness, then
 * persists it while recording the outgoing slug so the host→tenant resolver
 * can 301-redirect `<old-slug>.<root>` to the new slug host (EDGE-002).
 */
import {
  isReservedTenantSlug,
  isValidTenantSlugFormat,
} from "@newsletter/shared/constants/tenant";
import type { TenantRow } from "@newsletter/shared/db";
import type { TenantsRepo } from "../repositories/tenants.js";

export type SlugRejection = "invalid" | "reserved" | "taken" | "not_found";

export class SlugChangeError extends Error {
  constructor(public readonly code: SlugRejection) {
    super(`slug change rejected: ${code}`);
    this.name = "SlugChangeError";
  }
}

export interface ChangeTenantSlugDeps {
  tenantsRepo: Pick<TenantsRepo, "findById" | "findBySlug" | "updateSlug">;
}

export async function changeTenantSlug(
  deps: ChangeTenantSlugDeps,
  tenantId: string,
  rawSlug: string,
): Promise<TenantRow> {
  const slug = rawSlug.trim().toLowerCase();
  if (!isValidTenantSlugFormat(slug)) throw new SlugChangeError("invalid");
  if (isReservedTenantSlug(slug)) throw new SlugChangeError("reserved");

  const current = await deps.tenantsRepo.findById(tenantId);
  if (current === null) throw new SlugChangeError("not_found");
  if (current.slug === slug) return current; // no-op rename

  const holder = await deps.tenantsRepo.findBySlug(slug);
  if (holder !== null) throw new SlugChangeError("taken");

  const updated = await deps.tenantsRepo.updateSlug(tenantId, slug);
  if (updated === null) throw new SlugChangeError("not_found");
  return updated;
}
