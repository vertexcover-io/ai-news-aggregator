import { socialTokens } from "@newsletter/shared/db";
import type { AppDb, SocialTokenEncryptedFields } from "@newsletter/shared/db";
import type { SocialTokenMetadata } from "@newsletter/shared";
import type { CredentialCipher } from "@newsletter/shared/services/credential-cipher";

export type SocialPlatform = "linkedin" | "twitter";

export interface SaveSocialTokenInput {
  accessToken: string;
  /** null when the OAuth server did not return a refresh token (REQ-014). */
  refreshToken: string | null;
  expiresAt: Date;
  metadata?: SocialTokenMetadata | null;
}

export interface SocialTokensRepo {
  saveToken(platform: SocialPlatform, input: SaveSocialTokenInput): Promise<void>;
}

export function createSocialTokensRepo(
  db: Pick<AppDb, "select" | "insert">,
  cipher: CredentialCipher,
): SocialTokensRepo {
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
        .values({
          platform,
          encryptedFields,
          expiresAt: input.expiresAt,
          metadata: input.metadata ?? null,
          updatedAt: new Date(),
        })
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
  };
}
