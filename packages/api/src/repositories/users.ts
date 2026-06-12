import { eq, sql } from "drizzle-orm";
import { users, tenants } from "@newsletter/shared/db";
import type { AppDb, UserRow, TenantRow } from "@newsletter/shared/db";

// Row types re-exported so routes/services can type users without importing
// the restricted DB module (S-api-01).
export type { UserRow, TenantRow };
import type { UserRole } from "@newsletter/shared/types/tenant";

export interface CreateWithTenantInput {
  name: string;
  email: string;
  /** Already-hashed password (scrypt) — never plaintext (REQ-121). */
  passwordHash: string;
  tenantName: string;
  tenantSlug: string;
}

export interface CreateUserInput {
  tenantId: string | null;
  email: string;
  name: string;
  passwordHash: string;
  role: UserRole;
}

export interface UsersRepo {
  /**
   * Intentionally NOT tenant-scoped: login resolves a user globally by email
   * (the tenant comes from the user row, not the request).
   */
  findByEmail(email: string): Promise<UserRow | null>;
  findById(id: string): Promise<UserRow | null>;
  updatePasswordHash(id: string, passwordHash: string): Promise<void>;
  /**
   * Signup transaction: creates a `pending_setup` tenant and its owner in one
   * tx. The role is hardcoded to 'tenant_admin' here — no input can produce a
   * super_admin via signup (REQ-006).
   */
  createWithTenant(
    input: CreateWithTenantInput,
  ): Promise<{ user: UserRow; tenant: TenantRow }>;
  /** Bootstrap seeding only (admin seed / scripts) — not reachable from HTTP input. */
  create(input: CreateUserInput): Promise<UserRow>;
  countAll(): Promise<number>;
}

export function createUsersRepo(
  db: Pick<AppDb, "select" | "insert" | "update" | "transaction">,
): UsersRepo {
  return {
    async findByEmail(email: string): Promise<UserRow | null> {
      // users.email is citext — equality is case-insensitive in Postgres.
      const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
      return rows[0] ?? null;
    },

    async findById(id: string): Promise<UserRow | null> {
      const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
      return rows[0] ?? null;
    },

    async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
      await db
        .update(users)
        .set({ passwordHash, updatedAt: new Date() })
        .where(eq(users.id, id));
    },

    async createWithTenant(
      input: CreateWithTenantInput,
    ): Promise<{ user: UserRow; tenant: TenantRow }> {
      return db.transaction(async (tx) => {
        const [tenant] = await tx
          .insert(tenants)
          .values({
            slug: input.tenantSlug,
            name: input.tenantName,
            status: "pending_setup",
          })
          .returning();
        const [user] = await tx
          .insert(users)
          .values({
            tenantId: tenant.id,
            email: input.email,
            name: input.name,
            passwordHash: input.passwordHash,
            role: "tenant_admin",
          })
          .returning();
        return { user, tenant };
      });
    },

    async create(input: CreateUserInput): Promise<UserRow> {
      const [row] = await db
        .insert(users)
        .values({
          tenantId: input.tenantId,
          email: input.email,
          name: input.name,
          passwordHash: input.passwordHash,
          role: input.role,
        })
        .returning();
      return row;
    },

    async countAll(): Promise<number> {
      const rows = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(users);
      return rows[0]?.n ?? 0;
    },
  };
}
