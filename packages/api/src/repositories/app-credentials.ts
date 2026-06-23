/**
 * App-level shared secrets (P12, REQ-082/086, NF6): the LinkedIn OAuth app
 * client every tenant connects through, and the shared Twitter collector
 * cookie. One row per key — NO tenant scoping (the secrets are shared) — and
 * writes are reachable ONLY through `/api/super/app-credentials`
 * (requireSuperAdmin). Encrypted at rest via the D-012 cipher.
 */
import { eq } from "drizzle-orm";
import { appCredentials } from "@newsletter/shared/db";
import type { AppDb, AppCredentialKey } from "@newsletter/shared/db";
import type {
  LinkedInEncryptedFields,
  TwitterClientEncryptedFields,
  TwitterCollectorEncryptedFields,
  ApifyEncryptedFields,
} from "@newsletter/shared/db";
import type { CredentialCipher } from "@newsletter/shared/services/credential-cipher";

export type { AppCredentialKey };

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

/** Shared Twitter OAuth2 app client (P13, REQ-081) — app-level, never tenant-exposed. */
export interface TwitterClientRecord {
  clientId: string;
  clientSecret: string;
  updatedAt: Date;
}

export interface TwitterClientUpsertInput {
  readonly clientId: string;
  readonly clientSecret: string;
}

export interface ApifyRecord {
  apiToken: string;
  updatedAt: Date;
}

export interface ApifyUpsertInput {
  readonly apiToken: string;
}

export interface LinkedInClientUpsertInput {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly apiVersion?: string;
}

export interface TwitterCollectorUpsertInput {
  readonly apiKey: string;
}

/** Status projection — booleans/timestamps only, NEVER secret material (NF6). */
export interface AppCredentialsStatus {
  readonly linkedinClient: {
    readonly configured: boolean;
    readonly apiVersion: string | null;
    readonly updatedAt: string | null;
  };
  readonly twitterCollector: {
    readonly configured: boolean;
    readonly updatedAt: string | null;
  };
  readonly twitterClient: {
    readonly configured: boolean;
    readonly updatedAt: string | null;
  };
  readonly apify: {
    readonly configured: boolean;
    readonly updatedAt: string | null;
  };
}

export interface AppCredentialsRepo {
  getStatus(): Promise<AppCredentialsStatus>;
  getLinkedInClient(): Promise<LinkedInClientRecord | null>;
  getTwitterCollector(): Promise<TwitterCollectorRecord | null>;
  getTwitterClient(): Promise<TwitterClientRecord | null>;
  getApifyApiToken(): Promise<ApifyRecord | null>;
  upsertLinkedInClient(input: LinkedInClientUpsertInput): Promise<{ updatedAt: string }>;
  upsertTwitterCollector(input: TwitterCollectorUpsertInput): Promise<{ updatedAt: string }>;
  upsertTwitterClient(input: TwitterClientUpsertInput): Promise<{ updatedAt: string }>;
  upsertApifyApiToken(input: ApifyUpsertInput): Promise<{ updatedAt: string }>;
  delete(key: AppCredentialKey): Promise<boolean>;
}

type DbSlice = Pick<AppDb, "select" | "insert" | "delete">;

export function createAppCredentialsRepo(
  db: DbSlice,
  cipher: CredentialCipher,
): AppCredentialsRepo {
  return {
    async getStatus(): Promise<AppCredentialsStatus> {
      const rows = await db.select().from(appCredentials);
      let linkedinClient: AppCredentialsStatus["linkedinClient"] = {
        configured: false,
        apiVersion: null,
        updatedAt: null,
      };
      let twitterCollector: AppCredentialsStatus["twitterCollector"] = {
        configured: false,
        updatedAt: null,
      };
      let twitterClient: AppCredentialsStatus["twitterClient"] = {
        configured: false,
        updatedAt: null,
      };
      let apify: AppCredentialsStatus["apify"] = {
        configured: false,
        updatedAt: null,
      };
      for (const row of rows) {
        if (row.key === "linkedin_client") {
          linkedinClient = {
            configured: true,
            apiVersion: row.metadata?.apiVersion ?? null,
            updatedAt: row.updatedAt.toISOString(),
          };
        } else if (row.key === "twitter_collector") {
          twitterCollector = {
            configured: true,
            updatedAt: row.updatedAt.toISOString(),
          };
        } else if (row.key === "twitter_client") {
          twitterClient = {
            configured: true,
            updatedAt: row.updatedAt.toISOString(),
          };
        } else {
          // apify_api_token — only remaining key in AppCredentialKey today.
          // When a new key is added to AppCredentialKey this branch must be
          // split: add an explicit else-if for the new key and leave the final
          // else as a no-op guard, otherwise status for the new key is silently
          // attributed to apify.
          apify = {
            configured: true,
            updatedAt: row.updatedAt.toISOString(),
          };
        }
      }
      return { linkedinClient, twitterCollector, twitterClient, apify };
    },

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

    async getTwitterClient(): Promise<TwitterClientRecord | null> {
      const rows = await db
        .select()
        .from(appCredentials)
        .where(eq(appCredentials.key, "twitter_client"))
        .limit(1);
      if (rows.length === 0) return null;
      const row = rows[0];
      const fields = row.encryptedFields as TwitterClientEncryptedFields;
      return {
        clientId: cipher.decrypt(fields.clientId),
        clientSecret: cipher.decrypt(fields.clientSecret),
        updatedAt: row.updatedAt,
      };
    },

    async upsertLinkedInClient(
      input: LinkedInClientUpsertInput,
    ): Promise<{ updatedAt: string }> {
      const encryptedFields: LinkedInEncryptedFields = {
        clientId: cipher.encrypt(input.clientId),
        clientSecret: cipher.encrypt(input.clientSecret),
      };
      const metadata = input.apiVersion ? { apiVersion: input.apiVersion } : null;
      const now = new Date();
      const [row] = await db
        .insert(appCredentials)
        .values({
          key: "linkedin_client",
          encryptedFields,
          metadata,
          updatedAt: now,
          updatedBy: "super_admin",
        })
        .onConflictDoUpdate({
          target: appCredentials.key,
          set: { encryptedFields, metadata, updatedAt: now, updatedBy: "super_admin" },
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
      const [row] = await db
        .insert(appCredentials)
        .values({
          key: "twitter_collector",
          encryptedFields,
          metadata: null,
          updatedAt: now,
          updatedBy: "super_admin",
        })
        .onConflictDoUpdate({
          target: appCredentials.key,
          set: { encryptedFields, metadata: null, updatedAt: now, updatedBy: "super_admin" },
        })
        .returning();
      return { updatedAt: row.updatedAt.toISOString() };
    },

    async upsertTwitterClient(
      input: TwitterClientUpsertInput,
    ): Promise<{ updatedAt: string }> {
      const encryptedFields: TwitterClientEncryptedFields = {
        clientId: cipher.encrypt(input.clientId),
        clientSecret: cipher.encrypt(input.clientSecret),
      };
      const now = new Date();
      const [row] = await db
        .insert(appCredentials)
        .values({
          key: "twitter_client",
          encryptedFields,
          metadata: null,
          updatedAt: now,
          updatedBy: "super_admin",
        })
        .onConflictDoUpdate({
          target: appCredentials.key,
          set: { encryptedFields, metadata: null, updatedAt: now, updatedBy: "super_admin" },
        })
        .returning();
      return { updatedAt: row.updatedAt.toISOString() };
    },

    async getApifyApiToken(): Promise<ApifyRecord | null> {
      const rows = await db
        .select()
        .from(appCredentials)
        .where(eq(appCredentials.key, "apify_api_token"))
        .limit(1);
      if (rows.length === 0) return null;
      const row = rows[0];
      const fields = row.encryptedFields as ApifyEncryptedFields;
      return {
        apiToken: cipher.decrypt(fields.apiToken),
        updatedAt: row.updatedAt,
      };
    },

    async upsertApifyApiToken(input: ApifyUpsertInput): Promise<{ updatedAt: string }> {
      const encryptedFields: ApifyEncryptedFields = {
        apiToken: cipher.encrypt(input.apiToken),
      };
      const now = new Date();
      const [row] = await db
        .insert(appCredentials)
        .values({
          key: "apify_api_token",
          encryptedFields,
          metadata: null,
          updatedAt: now,
          updatedBy: "super_admin",
        })
        .onConflictDoUpdate({
          target: appCredentials.key,
          set: { encryptedFields, metadata: null, updatedAt: now, updatedBy: "super_admin" },
        })
        .returning();
      return { updatedAt: row.updatedAt.toISOString() };
    },

    async delete(key: AppCredentialKey): Promise<boolean> {
      const result = await db
        .delete(appCredentials)
        .where(eq(appCredentials.key, key))
        .returning({ key: appCredentials.key });
      return result.length > 0;
    },
  };
}
