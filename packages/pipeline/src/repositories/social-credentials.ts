import { and, eq } from "drizzle-orm";
import { isAllTenants, type ScopedTenantContext } from "@newsletter/shared/services";
import { socialCredentials } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import type {
  LinkedInEncryptedFields,
  TwitterEncryptedFields,
  TwitterCollectorEncryptedFields,
} from "@newsletter/shared/db";
import type { CredentialCipher } from "@newsletter/shared/services/credential-cipher";

export type SocialCredentialPlatform = "linkedin" | "twitter" | "twitter_collector";

export interface LinkedInCredentialRecord {
  clientId: string;
  clientSecret: string;
  apiVersion: string | null;
  updatedAt: Date;
}

export interface TwitterCredentialRecord {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessTokenSecret: string;
  updatedAt: Date;
}

export interface TwitterCollectorCredentialRecord {
  apiKey: string;
  updatedAt: Date;
}

export interface UpsertLinkedInInput {
  clientId: string;
  clientSecret: string;
  apiVersion?: string;
}

export interface UpsertTwitterInput {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}

export interface UpsertTwitterCollectorInput {
  apiKey: string;
}

export interface SocialCredentialsRepo {
  getLinkedIn(): Promise<LinkedInCredentialRecord | null>;
  getTwitter(): Promise<TwitterCredentialRecord | null>;
  getTwitterCollector(): Promise<TwitterCollectorCredentialRecord | null>;
  upsertLinkedIn(input: UpsertLinkedInInput): Promise<void>;
  upsertTwitter(input: UpsertTwitterInput): Promise<void>;
  upsertTwitterCollector(input: UpsertTwitterCollectorInput): Promise<void>;
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

    async getTwitter(): Promise<TwitterCredentialRecord | null> {
      const conditions = [eq(socialCredentials.platform, "twitter")];
      if (tWhere) conditions.push(tWhere);
      const rows = await db
        .select()
        .from(socialCredentials)
        .where(and(...conditions))
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

    async getTwitterCollector(): Promise<TwitterCollectorCredentialRecord | null> {
      const conditions = [eq(socialCredentials.platform, "twitter_collector")];
      if (tWhere) conditions.push(tWhere);
      const rows = await db
        .select()
        .from(socialCredentials)
        .where(and(...conditions))
        .limit(1);
      if (rows.length === 0) return null;
      const row = rows[0];
      const fields = row.encryptedFields as TwitterCollectorEncryptedFields;
      return {
        apiKey: cipher.decrypt(fields.apiKey),
        updatedAt: row.updatedAt,
      };
    },

    async upsertLinkedIn(input: UpsertLinkedInInput): Promise<void> {
      const encryptedFields: LinkedInEncryptedFields = {
        clientId: cipher.encrypt(input.clientId),
        clientSecret: cipher.encrypt(input.clientSecret),
      };
      const metadata = input.apiVersion ? { apiVersion: input.apiVersion } : null;
      const now = new Date();
      const tenantId = scoped.ctx.tenantId;
      await db
        .insert(socialCredentials)
        .values({
          tenantId,
          platform: "linkedin",
          encryptedFields,
          metadata,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [socialCredentials.tenantId, socialCredentials.platform],
          set: { encryptedFields, metadata, updatedAt: now },
        });
    },

    async upsertTwitter(input: UpsertTwitterInput): Promise<void> {
      const encryptedFields: TwitterEncryptedFields = {
        apiKey: cipher.encrypt(input.apiKey),
        apiSecret: cipher.encrypt(input.apiSecret),
        accessToken: cipher.encrypt(input.accessToken),
        accessTokenSecret: cipher.encrypt(input.accessTokenSecret),
      };
      const now = new Date();
      const tenantId = scoped.ctx.tenantId;
      await db
        .insert(socialCredentials)
        .values({
          tenantId,
          platform: "twitter",
          encryptedFields,
          metadata: null,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [socialCredentials.tenantId, socialCredentials.platform],
          set: { encryptedFields, metadata: null, updatedAt: now },
        });
    },

    async upsertTwitterCollector(input: UpsertTwitterCollectorInput): Promise<void> {
      const encryptedFields: TwitterCollectorEncryptedFields = {
        apiKey: cipher.encrypt(input.apiKey),
      };
      const now = new Date();
      const tenantId = scoped.ctx.tenantId;
      await db
        .insert(socialCredentials)
        .values({
          tenantId,
          platform: "twitter_collector",
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
      const conditions = [eq(socialCredentials.platform, platform)];
      if (tWhere) conditions.push(tWhere);
      const deleted = await db
        .delete(socialCredentials)
        .where(and(...conditions))
        .returning();
      return deleted.length > 0;
    },
  };
}
