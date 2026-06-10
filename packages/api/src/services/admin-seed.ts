/**
 * Bootstrap seed: keeps the pre-P3 single admin reachable after the
 * ADMIN_PASSWORD gate is removed. If the users table is EMPTY (fresh DB /
 * hermetic e2e stack) and ADMIN_EMAIL+ADMIN_PASSWORD are configured, creates
 * the AGENTLOOP tenant (if missing) and a tenant_admin account.
 *
 * Production databases that ran the P2 backfill already have real users —
 * this is a no-op there.
 */
import { hashPassword } from "./password.js";
import type { UsersRepo } from "../repositories/users.js";
import type { TenantsRepo } from "../repositories/tenants.js";

const AGENTLOOP_SLUG = "agentloop";

export interface SeedAdminDeps {
  usersRepo: Pick<UsersRepo, "countAll" | "create">;
  tenantsRepo: Pick<TenantsRepo, "findBySlug" | "create">;
}

export interface SeedAdminInput {
  email: string;
  password: string;
  name?: string;
}

/** Returns true when a user was seeded, false when the seed was skipped. */
export async function seedAdminUser(
  deps: SeedAdminDeps,
  input: SeedAdminInput,
): Promise<boolean> {
  const userCount = await deps.usersRepo.countAll();
  if (userCount > 0) return false;

  const tenant =
    (await deps.tenantsRepo.findBySlug(AGENTLOOP_SLUG)) ??
    (await deps.tenantsRepo.create({
      slug: AGENTLOOP_SLUG,
      name: "AGENTLOOP",
      status: "active",
    }));

  await deps.usersRepo.create({
    tenantId: tenant.id,
    email: input.email,
    name: input.name ?? "Admin",
    passwordHash: await hashPassword(input.password),
    role: "tenant_admin",
  });
  return true;
}
