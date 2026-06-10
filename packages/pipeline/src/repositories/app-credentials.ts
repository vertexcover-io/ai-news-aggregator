import { eq } from "drizzle-orm";
import { appCredentials } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
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

export interface AppCredentialsRepo {
  getLinkedIn(): Promise<LinkedInDecrypted | null>;
  getTwitter(): Promise<TwitterOAuth2Decrypted | null>;
  getTwitterCollector(): Promise<TwitterCollectorDecrypted | null>;
}

type DbSlice = Pick<AppDb, "select">;

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
  };
}
