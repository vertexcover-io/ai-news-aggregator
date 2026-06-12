import { and, eq, gt, isNull } from "drizzle-orm";
import { passwordResetTokens } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import type { PasswordResetTokenSelect } from "@newsletter/shared";

export interface PasswordResetTokensRepo {
  create(
    userId: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<PasswordResetTokenSelect>;
  findValidByHash(
    tokenHash: string,
    now: Date,
  ): Promise<PasswordResetTokenSelect | null>;
  /** Atomically claims the token (single-use). Returns false when another
   * request already consumed it. */
  consume(id: string): Promise<boolean>;
}

export function createPasswordResetTokensRepo(
  db: Pick<AppDb, "select" | "insert" | "update">,
): PasswordResetTokensRepo {
  return {
    async create(
      userId: string,
      tokenHash: string,
      expiresAt: Date,
    ): Promise<PasswordResetTokenSelect> {
      const [row] = await db
        .insert(passwordResetTokens)
        .values({ userId, tokenHash, expiresAt })
        .returning();
      return row;
    },

    async findValidByHash(
      tokenHash: string,
      now: Date,
    ): Promise<PasswordResetTokenSelect | null> {
      const rows = await db
        .select()
        .from(passwordResetTokens)
        .where(
          and(
            eq(passwordResetTokens.tokenHash, tokenHash),
            isNull(passwordResetTokens.usedAt),
            gt(passwordResetTokens.expiresAt, now),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },

    async consume(id: string): Promise<boolean> {
      const rows = await db
        .update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(
          and(eq(passwordResetTokens.id, id), isNull(passwordResetTokens.usedAt)),
        )
        .returning({ id: passwordResetTokens.id });
      return rows.length > 0;
    },
  };
}
