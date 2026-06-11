import { eq } from "drizzle-orm";
import { users } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import type { UserRole } from "@newsletter/shared/types/tenant";

export interface UserRecord {
  id: string;
  tenantId: string | null;
  email: string;
  name: string;
  passwordHash: string;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
}

export interface UsersRepo {
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  create(user: {
    email: string;
    name: string;
    passwordHash: string;
    role: UserRole;
    tenantId: string | null;
  }): Promise<UserRecord>;
  updatePassword(id: string, passwordHash: string): Promise<void>;
}

export function createUsersRepo(db: AppDb): UsersRepo {
  return {
    async findByEmail(email: string) {
      const rows = await db
        .select()
        .from(users)
        .where(eq(users.email, email.toLowerCase().trim()))
        .limit(1);
      if (rows.length === 0) return null;
      const row = rows[0];
      return {
        id: row.id,
        tenantId: row.tenantId,
        email: row.email,
        name: row.name,
        passwordHash: row.passwordHash,
        role: row.role,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    },

    async findById(id: string) {
      const rows = await db
        .select()
        .from(users)
        .where(eq(users.id, id))
        .limit(1);
      if (rows.length === 0) return null;
      const row = rows[0];
      return {
        id: row.id,
        tenantId: row.tenantId,
        email: row.email,
        name: row.name,
        passwordHash: row.passwordHash,
        role: row.role,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    },

    async create(user) {
      const rows = await db
        .insert(users)
        .values({
          email: user.email.toLowerCase().trim(),
          name: user.name,
          passwordHash: user.passwordHash,
          role: user.role,
          tenantId: user.tenantId,
        })
        .returning();
      const row = rows[0];
      return {
        id: row.id,
        tenantId: row.tenantId,
        email: row.email,
        name: row.name,
        passwordHash: row.passwordHash,
        role: row.role,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    },

    async updatePassword(id: string, passwordHash: string) {
      await db
        .update(users)
        .set({ passwordHash, updatedAt: new Date() })
        .where(eq(users.id, id));
    },
  };
}
