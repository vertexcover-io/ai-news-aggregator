import { eq } from "drizzle-orm";
import { socialCredentials, tenantScope } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import type {
  LinkedInEncryptedFields,
  TwitterEncryptedFields,
  TwitterCollectorEncryptedFields,
} from "@newsletter/shared/db";
import type { TenantContext } from "@newsletter/shared";
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
   * Returns the decrypted LinkedIn client credentials, or null when no row
   * exists. Uses the cipher to decrypt encryptedFields. Mirror of the
   * pipeline's social-credentials repo getLinkedIn() — do NOT import pipeline.
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

export function createSocialCredentialsRepo(
  db: DbSlice,
  cipher: CredentialCipher,
  ctx?: TenantContext,
): SocialCredentialsRepo {
  const scope = tenantScope(socialCredentials.tenantId, ctx);
  return {
    async getLinkedIn(): Promise<LinkedInCredentialRecord | null> {
      const rows = await db
        .select()
        .from(socialCredentials)
        .where(scope.where(eq(socialCredentials.platform, "linkedin")))
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
      const rows = await db
        .select()
        .from(socialCredentials)
        .where(scope.where());
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
      const [row] = await db
        .insert(socialCredentials)
        .values(
          scope.stamp({
            platform: "linkedin",
            encryptedFields,
            metadata,
            updatedAt: now,
            updatedBy: "admin",
          }),
        )
        .onConflictDoUpdate({
          target: socialCredentials.platform,
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
      const [row] = await db
        .insert(socialCredentials)
        .values(
          scope.stamp({
            platform: "twitter",
            encryptedFields,
            metadata: null,
            updatedAt: now,
            updatedBy: "admin",
          }),
        )
        .onConflictDoUpdate({
          target: socialCredentials.platform,
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
      const [row] = await db
        .insert(socialCredentials)
        .values(
          scope.stamp({
            platform: "twitter_collector",
            encryptedFields,
            metadata: null,
            updatedAt: now,
            updatedBy: "admin",
          }),
        )
        .onConflictDoUpdate({
          target: socialCredentials.platform,
          set: { encryptedFields, metadata: null, updatedAt: now, updatedBy: "admin" },
        })
        .returning();
      return { updatedAt: row.updatedAt.toISOString() };
    },

    async delete(platform: SocialCredentialPlatform): Promise<boolean> {
      const result = await db
        .delete(socialCredentials)
        .where(scope.where(eq(socialCredentials.platform, platform)))
        .returning({ platform: socialCredentials.platform });
      return result.length > 0;
    },
  };
}
