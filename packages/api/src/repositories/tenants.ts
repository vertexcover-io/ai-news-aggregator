import { and, desc, eq, ne, or, sql } from "drizzle-orm";
import { tenants } from "@newsletter/shared/db";
import type { AppDb, TenantOnboarding, TenantStatus } from "@newsletter/shared/db";

export type { TenantOnboarding } from "@newsletter/shared/db";

/**
 * NOT tenant-scoped by design: this repository IS the tenant-resolution
 * surface (host -> tenant lookups, super-admin listing). It must never be
 * given a tenantId param.
 */

export interface TenantRecord {
  id: string;
  slug: string;
  previousSlug: string | null;
  name: string;
  status: TenantStatus;
  createdAt: Date;
}

export interface TenantBrandingRecord {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  headline: string | null;
  topicStrip: string | null;
  subtagline: string | null;
  logoVersion: number;
  canonEnabled: boolean;
  deliverabilityEnabled: boolean;
  evalEnabled: boolean;
}

export interface TenantBrandingUpdate {
  name?: string;
  headline?: string;
  topicStrip?: string;
  subtagline?: string | null;
}

export interface TenantLogoRecord {
  logo: Buffer;
  contentType: string;
  logoVersion: number;
}

/** Slug prefix of placeholder slugs minted at signup; never user-pickable and
 * never recorded as previous_slug (no 301 should ever point at a placeholder). */
export const PENDING_SLUG_PREFIX = "pending-";

export interface TenantOnboardingStateRecord {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  headline: string | null;
  topicStrip: string | null;
  subtagline: string | null;
  logoVersion: number;
  onboarding: TenantOnboarding | null;
}

export type SetSlugResult =
  | { ok: true; slug: string; previousSlug: string | null }
  | { ok: false; reason: "taken" | "not_found" };

export interface TenantsRepo {
  findById(id: string): Promise<TenantRecord | null>;
  findBySlug(slug: string): Promise<TenantRecord | null>;
  findByPreviousSlug(slug: string): Promise<TenantRecord | null>;
  listActive(): Promise<TenantRecord[]>;
  list(): Promise<TenantRecord[]>;
  updateStatus(id: string, status: TenantStatus): Promise<TenantRecord | null>;
  getBranding(id: string): Promise<TenantBrandingRecord | null>;
  updateBranding(
    id: string,
    patch: TenantBrandingUpdate,
  ): Promise<TenantBrandingRecord | null>;
  getLogo(id: string): Promise<TenantLogoRecord | null>;
  /** Stores the logo bytes and bumps logo_version; returns the new version. */
  setLogo(
    id: string,
    logo: Buffer,
    contentType: string,
  ): Promise<number | null>;
  getOnboardingState(id: string): Promise<TenantOnboardingStateRecord | null>;
  updateOnboarding(id: string, onboarding: TenantOnboarding): Promise<void>;
  /** Uniqueness probe for live slug checks; excludes the asking tenant so its
   * own current slug reads as available. Also treats another tenant's
   * previous_slug as taken — claiming it would hijack that tenant's 301
   * redirect traffic (EDGE-002). */
  isSlugTaken(slug: string, excludeTenantId: string): Promise<boolean>;
  /** Sets the slug, recording the old one as previous_slug when it was a real
   * (non-placeholder) slug so the 301 redirect path keeps working. Rejects
   * slugs held as another tenant's slug OR previous_slug (EDGE-002). Race-safe
   * on the slug column: a concurrent claim surfaces as { ok: false, reason:
   * "taken" } via the tenants_slug_unique constraint (EDGE-001). */
  setSlug(id: string, slug: string): Promise<SetSlugResult>;
}

const TENANT_COLUMNS = {
  id: tenants.id,
  slug: tenants.slug,
  previousSlug: tenants.previousSlug,
  name: tenants.name,
  status: tenants.status,
  createdAt: tenants.createdAt,
} as const;

const BRANDING_COLUMNS = {
  id: tenants.id,
  slug: tenants.slug,
  name: tenants.name,
  status: tenants.status,
  headline: tenants.headline,
  topicStrip: tenants.topicStrip,
  subtagline: tenants.subtagline,
  logoVersion: tenants.logoVersion,
  canonEnabled: tenants.canonEnabled,
  deliverabilityEnabled: tenants.deliverabilityEnabled,
  evalEnabled: tenants.evalEnabled,
} as const;

const ONBOARDING_COLUMNS = {
  id: tenants.id,
  slug: tenants.slug,
  name: tenants.name,
  status: tenants.status,
  headline: tenants.headline,
  topicStrip: tenants.topicStrip,
  subtagline: tenants.subtagline,
  logoVersion: tenants.logoVersion,
  onboarding: tenants.onboarding,
} as const;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Matches a 23505 on tenants_slug_unique, including driver errors arriving
 * wrapped in err.cause (same pattern as users.ts email detection). */
function isSlugUniqueViolation(err: unknown): boolean {
  const candidates = [err, (err as { cause?: unknown } | null)?.cause];
  return candidates.some(
    (candidate) =>
      typeof candidate === "object" &&
      candidate !== null &&
      (candidate as { code?: unknown }).code === "23505" &&
      (candidate as { constraint_name?: unknown }).constraint_name ===
        "tenants_slug_unique",
  );
}

export function createTenantsRepo(
  db: Pick<AppDb, "select" | "update">,
): TenantsRepo {
  async function slugHeldByOther(
    slug: string,
    excludeTenantId: string,
  ): Promise<boolean> {
    const rows = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(
        and(
          or(eq(tenants.slug, slug), eq(tenants.previousSlug, slug)),
          ne(tenants.id, excludeTenantId),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  return {
    async findById(id: string): Promise<TenantRecord | null> {
      if (!UUID_RE.test(id)) return null;
      const rows = await db
        .select(TENANT_COLUMNS)
        .from(tenants)
        .where(eq(tenants.id, id))
        .limit(1);
      return rows[0] ?? null;
    },

    async findBySlug(slug: string): Promise<TenantRecord | null> {
      const rows = await db
        .select(TENANT_COLUMNS)
        .from(tenants)
        .where(eq(tenants.slug, slug))
        .limit(1);
      return rows[0] ?? null;
    },

    async findByPreviousSlug(slug: string): Promise<TenantRecord | null> {
      const rows = await db
        .select(TENANT_COLUMNS)
        .from(tenants)
        .where(eq(tenants.previousSlug, slug))
        .limit(1);
      return rows[0] ?? null;
    },

    async listActive(): Promise<TenantRecord[]> {
      return db
        .select(TENANT_COLUMNS)
        .from(tenants)
        .where(eq(tenants.status, "active"))
        .orderBy(desc(tenants.createdAt));
    },

    async list(): Promise<TenantRecord[]> {
      return db
        .select(TENANT_COLUMNS)
        .from(tenants)
        .orderBy(desc(tenants.createdAt));
    },

    async updateStatus(
      id: string,
      status: TenantStatus,
    ): Promise<TenantRecord | null> {
      if (!UUID_RE.test(id)) return null;
      const rows = await db
        .update(tenants)
        .set({ status, updatedAt: new Date() })
        .where(eq(tenants.id, id))
        .returning(TENANT_COLUMNS);
      return rows[0] ?? null;
    },

    async getBranding(id: string): Promise<TenantBrandingRecord | null> {
      if (!UUID_RE.test(id)) return null;
      const rows = await db
        .select(BRANDING_COLUMNS)
        .from(tenants)
        .where(eq(tenants.id, id))
        .limit(1);
      return rows[0] ?? null;
    },

    async updateBranding(
      id: string,
      patch: TenantBrandingUpdate,
    ): Promise<TenantBrandingRecord | null> {
      if (!UUID_RE.test(id)) return null;
      const rows = await db
        .update(tenants)
        .set({
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.headline !== undefined ? { headline: patch.headline } : {}),
          ...(patch.topicStrip !== undefined
            ? { topicStrip: patch.topicStrip }
            : {}),
          ...(patch.subtagline !== undefined
            ? { subtagline: patch.subtagline }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(tenants.id, id))
        .returning(BRANDING_COLUMNS);
      return rows[0] ?? null;
    },

    async getLogo(id: string): Promise<TenantLogoRecord | null> {
      if (!UUID_RE.test(id)) return null;
      const rows = await db
        .select({
          logo: tenants.logo,
          contentType: tenants.logoContentType,
          logoVersion: tenants.logoVersion,
        })
        .from(tenants)
        .where(eq(tenants.id, id))
        .limit(1);
      const row = rows.at(0);
      if (!row) return null;
      if (row.logo === null || row.contentType === null) return null;
      return {
        logo: row.logo,
        contentType: row.contentType,
        logoVersion: row.logoVersion,
      };
    },

    async setLogo(
      id: string,
      logo: Buffer,
      contentType: string,
    ): Promise<number | null> {
      if (!UUID_RE.test(id)) return null;
      const rows = await db
        .update(tenants)
        .set({
          logo,
          logoContentType: contentType,
          logoVersion: sql`${tenants.logoVersion} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(tenants.id, id))
        .returning({ logoVersion: tenants.logoVersion });
      return rows[0]?.logoVersion ?? null;
    },

    async getOnboardingState(
      id: string,
    ): Promise<TenantOnboardingStateRecord | null> {
      if (!UUID_RE.test(id)) return null;
      const rows = await db
        .select(ONBOARDING_COLUMNS)
        .from(tenants)
        .where(eq(tenants.id, id))
        .limit(1);
      return rows[0] ?? null;
    },

    async updateOnboarding(
      id: string,
      onboarding: TenantOnboarding,
    ): Promise<void> {
      if (!UUID_RE.test(id)) return;
      await db
        .update(tenants)
        .set({ onboarding, updatedAt: new Date() })
        .where(eq(tenants.id, id));
    },

    async isSlugTaken(
      slug: string,
      excludeTenantId: string,
    ): Promise<boolean> {
      return slugHeldByOther(slug, excludeTenantId);
    },

    async setSlug(id: string, slug: string): Promise<SetSlugResult> {
      if (!UUID_RE.test(id)) return { ok: false, reason: "not_found" };
      const rows = await db
        .select({ slug: tenants.slug, previousSlug: tenants.previousSlug })
        .from(tenants)
        .where(eq(tenants.id, id))
        .limit(1);
      const current = rows.at(0);
      if (!current) return { ok: false, reason: "not_found" };
      if (current.slug === slug) {
        return { ok: true, slug, previousSlug: current.previousSlug };
      }
      if (await slugHeldByOther(slug, id)) {
        return { ok: false, reason: "taken" };
      }
      const isPlaceholder = current.slug.startsWith(PENDING_SLUG_PREFIX);
      const previousSlug = isPlaceholder
        ? current.previousSlug
        : current.slug;
      try {
        const updated = await db
          .update(tenants)
          .set({ slug, previousSlug, updatedAt: new Date() })
          .where(eq(tenants.id, id))
          .returning({
            slug: tenants.slug,
            previousSlug: tenants.previousSlug,
          });
        const row = updated.at(0);
        if (!row) return { ok: false, reason: "not_found" };
        return { ok: true, slug: row.slug, previousSlug: row.previousSlug };
      } catch (err) {
        if (isSlugUniqueViolation(err)) return { ok: false, reason: "taken" };
        throw err;
      }
    },
  };
}
