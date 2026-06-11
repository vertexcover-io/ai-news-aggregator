import { asc, count, desc, eq, max, sql } from "drizzle-orm";
import { runArchives, subscribers, tenants, users } from "@newsletter/shared/db";
import type { AppDb, TenantRow } from "@newsletter/shared/db";
import type {
  OnboardingState,
  SendingDomainRecord,
  SendingDomainStatus,
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
   * Every tenant, oldest first, plus the console list stats: owner email
   * (earliest tenant_admin), confirmed-subscriber count, and latest
   * completed run; bare tenants degrade to null/0/null. Super-admin console
   * only (REQ-100; the route sits behind requireSuperAdmin). `tenants` is
   * platform-level, not a tenant-owned table, so no TenantScope applies.
   */
  listAllWithStats(): Promise<TenantWithStats[]>;
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
  /**
   * Persists the tenant's Resend sending-domain state (P14, REQ-084/085):
   * {name, domainId, status, records} as returned by `domains.create` /
   * `domains.get`. The broadcast gate (REQ-053) reads `sendingDomainStatus`.
   */
  updateSendingDomain(
    id: string,
    patch: SendingDomainPatch,
  ): Promise<TenantRow | null>;
}

/** One tenant + the aggregates the super-admin console renders (P15). */
export interface TenantWithStats {
  tenant: TenantRow;
  /** Earliest tenant_admin user's email; null for a tenant with no owner. */
  ownerEmail: string | null;
  /** Confirmed subscribers only — pending/unsubscribed never count. */
  subscriberCount: number;
  /** Latest archived run's completedAt; null when the tenant never ran. */
  lastRunAt: Date | null;
}

export interface SendingDomainPatch {
  sendingDomainName: string;
  sendingDomainId: string;
  sendingDomainStatus: SendingDomainStatus;
  sendingDomainRecords: SendingDomainRecord[];
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

    async listAllWithStats(): Promise<TenantWithStats[]> {
      const rows = await db.select().from(tenants).orderBy(tenants.createdAt);
      // Earliest tenant_admin per tenant = the signup owner (P3 creates the
      // owner first; later operators would sort after it).
      const owners = await db
        .select({ tenantId: users.tenantId, email: users.email })
        .from(users)
        .where(eq(users.role, "tenant_admin"))
        .orderBy(asc(users.createdAt));
      const ownerByTenant = new Map<string, string>();
      for (const owner of owners) {
        if (owner.tenantId !== null && !ownerByTenant.has(owner.tenantId)) {
          ownerByTenant.set(owner.tenantId, owner.email);
        }
      }
      const subCounts = await db
        .select({ tenantId: subscribers.tenantId, n: count() })
        .from(subscribers)
        .where(eq(subscribers.status, "confirmed"))
        .groupBy(subscribers.tenantId);
      const subsByTenant = new Map<string, number>();
      for (const row of subCounts) {
        if (row.tenantId !== null) subsByTenant.set(row.tenantId, row.n);
      }
      const lastRuns = await db
        .select({
          tenantId: runArchives.tenantId,
          lastRunAt: max(runArchives.completedAt),
        })
        .from(runArchives)
        .groupBy(runArchives.tenantId);
      const lastRunByTenant = new Map<string, Date>();
      for (const row of lastRuns) {
        if (row.tenantId !== null && row.lastRunAt !== null) {
          lastRunByTenant.set(row.tenantId, row.lastRunAt);
        }
      }
      return rows.map((tenant) => ({
        tenant,
        ownerEmail: ownerByTenant.get(tenant.id) ?? null,
        subscriberCount: subsByTenant.get(tenant.id) ?? 0,
        lastRunAt: lastRunByTenant.get(tenant.id) ?? null,
      }));
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

    async updateSendingDomain(
      id: string,
      patch: SendingDomainPatch,
    ): Promise<TenantRow | null> {
      const rows = await db
        .update(tenants)
        .set({ ...patch, updatedAt: new Date() })
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
