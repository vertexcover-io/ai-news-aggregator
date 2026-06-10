import { eq } from "drizzle-orm";
import { tenants } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import type { TenantSelect } from "@newsletter/shared/db";
import type { DnsRecord, DomainVerificationStatus, OnboardingState } from "@newsletter/shared/types";
import type { EncryptedBlob } from "@newsletter/shared/services";

export interface TenantsRepo {
  findById(id: string): Promise<TenantSelect | null>;
  findBySlug(slug: string): Promise<TenantSelect | null>;
  /** Find a tenant by its custom_domain column (DB-backed custom domains). */
  findByCustomDomain(domain: string): Promise<TenantSelect | null>;
  /** Find a tenant where old_slug matches (for 301 redirect from old slug). */
  findByOldSlug(oldSlug: string): Promise<TenantSelect | null>;
  /** List all tenants (super-admin only). */
  listAll(): Promise<TenantSelect[]>;
  create(input: CreateTenantInput): Promise<TenantSelect>;
  /** Update the tenant's sending-domain fields after Resend registration/verification. */
  updateDomain(tenantId: string, data: UpdateDomainInput): Promise<TenantSelect>;
  /** Update tenant onboarding fields (name, slug, branding, onboardingState, status). */
  update(tenantId: string, data: UpdateTenantInput): Promise<TenantSelect>;
  /** Update per-tenant notification config (notify_email + encrypted slack_webhook). */
  updateNotifications(tenantId: string, data: UpdateNotificationsInput): Promise<TenantSelect>;
  /** Update per-tenant feature flags (canon, deliverability, eval). */
  updateFeatures(tenantId: string, data: UpdateFeaturesInput): Promise<TenantSelect>;
}

export interface CreateTenantInput {
  slug: string;
  name: string;
}

export interface UpdateDomainInput {
  domainId?: string | null;
  domainName?: string | null;
  domainStatus?: DomainVerificationStatus | null;
  domainRecords?: DnsRecord[] | null;
}

export interface UpdateTenantInput {
  name?: string;
  slug?: string;
  headline?: string | null;
  topicStrip?: string | null;
  subtagline?: string | null;
  onboardingState?: OnboardingState | null;
  status?: string;
  logoBytes?: Uint8Array | null;
  logoContentType?: string | null;
  oldSlug?: string | null;
}

export interface UpdateNotificationsInput {
  notifyEmail: string | null;
  slackWebhook: EncryptedBlob | null;
}

export interface UpdateFeaturesInput {
  featureCanon: boolean;
  featureDeliverability: boolean;
  featureEval: boolean;
}

export function createTenantsRepo(db: Pick<AppDb, "select" | "insert" | "update">): TenantsRepo {
  return {
    async findById(id: string): Promise<TenantSelect | null> {
      const rows = await db
        .select()
        .from(tenants)
        .where(eq(tenants.id, id))
        .limit(1);
      return rows[0] ?? null;
    },

    async findBySlug(slug: string): Promise<TenantSelect | null> {
      const rows = await db
        .select()
        .from(tenants)
        .where(eq(tenants.slug, slug))
        .limit(1);
      return rows[0] ?? null;
    },

    async findByCustomDomain(domain: string): Promise<TenantSelect | null> {
      const rows = await db
        .select()
        .from(tenants)
        .where(eq(tenants.customDomain, domain))
        .limit(1);
      return rows[0] ?? null;
    },

    async findByOldSlug(oldSlug: string): Promise<TenantSelect | null> {
      const rows = await db
        .select()
        .from(tenants)
        .where(eq(tenants.oldSlug, oldSlug))
        .limit(1);
      return rows[0] ?? null;
    },

    async listAll(): Promise<TenantSelect[]> {
      return db.select().from(tenants).orderBy(tenants.name);
    },

    async create(input: CreateTenantInput): Promise<TenantSelect> {
      const [row] = await db
        .insert(tenants)
        .values({
          slug: input.slug,
          name: input.name,
          status: "pending_setup",
        })
        .returning();
      return row;
    },

    async updateDomain(tenantId: string, data: UpdateDomainInput): Promise<TenantSelect> {
      const [row] = await db
        .update(tenants)
        .set({
          domainId: data.domainId,
          domainName: data.domainName,
          domainStatus: data.domainStatus,
          domainRecords: data.domainRecords,
        })
        .where(eq(tenants.id, tenantId))
        .returning();
      return row;
    },

    async update(tenantId: string, data: UpdateTenantInput): Promise<TenantSelect> {
      const set: Record<string, unknown> = {};
      if (data.name !== undefined) set.name = data.name;
      if (data.slug !== undefined) set.slug = data.slug;
      if (data.headline !== undefined) set.headline = data.headline;
      if (data.topicStrip !== undefined) set.topicStrip = data.topicStrip;
      if (data.subtagline !== undefined) set.subtagline = data.subtagline;
      if (data.onboardingState !== undefined) set.onboardingState = data.onboardingState;
      if (data.status !== undefined) set.status = data.status;
      if (data.logoBytes !== undefined) set.logoBytes = data.logoBytes;
      if (data.logoContentType !== undefined) set.logoContentType = data.logoContentType;
      if (data.oldSlug !== undefined) set.oldSlug = data.oldSlug;
      set.updatedAt = new Date();
      const [row] = await db
        .update(tenants)
        .set(set)
        .where(eq(tenants.id, tenantId))
        .returning();
      return row;
    },

    async updateNotifications(tenantId: string, data: UpdateNotificationsInput): Promise<TenantSelect> {
      const [row] = await db
        .update(tenants)
        .set({
          notifyEmail: data.notifyEmail,
          slackWebhook: data.slackWebhook,
        })
        .where(eq(tenants.id, tenantId))
        .returning();
      return row;
    },

    async updateFeatures(tenantId: string, data: UpdateFeaturesInput): Promise<TenantSelect> {
      const [row] = await db
        .update(tenants)
        .set({
          featureCanon: data.featureCanon,
          featureDeliverability: data.featureDeliverability,
          featureEval: data.featureEval,
        })
        .where(eq(tenants.id, tenantId))
        .returning();
      return row;
    },
  };
}
