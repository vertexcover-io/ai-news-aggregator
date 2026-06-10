import { and, eq } from "drizzle-orm";
import { isAllTenants, type ScopedTenantContext } from "@newsletter/shared/services";
import { socialTokens } from "@newsletter/shared/db";
import type { AppDb, SocialTokenEncryptedFields } from "@newsletter/shared/db";
import type { SocialTokenMetadata } from "@newsletter/shared/types";
import type { CredentialCipher } from "@newsletter/shared/services/credential-cipher";

export type SocialPlatform = "linkedin" | "twitter";

export interface SaveSocialTokenInput {
  accessToken: string;
  /** null when the OAuth server did not return a refresh token (REQ-014). */
  refreshToken: string | null;
  expiresAt: Date;
  metadata?: SocialTokenMetadata | null;
}

/** Decrypted read of a social_tokens row. */
export interface SocialTokenRecord {
  accessToken: string;
  /** Empty string sentinel ("") when no refresh token was issued (REQ-014). */
  refreshToken: string | null;
  expiresAt: Date;
  metadata: SocialTokenMetadata | null;
}

export interface SocialTokensRepo {
  saveToken(platform: SocialPlatform, input: SaveSocialTokenInput): Promise<void>;
  /** Returns the decrypted token row for the given platform and scoped tenant, or null. Decrypt failures return null. */
  getToken(platform: SocialPlatform): Promise<SocialTokenRecord | null>;
  /** Returns the decrypted LinkedIn token row for the scoped tenant, or null when no row exists. Decrypt failures return null. */
  getLinkedIn(): Promise<SocialTokenRecord | null>;
  /** Returns the decrypted Twitter token row for the scoped tenant, or null when no row exists. Decrypt failures return null. */
  getTwitter(): Promise<SocialTokenRecord | null>;
  /** Deletes the OAuth token row for a platform within the scoped tenant. Returns true if a row was removed. */
  deleteToken(platform: SocialPlatform): Promise<boolean>;
}

function tenantWhere(scoped: ScopedTenantContext) {
  return isAllTenants(scoped)
    ? undefined
    : eq(socialTokens.tenantId, scoped.ctx.tenantId);
}

export function createSocialTokensRepo(
  db: Pick<AppDb, "select" | "insert" | "delete">, scoped: ScopedTenantContext,
  cipher: CredentialCipher,
): SocialTokensRepo {
  const tWhere = tenantWhere(scoped);

  function toRecord(
    raw: {
      encryptedFields: SocialTokenEncryptedFields;
      expiresAt: Date;
      metadata: SocialTokenMetadata | null;
    },
  ): SocialTokenRecord {
    return {
      accessToken: cipher.decrypt(raw.encryptedFields.accessToken),
      refreshToken: cipher.decrypt(raw.encryptedFields.refreshToken),
      expiresAt: raw.expiresAt,
      metadata: raw.metadata,
    };
  }

  async function getByPlatform(
    platform: SocialPlatform,
  ): Promise<SocialTokenRecord | null> {
    try {
      const conditions = [eq(socialTokens.platform, platform)];
      if (tWhere) conditions.push(tWhere);
      const rows = await db
        .select()
        .from(socialTokens)
        .where(and(...conditions))
        .limit(1);
      if (rows.length === 0) return null;
      return toRecord(rows[0]);
    } catch {
      // Decrypt failure → treat as not connected (REQ-011)
      return null;
    }
  }

  return {
    async saveToken(
      platform: SocialPlatform,
      input: SaveSocialTokenInput,
    ): Promise<void> {
      const encryptedFields: SocialTokenEncryptedFields = {
        accessToken: cipher.encrypt(input.accessToken),
        refreshToken: cipher.encrypt(input.refreshToken ?? ""),
      };
      const tenantId = scoped.ctx.tenantId;
      await db
        .insert(socialTokens)
        .values({
          tenantId,
          platform,
          encryptedFields,
          expiresAt: input.expiresAt,
          metadata: input.metadata ?? null,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [socialTokens.tenantId, socialTokens.platform],
          set: {
            encryptedFields,
            expiresAt: input.expiresAt,
            metadata: input.metadata ?? null,
            updatedAt: new Date(),
          },
        });
    },

    getToken: getByPlatform,

    async getLinkedIn(): Promise<SocialTokenRecord | null> {
      return getByPlatform("linkedin");
    },

    async getTwitter(): Promise<SocialTokenRecord | null> {
      return getByPlatform("twitter");
    },

    async deleteToken(platform: SocialPlatform): Promise<boolean> {
      const conditions = [eq(socialTokens.platform, platform)];
      if (tWhere) conditions.push(tWhere);
      const result = await db
        .delete(socialTokens)
        .where(and(...conditions))
        .returning({ platform: socialTokens.platform });
      return result.length > 0;
    },
  };
}
