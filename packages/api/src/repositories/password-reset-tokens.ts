import { eq } from "drizzle-orm";
import { passwordResetTokens } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import type { PasswordResetTokenSelect } from "@newsletter/shared";

export interface PasswordResetTokensRepo {
  create(userId: string, tokenHash: string, expiresAt: Date): Promise<PasswordResetTokenSelect>;
  findByHash(tokenHash: string): Promise<PasswordResetTokenSelect | null>;
  markUsed(id: string): Promise<void>;
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

    async findByHash(tokenHash: string): Promise<PasswordResetTokenSelect | null> {
      const rows = await db
        .select()
        .from(passwordResetTokens)
        .where(eq(passwordResetTokens.tokenHash, tokenHash))
        .limit(1);
      return rows[0] ?? null;
    },

    async markUsed(id: string): Promise<void> {
      await db
        .update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(eq(passwordResetTokens.id, id));
    },
  };
}
