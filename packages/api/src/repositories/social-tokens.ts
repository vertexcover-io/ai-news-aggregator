import { eq } from "drizzle-orm";
import { socialTokens, tenantScope } from "@newsletter/shared/db";
import type { AppDb, SocialTokenEncryptedFields } from "@newsletter/shared/db";
import type { SocialTokenMetadata } from "@newsletter/shared/types";
import type { TenantContext } from "@newsletter/shared";
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
  /** Returns the decrypted LinkedIn token row, or null when no row exists. Decrypt failures return null. */
  getLinkedIn(): Promise<SocialTokenRecord | null>;
  /** Deletes the OAuth token row for a platform. Returns true if a row was removed. */
  deleteToken(platform: SocialPlatform): Promise<boolean>;
}

export function createSocialTokensRepo(
  db: Pick<AppDb, "select" | "insert" | "delete">,
  cipher: CredentialCipher,
  ctx?: TenantContext,
): SocialTokensRepo {
  const scope = tenantScope(socialTokens.tenantId, ctx);
  return {
    async saveToken(
      platform: SocialPlatform,
      input: SaveSocialTokenInput,
    ): Promise<void> {
      // refreshToken may be null when the OAuth server omits it (REQ-014).
      // Encrypt a sentinel empty string so the NOT NULL column is satisfied;
      // callers that read the token back should treat decrypt("") as "no token".
      const encryptedFields: SocialTokenEncryptedFields = {
        accessToken: cipher.encrypt(input.accessToken),
        refreshToken: cipher.encrypt(input.refreshToken ?? ""),
      };
      await db
        .insert(socialTokens)
        .values(
          scope.stamp({
            platform,
            encryptedFields,
            expiresAt: input.expiresAt,
            metadata: input.metadata ?? null,
            updatedAt: new Date(),
          }),
        )
        .onConflictDoUpdate({
          target: socialTokens.platform,
          set: {
            encryptedFields,
            expiresAt: input.expiresAt,
            metadata: input.metadata ?? null,
            updatedAt: new Date(),
          },
        });
    },

    async getLinkedIn(): Promise<SocialTokenRecord | null> {
      try {
        const rows = await db
          .select()
          .from(socialTokens)
          .where(scope.where(eq(socialTokens.platform, "linkedin")))
          .limit(1);
        if (rows.length === 0) return null;
        const row = rows[0];
        // encryptedFields is typed as SocialTokenEncryptedFields via the column .$type<>()
        const encFields = row.encryptedFields;
        return {
          accessToken: cipher.decrypt(encFields.accessToken),
          refreshToken: cipher.decrypt(encFields.refreshToken),
          expiresAt: row.expiresAt,
          metadata: row.metadata ?? null,
        };
      } catch {
        // Decrypt failure → treat as not connected (REQ-011)
        return null;
      }
    },

    async deleteToken(platform: SocialPlatform): Promise<boolean> {
      const result = await db
        .delete(socialTokens)
        .where(scope.where(eq(socialTokens.platform, platform)))
        .returning({ platform: socialTokens.platform });
      return result.length > 0;
    },
  };
}
