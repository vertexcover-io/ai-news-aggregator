/**
 * Tenant-level social credentials (P12, REQ-083): rows keyed
 * `(tenant_id, platform)`, holding ONLY per-tenant secrets — the tenant's
 * Twitter OAuth1 posting keys. App-level secrets (LinkedIn client, Twitter
 * collector cookie) live in `app_credentials` (see app-credentials.ts) and
 * are writable only via super-admin routes (REQ-082).
 */
import { eq } from "drizzle-orm";
import { scopedTenantId, socialCredentials, tenantScoped } from "@newsletter/shared/db";
import type { AppDb, TenantScope } from "@newsletter/shared/db";
import type { TwitterEncryptedFields } from "@newsletter/shared/db";
import type { CredentialCipher } from "@newsletter/shared/services/credential-cipher";

export type SocialCredentialPlatform = "twitter";

export interface TwitterUpsertInput {
  readonly apiKey: string;
  readonly apiSecret: string;
  readonly accessToken: string;
  readonly accessTokenSecret: string;
}

export interface TwitterStatus {
  readonly configured: boolean;
  readonly updatedAt: string | null;
}

export interface SocialCredentialsStatus {
  readonly twitter: TwitterStatus;
}

export interface SocialCredentialsRepo {
  getStatus(): Promise<SocialCredentialsStatus>;
  upsertTwitter(input: TwitterUpsertInput): Promise<{ updatedAt: string }>;
  delete(platform: SocialCredentialPlatform): Promise<boolean>;
}

type DbSlice = Pick<AppDb, "select" | "insert" | "delete">;

/**
 * tenant_id is part of the PK (P12) — writes must stamp a concrete tenant.
 * Reads stay scope-optional (legacy unscoped mode), but an unscoped write
 * would be a cross-tenant bug, so it throws loudly.
 */
function requireTenantId(ctx: TenantScope | undefined): string {
  const tenantId = scopedTenantId(ctx);
  if (tenantId === undefined) {
    throw new Error(
      "social_credentials write requires a concrete tenant scope (tenant_id is part of the primary key)",
    );
  }
  return tenantId;
}

export function createSocialCredentialsRepo(
  db: DbSlice,
  cipher: CredentialCipher,
  ctx?: TenantScope,
): SocialCredentialsRepo {
  return {
    async getStatus(): Promise<SocialCredentialsStatus> {
      const rows = await db
        .select()
        .from(socialCredentials)
        .where(tenantScoped(socialCredentials.tenantId, ctx, eq(socialCredentials.platform, "twitter")))
        .limit(1);
      if (rows.length === 0) {
        return { twitter: { configured: false, updatedAt: null } };
      }
      return {
        twitter: {
          configured: true,
          updatedAt: rows[0].updatedAt.toISOString(),
        },
      };
    },

    async upsertTwitter(input: TwitterUpsertInput): Promise<{ updatedAt: string }> {
      const encryptedFields: TwitterEncryptedFields = {
        apiKey: cipher.encrypt(input.apiKey),
        apiSecret: cipher.encrypt(input.apiSecret),
        accessToken: cipher.encrypt(input.accessToken),
        accessTokenSecret: cipher.encrypt(input.accessTokenSecret),
      };
      const now = new Date();
      const [row] = await db
        .insert(socialCredentials)
        .values({
          platform: "twitter",
          tenantId: requireTenantId(ctx),
          encryptedFields,
          metadata: null,
          updatedAt: now,
          updatedBy: "admin",
        })
        .onConflictDoUpdate({
          target: [socialCredentials.tenantId, socialCredentials.platform],
          set: { encryptedFields, metadata: null, updatedAt: now, updatedBy: "admin" },
        })
        .returning();
      return { updatedAt: row.updatedAt.toISOString() };
    },

    async delete(platform: SocialCredentialPlatform): Promise<boolean> {
      const result = await db
        .delete(socialCredentials)
        .where(tenantScoped(socialCredentials.tenantId, ctx, eq(socialCredentials.platform, platform)))
        .returning({ platform: socialCredentials.platform });
      return result.length > 0;
    },
  };
}
