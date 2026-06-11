/**
 * Tenant-level social credentials (P12, REQ-083): rows are keyed
 * `(tenant_id, platform)` and hold ONLY per-tenant secrets — the tenant's
 * Twitter OAuth1 posting keys. App-level secrets (LinkedIn client, Twitter
 * collector cookie) live in `app_credentials` (see app-credentials.ts).
 */
import { eq } from "drizzle-orm";
import { scopedTenantId, socialCredentials, tenantScoped } from "@newsletter/shared/db";
import type { AppDb, TenantScope } from "@newsletter/shared/db";
import type { TwitterEncryptedFields } from "@newsletter/shared/db";
import type { CredentialCipher } from "@newsletter/shared/services/credential-cipher";

export type SocialCredentialPlatform = "twitter";

export interface TwitterCredentialRecord {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessTokenSecret: string;
  updatedAt: Date;
}

export interface UpsertTwitterInput {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}

export interface SocialCredentialsRepo {
  getTwitter(): Promise<TwitterCredentialRecord | null>;
  upsertTwitter(input: UpsertTwitterInput): Promise<void>;
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
    async getTwitter(): Promise<TwitterCredentialRecord | null> {
      const rows = await db
        .select()
        .from(socialCredentials)
        .where(tenantScoped(socialCredentials.tenantId, ctx, eq(socialCredentials.platform, "twitter")))
        .limit(1);
      if (rows.length === 0) return null;
      const row = rows[0];
      const fields = row.encryptedFields as TwitterEncryptedFields;
      return {
        apiKey: cipher.decrypt(fields.apiKey),
        apiSecret: cipher.decrypt(fields.apiSecret),
        accessToken: cipher.decrypt(fields.accessToken),
        accessTokenSecret: cipher.decrypt(fields.accessTokenSecret),
        updatedAt: row.updatedAt,
      };
    },

    async upsertTwitter(input: UpsertTwitterInput): Promise<void> {
      const encryptedFields: TwitterEncryptedFields = {
        apiKey: cipher.encrypt(input.apiKey),
        apiSecret: cipher.encrypt(input.apiSecret),
        accessToken: cipher.encrypt(input.accessToken),
        accessTokenSecret: cipher.encrypt(input.accessTokenSecret),
      };
      const now = new Date();
      await db
        .insert(socialCredentials)
        .values({
          platform: "twitter",
          tenantId: requireTenantId(ctx),
          encryptedFields,
          metadata: null,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [socialCredentials.tenantId, socialCredentials.platform],
          set: { encryptedFields, metadata: null, updatedAt: now },
        });
    },

    async delete(platform: SocialCredentialPlatform): Promise<boolean> {
      const deleted = await db
        .delete(socialCredentials)
        .where(tenantScoped(socialCredentials.tenantId, ctx, eq(socialCredentials.platform, platform)))
        .returning();
      return deleted.length > 0;
    },
  };
}
