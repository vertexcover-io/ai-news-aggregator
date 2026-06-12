// Idempotent super-admin seeder.
//
// Reads SUPER_ADMIN_EMAILS (comma-separated) and SUPER_ADMIN_PASSWORD (one
// shared initial password) and upserts a super_admin user per email.
// Existing users (by email) are left untouched — safe to re-run.
//
// Usage: pnpm --filter @newsletter/api seed:super-admins
import { pathToFileURL } from "node:url";
import type { AppDb } from "@newsletter/shared/db";
import { createUsersRepo } from "../src/repositories/users.js";
import { hashPassword } from "../src/lib/password.js";

export function parseSuperAdminEmails(raw: string): string[] {
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
}

export interface SeedSuperAdminsResult {
  created: string[];
  existing: string[];
}

export async function seedSuperAdmins(
  db: AppDb,
  emails: string[],
  password: string,
): Promise<SeedSuperAdminsResult> {
  const repo = createUsersRepo(db);
  const passwordHash = await hashPassword(password);
  const result: SeedSuperAdminsResult = { created: [], existing: [] };
  for (const email of emails) {
    const before = await repo.findByEmail(email);
    await repo.createSuperAdmin({
      email,
      name: email.split("@")[0],
      passwordHash,
    });
    if (before) {
      result.existing.push(email);
    } else {
      result.created.push(email);
    }
  }
  return result;
}

async function main(): Promise<void> {
  const { config } = await import("dotenv");
  config({ path: "../../.env" });
  const { getDb } = await import("@newsletter/shared/db");

  const emailsRaw = process.env.SUPER_ADMIN_EMAILS;
  const password = process.env.SUPER_ADMIN_PASSWORD;
  if (!emailsRaw) {
    console.error("SUPER_ADMIN_EMAILS is required (comma-separated)");
    process.exit(1);
  }
  if (!password) {
    console.error("SUPER_ADMIN_PASSWORD is required");
    process.exit(1);
  }

  const emails = parseSuperAdminEmails(emailsRaw);
  if (emails.length === 0) {
    console.error("SUPER_ADMIN_EMAILS contained no usable emails");
    process.exit(1);
  }

  const result = await seedSuperAdmins(getDb(), emails, password);
  for (const email of result.created) {
    console.log(`+ ${email} created as super_admin`);
  }
  for (const email of result.existing) {
    console.log(`= ${email} already exists`);
  }
  console.log(
    `Done: ${result.created.length} created, ${result.existing.length} already existed (${emails.length} total).`,
  );
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
