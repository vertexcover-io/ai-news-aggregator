import { eq } from "drizzle-orm";
import { socialCredentials } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import type {
  LinkedInEncryptedFields,
  TwitterEncryptedFields,
} from "@newsletter/shared/db";
import type { CredentialCipher } from "@newsletter/shared/services/credential-cipher";

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

export interface LinkedInStatus {
  readonly configured: boolean;
  readonly apiVersion: string | null;
  readonly updatedAt: string | null;
}

export interface TwitterStatus {
  readonly configured: boolean;
  readonly updatedAt: string | null;
}

export interface SocialCredentialsStatus {
  readonly linkedin: LinkedInStatus;
  readonly twitter: TwitterStatus;
}

export interface SocialCredentialsRepo {
  getStatus(): Promise<SocialCredentialsStatus>;
  upsertLinkedIn(input: LinkedInUpsertInput): Promise<{ updatedAt: string }>;
  upsertTwitter(input: TwitterUpsertInput): Promise<{ updatedAt: string }>;
  delete(platform: "linkedin" | "twitter"): Promise<boolean>;
}

type DbSlice = Pick<AppDb, "select" | "insert" | "delete">;

export function createSocialCredentialsRepo(
  db: DbSlice,
  cipher: CredentialCipher,
): SocialCredentialsRepo {
  return {
    async getStatus(): Promise<SocialCredentialsStatus> {
      const rows = await db.select().from(socialCredentials);
      let linkedin: LinkedInStatus = {
        configured: false,
        apiVersion: null,
        updatedAt: null,
      };
      let twitter: TwitterStatus = { configured: false, updatedAt: null };
      for (const row of rows) {
        if (row.platform === "linkedin") {
          linkedin = {
            configured: true,
            apiVersion: row.metadata?.apiVersion ?? null,
            updatedAt: row.updatedAt.toISOString(),
          };
        } else {
          twitter = {
            configured: true,
            updatedAt: row.updatedAt.toISOString(),
          };
        }
      }
      return { linkedin, twitter };
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
        .values({
          platform: "linkedin",
          encryptedFields,
          metadata,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: socialCredentials.platform,
          set: { encryptedFields, metadata, updatedAt: now },
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
        .values({
          platform: "twitter",
          encryptedFields,
          metadata: null,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: socialCredentials.platform,
          set: { encryptedFields, metadata: null, updatedAt: now },
        })
        .returning();
      return { updatedAt: row.updatedAt.toISOString() };
    },

    async delete(platform: "linkedin" | "twitter"): Promise<boolean> {
      const result = await db
        .delete(socialCredentials)
        .where(eq(socialCredentials.platform, platform))
        .returning({ platform: socialCredentials.platform });
      return result.length > 0;
    },
  };
}
