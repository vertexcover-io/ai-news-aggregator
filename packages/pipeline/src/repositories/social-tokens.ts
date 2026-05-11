import { eq } from "drizzle-orm";
import { socialTokens } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import type { SocialTokenMetadata } from "@newsletter/shared";

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

function toRow(row: {
  platform: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  metadata: SocialTokenMetadata | null;
  updatedAt: Date;
}): SocialTokenRow {
  return {
    platform: row.platform as SocialPlatform,
    accessToken: row.accessToken,
    refreshToken: row.refreshToken,
    expiresAt: row.expiresAt,
    metadata: row.metadata,
    updatedAt: row.updatedAt,
  };
}

async function upsertToken(
  db: TxLike,
  platform: SocialPlatform,
  input: SaveSocialTokenInput,
): Promise<void> {
  await db
    .insert(socialTokens)
    .values({
      platform,
      accessToken: input.accessToken,
      refreshToken: input.refreshToken,
      expiresAt: input.expiresAt,
      metadata: input.metadata ?? null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: socialTokens.platform,
      set: {
        accessToken: input.accessToken,
        refreshToken: input.refreshToken,
        expiresAt: input.expiresAt,
        metadata: input.metadata ?? null,
        updatedAt: new Date(),
      },
    });
}

export function createSocialTokensRepo(
  db: Pick<AppDb, "select" | "insert" | "transaction">,
): SocialTokensRepo {
  return {
    async getToken(platform: SocialPlatform): Promise<SocialTokenRow | null> {
      const rows = await db
        .select()
        .from(socialTokens)
        .where(eq(socialTokens.platform, platform))
        .limit(1);
      if (rows.length === 0) return null;
      return toRow(rows[0]);
    },

    async saveToken(
      platform: SocialPlatform,
      input: SaveSocialTokenInput,
    ): Promise<void> {
      await upsertToken(db, platform, input);
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
        const row = rows.length === 0 ? null : toRow(rows[0]);
        const txApi: SocialTokensTx = {
          async saveToken(p, input) {
            await upsertToken(tx, p, input);
          },
        };
        return fn(row, txApi);
      });
    },
  };
}
