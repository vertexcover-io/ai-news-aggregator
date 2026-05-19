import { eq } from "drizzle-orm";
import { socialCredentials } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import type {
  LinkedInEncryptedFields,
  TwitterEncryptedFields,
} from "@newsletter/shared/db";
import type { CredentialCipher } from "@newsletter/shared/services/credential-cipher";

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

export interface SocialCredentialsRepo {
  getLinkedIn(): Promise<LinkedInCredentialRecord | null>;
  getTwitter(): Promise<TwitterCredentialRecord | null>;
  upsertLinkedIn(input: UpsertLinkedInInput): Promise<void>;
  upsertTwitter(input: UpsertTwitterInput): Promise<void>;
  delete(platform: "linkedin" | "twitter"): Promise<boolean>;
}

type DbSlice = Pick<AppDb, "select" | "insert" | "delete">;

export function createSocialCredentialsRepo(
  db: DbSlice,
  cipher: CredentialCipher,
): SocialCredentialsRepo {
  return {
    async getLinkedIn(): Promise<LinkedInCredentialRecord | null> {
      const rows = await db
        .select()
        .from(socialCredentials)
        .where(eq(socialCredentials.platform, "linkedin"))
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
      const rows = await db
        .select()
        .from(socialCredentials)
        .where(eq(socialCredentials.platform, "twitter"))
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

    async upsertLinkedIn(input: UpsertLinkedInInput): Promise<void> {
      const encryptedFields: LinkedInEncryptedFields = {
        clientId: cipher.encrypt(input.clientId),
        clientSecret: cipher.encrypt(input.clientSecret),
      };
      const metadata = input.apiVersion ? { apiVersion: input.apiVersion } : null;
      const now = new Date();
      await db
        .insert(socialCredentials)
        .values({
          platform: "linkedin",
          encryptedFields,
          metadata,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: socialCredentials.platform,
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
      await db
        .insert(socialCredentials)
        .values({
          platform: "twitter",
          encryptedFields,
          metadata: null,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: socialCredentials.platform,
          set: { encryptedFields, metadata: null, updatedAt: now },
        });
    },

    async delete(platform: "linkedin" | "twitter"): Promise<boolean> {
      const deleted = await db
        .delete(socialCredentials)
        .where(eq(socialCredentials.platform, platform))
        .returning();
      return deleted.length > 0;
    },
  };
}
