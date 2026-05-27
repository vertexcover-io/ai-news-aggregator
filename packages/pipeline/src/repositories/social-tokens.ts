import { eq } from "drizzle-orm";
import { socialTokens } from "@newsletter/shared/db";
import type { AppDb, SocialTokenEncryptedFields } from "@newsletter/shared/db";
import type { SocialTokenMetadata } from "@newsletter/shared";
import type { CredentialCipher } from "@newsletter/shared/services/credential-cipher";

export type SocialPlatform = "linkedin" | "twitter";

export interface SocialTokenRow {
  platform: SocialPlatform;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  metadata: SocialTokenMetadata | null;
  updatedAt: Date;
}

export interface SaveSocialTokenInput {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  metadata?: SocialTokenMetadata | null;
}

export interface SocialTokensTx {
  saveToken(platform: SocialPlatform, input: SaveSocialTokenInput): Promise<void>;
}

export interface SocialTokensRepo {
  getToken(platform: SocialPlatform): Promise<SocialTokenRow | null>;
  saveToken(platform: SocialPlatform, input: SaveSocialTokenInput): Promise<void>;
  withTokenLock<T>(
    platform: SocialPlatform,
    fn: (row: SocialTokenRow | null, tx: SocialTokensTx) => Promise<T>,
  ): Promise<T>;
}

type TxLike = Pick<AppDb, "select" | "insert">;

function toRow(
  raw: {
    platform: string;
    encryptedFields: SocialTokenEncryptedFields;
    expiresAt: Date;
    metadata: SocialTokenMetadata | null;
    updatedAt: Date;
  },
  cipher: CredentialCipher,
): SocialTokenRow {
  return {
    platform: raw.platform as SocialPlatform,
    accessToken: cipher.decrypt(raw.encryptedFields.accessToken),
    refreshToken: cipher.decrypt(raw.encryptedFields.refreshToken),
    expiresAt: raw.expiresAt,
    metadata: raw.metadata,
    updatedAt: raw.updatedAt,
  };
}

async function upsertToken(
  db: TxLike,
  platform: SocialPlatform,
  input: SaveSocialTokenInput,
  cipher: CredentialCipher,
): Promise<void> {
  const encryptedFields: SocialTokenEncryptedFields = {
    accessToken: cipher.encrypt(input.accessToken),
    refreshToken: cipher.encrypt(input.refreshToken),
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
}

export function createSocialTokensRepo(
  db: Pick<AppDb, "select" | "insert" | "transaction">,
  cipher: CredentialCipher,
): SocialTokensRepo {
  return {
    async getToken(platform: SocialPlatform): Promise<SocialTokenRow | null> {
      const rows = await db
        .select()
        .from(socialTokens)
        .where(eq(socialTokens.platform, platform))
        .limit(1);
      if (rows.length === 0) return null;
      try {
        return toRow(rows[0], cipher);
      } catch {
        // Decrypt failure (e.g. rotated SESSION_SECRET) — treat as no token so
        // the job skips gracefully instead of crashing.
        return null;
      }
    },

    async saveToken(
      platform: SocialPlatform,
      input: SaveSocialTokenInput,
    ): Promise<void> {
      await upsertToken(db, platform, input, cipher);
    },

    async withTokenLock<T>(
      platform: SocialPlatform,
      fn: (row: SocialTokenRow | null, tx: SocialTokensTx) => Promise<T>,
    ): Promise<T> {
      return db.transaction(async (tx) => {
        const rows = await tx
          .select()
          .from(socialTokens)
          .where(eq(socialTokens.platform, platform))
          .limit(1)
          .for("update");
        let row: SocialTokenRow | null;
        try {
          row = rows.length === 0 ? null : toRow(rows[0], cipher);
        } catch {
          // Decrypt failure (e.g. rotated SESSION_SECRET) — treat as no token.
          row = null;
        }
        const txApi: SocialTokensTx = {
          async saveToken(p, inp) {
            await upsertToken(tx, p, inp, cipher);
          },
        };
        return fn(row, txApi);
      });
    },
  };
}
