import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { tenants, users } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import type { TenantSelect, UserSelect } from "@newsletter/shared";

export class EmailInUseError extends Error {
  constructor() {
    super("email already in use");
    this.name = "EmailInUseError";
  }
}

export interface CreateTenantAdminInput {
  name: string;
  email: string;
  passwordHash: string;
  tenantName?: string;
}

export interface CreateSuperAdminInput {
  email: string;
  name: string;
  passwordHash: string;
}

export interface UsersRepo {
  findByEmail(email: string): Promise<UserSelect | null>;
  findById(id: string): Promise<UserSelect | null>;
  findTenantById(id: string): Promise<TenantSelect | null>;
  createTenantAdminWithTenant(
    input: CreateTenantAdminInput,
  ): Promise<{ user: UserSelect; tenant: TenantSelect }>;
  updatePassword(userId: string, passwordHash: string): Promise<void>;
  createSuperAdmin(input: CreateSuperAdminInput): Promise<UserSelect>;
}

/** Matches a 23505 on users_email_unique specifically — a placeholder-slug
 * collision (tenants_slug_unique) must surface as a 500, not a 409. Checks
 * err.cause too in case the driver error arrives wrapped. */
function isEmailUniqueViolation(err: unknown): boolean {
  const candidates = [err, (err as { cause?: unknown } | null)?.cause];
  return candidates.some(
    (candidate) =>
      typeof candidate === "object" &&
      candidate !== null &&
      (candidate as { code?: unknown }).code === "23505" &&
      (candidate as { constraint_name?: unknown }).constraint_name ===
        "users_email_unique",
  );
}

/** Placeholder slug for tenants created at signup; replaced during onboarding.
 * Only 2^32-unique — Phase 11 slug validation must reserve the "pending-"
 * prefix so a chosen tenant slug can never collide with a placeholder. */
function placeholderSlug(): string {
  return `pending-${randomBytes(4).toString("hex")}`;
}

export function createUsersRepo(
  db: Pick<AppDb, "select" | "insert" | "update" | "transaction">,
): UsersRepo {
  return {
    async findByEmail(email: string): Promise<UserSelect | null> {
      const rows = await db
        .select()
        .from(users)
        .where(eq(users.email, email.toLowerCase()))
        .limit(1);
      return rows[0] ?? null;
    },

    async findById(id: string): Promise<UserSelect | null> {
      const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
      return rows[0] ?? null;
    },

    async findTenantById(id: string): Promise<TenantSelect | null> {
      const rows = await db
        .select()
        .from(tenants)
        .where(eq(tenants.id, id))
        .limit(1);
      return rows[0] ?? null;
    },

    async createTenantAdminWithTenant(
      input: CreateTenantAdminInput,
    ): Promise<{ user: UserSelect; tenant: TenantSelect }> {
      try {
        return await db.transaction(async (tx) => {
          const [tenant] = await tx
            .insert(tenants)
            .values({
              slug: placeholderSlug(),
              name: input.tenantName ?? "My Newsletter",
              status: "pending_setup",
            })
            .returning();
          const [user] = await tx
            .insert(users)
            .values({
              tenantId: tenant.id,
              email: input.email.toLowerCase(),
              name: input.name,
              passwordHash: input.passwordHash,
              role: "tenant_admin",
            })
            .returning();
          return { user, tenant };
        });
      } catch (err) {
        if (isEmailUniqueViolation(err)) throw new EmailInUseError();
        throw err;
      }
    },

    async updatePassword(userId: string, passwordHash: string): Promise<void> {
      await db
        .update(users)
        .set({ passwordHash, updatedAt: new Date() })
        .where(eq(users.id, userId));
    },

    async createSuperAdmin(input: CreateSuperAdminInput): Promise<UserSelect> {
      const email = input.email.toLowerCase();
      const inserted = await db
        .insert(users)
        .values({
          tenantId: null,
          email,
          name: input.name,
          passwordHash: input.passwordHash,
          role: "super_admin",
        })
        .onConflictDoNothing({ target: users.email })
        .returning();
      if (inserted.length > 0) return inserted[0];
      const rows = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      return rows[0];
    },
  };
}
