import { and, eq } from "drizzle-orm";
import { isAllTenants, type ScopedTenantContext, BOOTSTRAP_CONTEXT } from "@newsletter/shared/services";
import { socialCredentials } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import type {
  LinkedInEncryptedFields,
  TwitterEncryptedFields,
  TwitterCollectorEncryptedFields,
} from "@newsletter/shared/db";
import type { CredentialCipher } from "@newsletter/shared/services/credential-cipher";

export interface LinkedInCredentialRecord {
  clientId: string;
  clientSecret: string;
  apiVersion: string | null;
  updatedAt: Date;
}

export type SocialCredentialPlatform = "linkedin" | "twitter" | "twitter_collector";

export interface LinkedInUpsertInput {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly apiVersion?: string;
}

export interface TwitterUpsertInput {
  readonly apiKey: string;
  readonly apiSecret: string;
  readonly accessToken: string;
  readonly accessTokenSecret: string;
}

export interface TwitterCollectorUpsertInput {
  readonly apiKey: string;
}

export interface LinkedInStatus {
  readonly configured: boolean;
  readonly apiVersion: string | null;
  readonly updatedAt: string | null;
}

export interface TwitterStatus {
  readonly configured: boolean;
  readonly updatedAt: string | null;
}

export interface TwitterCollectorStatus {
  readonly configured: boolean;
  readonly updatedAt: string | null;
}

export interface SocialCredentialsStatus {
  readonly linkedin: LinkedInStatus;
  readonly twitter: TwitterStatus;
  readonly twitterCollector: TwitterCollectorStatus;
}

export interface SocialCredentialsRepo {
  getStatus(): Promise<SocialCredentialsStatus>;
  /**
   * Returns the decrypted LinkedIn client credentials for the scoped tenant,
   * or null when no row exists. Uses the cipher to decrypt encryptedFields.
   */
  getLinkedIn(): Promise<LinkedInCredentialRecord | null>;
  upsertLinkedIn(input: LinkedInUpsertInput): Promise<{ updatedAt: string }>;
  upsertTwitter(input: TwitterUpsertInput): Promise<{ updatedAt: string }>;
  upsertTwitterCollector(
    input: TwitterCollectorUpsertInput,
  ): Promise<{ updatedAt: string }>;
  delete(platform: SocialCredentialPlatform): Promise<boolean>;
}

type DbSlice = Pick<AppDb, "select" | "insert" | "delete">;

function tenantWhere(scoped: ScopedTenantContext) {
  return isAllTenants(scoped)
    ? undefined
    : eq(socialCredentials.tenantId, scoped.ctx.tenantId);
}

export function createSocialCredentialsRepo(
  db: DbSlice,
  cipher: CredentialCipher,
  scoped: ScopedTenantContext,
): SocialCredentialsRepo {
  const tWhere = tenantWhere(scoped);

  return {
    async getLinkedIn(): Promise<LinkedInCredentialRecord | null> {
      const conditions = [eq(socialCredentials.platform, "linkedin")];
      if (tWhere) conditions.push(tWhere);
      const rows = await db
        .select()
        .from(socialCredentials)
        .where(and(...conditions))
        .limit(1);
      if (rows.length === 0) return null;
      const row = rows[0];
      const fields = row.encryptedFields as LinkedInEncryptedFields;
      return {
        clientId: cipher.decrypt(fields.clientId),
        clientSecret: cipher.decrypt(fields.clientSecret),
        apiVersion: row.metadata?.apiVersion ?? null,
        updatedAt: row.updatedAt,
      };
    },

    async getStatus(): Promise<SocialCredentialsStatus> {
      const base = db.select().from(socialCredentials);
      const rows = tWhere
        ? await base.where(tWhere)
        : await base;
      let linkedin: LinkedInStatus = {
        configured: false,
        apiVersion: null,
        updatedAt: null,
      };
      let twitter: TwitterStatus = { configured: false, updatedAt: null };
      let twitterCollector: TwitterCollectorStatus = {
        configured: false,
        updatedAt: null,
      };
      for (const row of rows) {
        if (row.platform === "linkedin") {
          linkedin = {
            configured: true,
            apiVersion: row.metadata?.apiVersion ?? null,
            updatedAt: row.updatedAt.toISOString(),
          };
        } else if (row.platform === "twitter") {
          twitter = {
            configured: true,
            updatedAt: row.updatedAt.toISOString(),
          };
        } else {
          twitterCollector = {
            configured: true,
            updatedAt: row.updatedAt.toISOString(),
          };
        }
      }
      return { linkedin, twitter, twitterCollector };
    },

    async upsertLinkedIn(input: LinkedInUpsertInput): Promise<{ updatedAt: string }> {
      const encryptedFields: LinkedInEncryptedFields = {
        clientId: cipher.encrypt(input.clientId),
        clientSecret: cipher.encrypt(input.clientSecret),
      };
      const metadata = input.apiVersion ? { apiVersion: input.apiVersion } : null;
      const now = new Date();
      const tenantId = scoped.ctx.tenantId;
      const [row] = await db
        .insert(socialCredentials)
        .values({
          tenantId,
          platform: "linkedin",
          encryptedFields,
          metadata,
          updatedAt: now,
          updatedBy: "admin",
        })
        .onConflictDoUpdate({
          target: [socialCredentials.tenantId, socialCredentials.platform],
          set: { encryptedFields, metadata, updatedAt: now, updatedBy: "admin" },
        })
        .returning();
      return { updatedAt: row.updatedAt.toISOString() };
    },

    async upsertTwitter(input: TwitterUpsertInput): Promise<{ updatedAt: string }> {
      const encryptedFields: TwitterEncryptedFields = {
        apiKey: cipher.encrypt(input.apiKey),
        apiSecret: cipher.encrypt(input.apiSecret),
        accessToken: cipher.encrypt(input.accessToken),
        accessTokenSecret: cipher.encrypt(input.accessTokenSecret),
      };
      const now = new Date();
      const tenantId = scoped.ctx.tenantId;
      const [row] = await db
        .insert(socialCredentials)
        .values({
          tenantId,
          platform: "twitter",
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

    async upsertTwitterCollector(
      input: TwitterCollectorUpsertInput,
    ): Promise<{ updatedAt: string }> {
      const encryptedFields: TwitterCollectorEncryptedFields = {
        apiKey: cipher.encrypt(input.apiKey),
      };
      const now = new Date();
      const tenantId = scoped.ctx.tenantId;
      const [row] = await db
        .insert(socialCredentials)
        .values({
          tenantId,
          platform: "twitter_collector",
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
      const conditions = [eq(socialCredentials.platform, platform)];
      if (tWhere) conditions.push(tWhere);
      const result = await db
        .delete(socialCredentials)
        .where(and(...conditions))
        .returning({ platform: socialCredentials.platform });
      return result.length > 0;
    },
  };
}
