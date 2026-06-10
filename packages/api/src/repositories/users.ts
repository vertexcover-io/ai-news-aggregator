import { eq } from "drizzle-orm";
import { users } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import type { UserSelect } from "@newsletter/shared/db";

export interface UsersRepo {
  /** Login lookup — searches all tenants by email. Not tenant-scoped. */
  findByEmail(email: string): Promise<UserSelect | null>;
  findById(id: string): Promise<UserSelect | null>;
  create(input: CreateUserInput): Promise<UserSelect>;
}

export interface CreateUserInput {
  email: string;
  name: string;
  passwordHash: string;
  role: "tenant_admin" | "super_admin";
  tenantId: string | null;
}

export function createUsersRepo(db: Pick<AppDb, "select" | "insert">): UsersRepo {
  return {
    /** Allowlisted — login-by-email crosses tenant boundaries by design. */
    async findByEmail(email: string): Promise<UserSelect | null> {
      const rows = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      return rows[0] ?? null;
    },

    async findById(id: string): Promise<UserSelect | null> {
      const rows = await db
        .select()
        .from(users)
        .where(eq(users.id, id))
        .limit(1);
      return rows[0] ?? null;
    },

    async create(input: CreateUserInput): Promise<UserSelect> {
      const [row] = await db
        .insert(users)
        .values({
          email: input.email,
          name: input.name,
          passwordHash: input.passwordHash,
          role: input.role,
          tenantId: input.tenantId,
        })
        .returning();
      return row;
    },
  };
}
