/**
 * Seed super-admin accounts from SUPER_ADMIN_EMAILS env var.
 * Idempotent — re-running creates only missing accounts.
 *
 * Usage:
 *   pnpm --filter @newsletter/api exec tsx scripts/seed-super-admins.ts
 *
 * Env:
 *   SUPER_ADMIN_EMAILS — comma-separated list of emails (e.g. "admin@example.com,admin2@example.com")
 *   DATABASE_URL — Postgres connection
 *   SESSION_SECRET — used to derive initial password hash
 */
import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(import.meta.dirname, "../../../.env") });

const { getDb } = await import("@newsletter/shared/db");
const { users } = await import("@newsletter/shared/db");
const { eq } = await import("drizzle-orm");
const { hashPassword } = await import("@api/services/password.js");

async function main(): Promise<void> {
  const emailsRaw = process.env.SUPER_ADMIN_EMAILS;
  if (!emailsRaw) {
    console.log("SUPER_ADMIN_EMAILS not set — no super-admin accounts to seed.");
    process.exit(0);
  }

  const emails = emailsRaw.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (emails.length === 0) {
    console.log("SUPER_ADMIN_EMAILS is empty.");
    process.exit(0);
  }

  const db = getDb();

  // Use SESSION_SECRET as the initial password for seeded accounts.
  // Each super-admin must reset their password on first login.
  const initialPassword = process.env.SESSION_SECRET;
  if (!initialPassword || initialPassword.length < 32) {
    console.error("SESSION_SECRET must be at least 32 characters for seeded accounts.");
    process.exit(1);
  }

  const passwordHash = await hashPassword(initialPassword);
  let created = 0;

  for (const email of emails) {
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existing.length > 0) {
      console.log(`SKIP: ${email} — already exists`);
      continue;
    }

    await db.insert(users).values({
      email,
      name: email.split("@")[0],
      passwordHash,
      role: "super_admin",
      tenantId: null, // super-admins are not tied to a tenant
    });

    console.log(`CREATED: ${email} — super_admin (reset password on first login)`);
    created++;
  }

  console.log(`\nDone. ${created} super-admin(s) created, ${emails.length - created} skipped.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
