import { eq } from "drizzle-orm";
import { appCredentials } from "@newsletter/shared/db";
import type { AppDb, AppCredentialPlatform } from "@newsletter/shared/db";
import type { CredentialCipher } from "@newsletter/shared/services/credential-cipher";
import type { EncryptedBlob } from "@newsletter/shared/services/credential-cipher";

export interface LinkedInDecrypted {
  clientId: string;
  clientSecret: string;
  apiVersion: string | null;
  updatedAt: Date;
}

export interface TwitterOAuth2Decrypted {
  clientId: string;
  clientSecret: string;
  updatedAt: Date;
}

export interface TwitterCollectorDecrypted {
  apiKey: string;
  updatedAt: Date;
}

export interface LinkedInUpsertInput {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly apiVersion?: string;
}

export interface TwitterOAuth2UpsertInput {
  readonly clientId: string;
  readonly clientSecret: string;
}

export interface TwitterCollectorUpsertInput {
  readonly apiKey: string;
}

export interface AppCredentialStatus {
  readonly configured: boolean;
  readonly updatedAt: string | null;
}

export interface AppCredentialsStatus {
  readonly linkedin: AppCredentialStatus;
  readonly twitter: AppCredentialStatus;
  readonly twitterCollector: AppCredentialStatus;
}

export interface AppCredentialsRepo {
  getLinkedIn(): Promise<LinkedInDecrypted | null>;
  getTwitter(): Promise<TwitterOAuth2Decrypted | null>;
  getTwitterCollector(): Promise<TwitterCollectorDecrypted | null>;
  getStatus(): Promise<AppCredentialsStatus>;
  upsertLinkedIn(input: LinkedInUpsertInput): Promise<{ updatedAt: string }>;
  upsertTwitter(input: TwitterOAuth2UpsertInput): Promise<{ updatedAt: string }>;
  upsertTwitterCollector(input: TwitterCollectorUpsertInput): Promise<{ updatedAt: string }>;
  delete(platform: AppCredentialPlatform): Promise<boolean>;
}

type DbSlice = Pick<AppDb, "select" | "insert" | "delete">;

interface LinkedInEncryptedFields {
  clientId: EncryptedBlob;
  clientSecret: EncryptedBlob;
}

interface TwitterOAuth2EncryptedFields {
  clientId: EncryptedBlob;
  clientSecret: EncryptedBlob;
}

interface TwitterCollectorEncryptedFields {
  apiKey: EncryptedBlob;
}

export function createAppCredentialsRepo(
  db: DbSlice,
  cipher: CredentialCipher,
): AppCredentialsRepo {
  return {
    async getLinkedIn(): Promise<LinkedInDecrypted | null> {
      const rows = await db
        .select()
        .from(appCredentials)
        .where(eq(appCredentials.platform, "linkedin"))
        .limit(1);
      if (rows.length === 0) return null;
      const row = rows[0];
      const fields = row.encryptedFields as unknown as LinkedInEncryptedFields;
      return {
        clientId: cipher.decrypt(fields.clientId),
        clientSecret: cipher.decrypt(fields.clientSecret),
        apiVersion: row.metadata?.apiVersion ?? null,
        updatedAt: row.updatedAt,
      };
    },

    async getTwitter(): Promise<TwitterOAuth2Decrypted | null> {
      const rows = await db
        .select()
        .from(appCredentials)
        .where(eq(appCredentials.platform, "twitter"))
        .limit(1);
      if (rows.length === 0) return null;
      const row = rows[0];
      const fields = row.encryptedFields as unknown as TwitterOAuth2EncryptedFields;
      return {
        clientId: cipher.decrypt(fields.clientId),
        clientSecret: cipher.decrypt(fields.clientSecret),
        updatedAt: row.updatedAt,
      };
    },

    async getTwitterCollector(): Promise<TwitterCollectorDecrypted | null> {
      const rows = await db
        .select()
        .from(appCredentials)
        .where(eq(appCredentials.platform, "twitter_collector"))
        .limit(1);
      if (rows.length === 0) return null;
      const row = rows[0];
      const fields = row.encryptedFields as unknown as TwitterCollectorEncryptedFields;
      return {
        apiKey: cipher.decrypt(fields.apiKey),
        updatedAt: row.updatedAt,
      };
    },

    async getStatus(): Promise<AppCredentialsStatus> {
      const rows = await db.select().from(appCredentials);
      let linkedin: AppCredentialStatus = { configured: false, updatedAt: null };
      let twitter: AppCredentialStatus = { configured: false, updatedAt: null };
      let twitterCollector: AppCredentialStatus = { configured: false, updatedAt: null };
      for (const row of rows) {
        switch (row.platform) {
          case "linkedin":
            linkedin = { configured: true, updatedAt: row.updatedAt.toISOString() };
            break;
          case "twitter":
            twitter = { configured: true, updatedAt: row.updatedAt.toISOString() };
            break;
          case "twitter_collector":
            twitterCollector = { configured: true, updatedAt: row.updatedAt.toISOString() };
            break;
        }
      }
      return { linkedin, twitter, twitterCollector };
    },

    async upsertLinkedIn(input: LinkedInUpsertInput): Promise<{ updatedAt: string }> {
      const encryptedFields = {
        clientId: cipher.encrypt(input.clientId),
        clientSecret: cipher.encrypt(input.clientSecret),
      };
      const metadata = input.apiVersion ? { apiVersion: input.apiVersion } : null;
      const now = new Date();
      const [row] = await db
        .insert(appCredentials)
        .values({
          platform: "linkedin",
          encryptedFields: encryptedFields as Record<string, EncryptedBlob>,
          metadata,
          updatedAt: now,
          updatedBy: "super_admin",
        })
        .onConflictDoUpdate({
          target: appCredentials.platform,
          set: { encryptedFields: encryptedFields as Record<string, EncryptedBlob>, metadata, updatedAt: now, updatedBy: "super_admin" },
        })
        .returning();
      return { updatedAt: row.updatedAt.toISOString() };
    },

    async upsertTwitter(input: TwitterOAuth2UpsertInput): Promise<{ updatedAt: string }> {
      const encryptedFields = {
        clientId: cipher.encrypt(input.clientId),
        clientSecret: cipher.encrypt(input.clientSecret),
      };
      const now = new Date();
      const [row] = await db
        .insert(appCredentials)
        .values({
          platform: "twitter",
          encryptedFields: encryptedFields as Record<string, EncryptedBlob>,
          metadata: null,
          updatedAt: now,
          updatedBy: "super_admin",
        })
        .onConflictDoUpdate({
          target: appCredentials.platform,
          set: { encryptedFields: encryptedFields as Record<string, EncryptedBlob>, metadata: null, updatedAt: now, updatedBy: "super_admin" },
        })
        .returning();
      return { updatedAt: row.updatedAt.toISOString() };
    },

    async upsertTwitterCollector(input: TwitterCollectorUpsertInput): Promise<{ updatedAt: string }> {
      const encryptedFields = {
        apiKey: cipher.encrypt(input.apiKey),
      };
      const now = new Date();
      const [row] = await db
        .insert(appCredentials)
        .values({
          platform: "twitter_collector",
          encryptedFields: encryptedFields as Record<string, EncryptedBlob>,
          metadata: null,
          updatedAt: now,
          updatedBy: "super_admin",
        })
        .onConflictDoUpdate({
          target: appCredentials.platform,
          set: { encryptedFields: encryptedFields as Record<string, EncryptedBlob>, metadata: null, updatedAt: now, updatedBy: "super_admin" },
        })
        .returning();
      return { updatedAt: row.updatedAt.toISOString() };
    },

    async delete(platform: AppCredentialPlatform): Promise<boolean> {
      const result = await db
        .delete(appCredentials)
        .where(eq(appCredentials.platform, platform))
        .returning({ platform: appCredentials.platform });
      return result.length > 0;
    },
  };
}
