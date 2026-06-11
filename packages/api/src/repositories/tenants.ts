import { desc, eq, sql } from "drizzle-orm";
import { tenants } from "@newsletter/shared/db";
import type { AppDb, TenantRow } from "@newsletter/shared/db";
import type {
  OnboardingState,
  TenantStatus,
} from "@newsletter/shared/types/tenant";

// Row type re-exported so routes/services can type tenants without importing
// the restricted DB module (S-api-01).
export type { TenantRow };

export interface CreateTenantInput {
  slug: string;
  name: string;
  status: TenantStatus;
}

export interface TenantsRepo {
  findById(id: string): Promise<TenantRow | null>;
  findBySlug(slug: string): Promise<TenantRow | null>;
  /**
   * Every tenant, oldest first — super-admin console only (REQ-100; the
   * route sits behind requireSuperAdmin). `tenants` is platform-level, not
   * a tenant-owned table, so no TenantScope applies.
   */
  listAll(): Promise<TenantRow[]>;
  /**
   * Most recently renamed tenant whose pre-rename slug matches (P5,
   * REQ-023/EDGE-002 — the resolver 301-redirects old slug hosts).
   */
  findByPreviousSlug(slug: string): Promise<TenantRow | null>;
  create(input: CreateTenantInput): Promise<TenantRow>;
  /** Sets the new slug and records the outgoing one in `previousSlug`. */
  updateSlug(id: string, newSlug: string): Promise<TenantRow | null>;
  /** Persists resumable wizard progress (P11, REQ-030). */
  updateOnboardingState(
    id: string,
    state: OnboardingState,
  ): Promise<TenantRow | null>;
  /**
   * Stores validated logo bytes + content type (P11, REQ-029). Callers must
   * have run `validateLogo` first — a rejected upload never reaches here, so
   * the previously stored logo stays intact (REQ-039).
   */
  updateLogo(
    id: string,
    bytes: Buffer,
    contentType: string,
  ): Promise<TenantRow | null>;
  /**
   * Applies the wizard's profile slots and flips the tenant `active`
   * (P11, REQ-035) in one update.
   */
  completeOnboarding(
    id: string,
    profile: OnboardingCompletionProfile,
  ): Promise<TenantRow | null>;
}

export interface OnboardingCompletionProfile {
  name: string;
  headline: string;
  topicStrip: string | null;
  subtagline: string | null;
  onboardingState: OnboardingState;
}

export function createTenantsRepo(
  db: Pick<AppDb, "select" | "insert" | "update">,
): TenantsRepo {
  return {
    async findById(id: string): Promise<TenantRow | null> {
      const rows = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
      return rows[0] ?? null;
    },

    async findBySlug(slug: string): Promise<TenantRow | null> {
      const rows = await db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
      return rows[0] ?? null;
    },

    async listAll(): Promise<TenantRow[]> {
      return db.select().from(tenants).orderBy(tenants.createdAt);
    },

    async findByPreviousSlug(slug: string): Promise<TenantRow | null> {
      // Most recent rename wins if several tenants ever held the same slug.
      const rows = await db
        .select()
        .from(tenants)
        .where(eq(tenants.previousSlug, slug))
        .orderBy(desc(tenants.updatedAt))
        .limit(1);
      return rows[0] ?? null;
    },

    async updateSlug(id: string, newSlug: string): Promise<TenantRow | null> {
      const rows = await db
        .update(tenants)
        .set({
          previousSlug: sql`${tenants.slug}`,
          slug: newSlug,
          updatedAt: new Date(),
        })
        .where(eq(tenants.id, id))
        .returning();
      return rows[0] ?? null;
    },

    async updateOnboardingState(
      id: string,
      state: OnboardingState,
    ): Promise<TenantRow | null> {
      const rows = await db
        .update(tenants)
        .set({ onboardingState: state, updatedAt: new Date() })
        .where(eq(tenants.id, id))
        .returning();
      return rows[0] ?? null;
    },

    async updateLogo(
      id: string,
      bytes: Buffer,
      contentType: string,
    ): Promise<TenantRow | null> {
      const rows = await db
        .update(tenants)
        .set({
          logoBytes: bytes,
          logoContentType: contentType,
          updatedAt: new Date(),
        })
        .where(eq(tenants.id, id))
        .returning();
      return rows[0] ?? null;
    },

    async completeOnboarding(
      id: string,
      profile: OnboardingCompletionProfile,
    ): Promise<TenantRow | null> {
      const rows = await db
        .update(tenants)
        .set({
          name: profile.name,
          headline: profile.headline,
          topicStrip: profile.topicStrip,
          subtagline: profile.subtagline,
          onboardingState: profile.onboardingState,
          status: "active",
          updatedAt: new Date(),
        })
        .where(eq(tenants.id, id))
        .returning();
      return rows[0] ?? null;
    },

    async create(input: CreateTenantInput): Promise<TenantRow> {
      const [row] = await db
        .insert(tenants)
        .values({ slug: input.slug, name: input.name, status: input.status })
        .returning();
      return row;
    },
  };
}
