import { eq } from "drizzle-orm";
import { users } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import type { UserInsert, UserRow } from "@newsletter/shared";

export interface UsersRepo {
  create(insert: UserInsert): Promise<UserRow>;
  getByEmail(email: string): Promise<UserRow | null>;
  getById(id: string): Promise<UserRow | null>;
  updatePassword(id: string, passwordHash: string): Promise<void>;
}

export function createUsersRepo(
  db: Pick<AppDb, "select" | "insert" | "update">,
): UsersRepo {
  return {
    async create(insert: UserInsert): Promise<UserRow> {
      const [row] = await db.insert(users).values(insert).returning();
      return row;
    },

    async getByEmail(email: string): Promise<UserRow | null> {
      const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
      return rows[0] ?? null;
    },

    async getById(id: string): Promise<UserRow | null> {
      const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
      return rows[0] ?? null;
    },

    async updatePassword(id: string, passwordHash: string): Promise<void> {
      await db
        .update(users)
        .set({ passwordHash, updatedAt: new Date() })
        .where(eq(users.id, id));
    },
  };
}
