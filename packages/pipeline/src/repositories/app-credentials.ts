/**
 * App-level shared secrets (P12, REQ-082/086): the LinkedIn OAuth app client
 * and the shared Twitter collector cookie live in `app_credentials` — a
 * super-admin-only store with NO tenant scoping (the secrets are shared by
 * every tenant). The pipeline only ever reads them (plus the collector-cookie
 * write-back after a CSRF refresh); writes happen via /api/super.
 */
import { eq } from "drizzle-orm";
import { appCredentials } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import type {
  LinkedInEncryptedFields,
  TwitterCollectorEncryptedFields,
} from "@newsletter/shared/db";
import type { CredentialCipher } from "@newsletter/shared/services/credential-cipher";

export interface LinkedInClientRecord {
  clientId: string;
  clientSecret: string;
  apiVersion: string | null;
  updatedAt: Date;
}

export interface TwitterCollectorRecord {
  apiKey: string;
  updatedAt: Date;
}

export interface AppCredentialsRepo {
  getLinkedInClient(): Promise<LinkedInClientRecord | null>;
  getTwitterCollector(): Promise<TwitterCollectorRecord | null>;
  /** CSRF-refresh write-back: persists the rotated collector cookie. */
  upsertTwitterCollector(input: { apiKey: string }): Promise<void>;
}

type DbSlice = Pick<AppDb, "select" | "insert">;

export function createAppCredentialsRepo(
  db: DbSlice,
  cipher: CredentialCipher,
): AppCredentialsRepo {
  return {
    async getLinkedInClient(): Promise<LinkedInClientRecord | null> {
      const rows = await db
        .select()
        .from(appCredentials)
        .where(eq(appCredentials.key, "linkedin_client"))
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

    async getTwitterCollector(): Promise<TwitterCollectorRecord | null> {
      const rows = await db
        .select()
        .from(appCredentials)
        .where(eq(appCredentials.key, "twitter_collector"))
        .limit(1);
      if (rows.length === 0) return null;
      const row = rows[0];
      const fields = row.encryptedFields as TwitterCollectorEncryptedFields;
      return {
        apiKey: cipher.decrypt(fields.apiKey),
        updatedAt: row.updatedAt,
      };
    },

    async upsertTwitterCollector(input: { apiKey: string }): Promise<void> {
      const encryptedFields: TwitterCollectorEncryptedFields = {
        apiKey: cipher.encrypt(input.apiKey),
      };
      const now = new Date();
      await db
        .insert(appCredentials)
        .values({
          key: "twitter_collector",
          encryptedFields,
          metadata: null,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: appCredentials.key,
          set: { encryptedFields, metadata: null, updatedAt: now },
        });
    },
  };
}
