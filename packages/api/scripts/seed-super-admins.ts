/**
 * Phase 6: Seed super-admin users from SUPER_ADMIN_EMAILS env var.
 *
 * Reads SUPER_ADMIN_EMAILS (comma-separated email addresses) and creates
 * super_admin users with no tenant affiliation. Users get a random password
 * hash (they onboard via reset-link, never via password login).
 *
 * Idempotent: uses INSERT ... ON CONFLICT DO NOTHING on email uniqueness.
 * Reports which users were created vs already existed.
 *
 * Usage:
 *   SUPER_ADMIN_EMAILS="admin@example.com,admin2@example.com" \
 *   npx tsx packages/api/scripts/seed-super-admins.ts
 */

import { config } from "dotenv";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";

// Load .env from repo root
config({ path: resolve(import.meta.dirname ?? process.cwd(), "../../../.env") });

import { getDb } from "@newsletter/shared/db";
import { createUsersRepo } from "../../api/src/repositories/users.js";
import { hashPassword } from "../../api/src/services/password.js";

interface SeedResult {
  created: string[];
  existing: string[];
  errors: string[];
}

async function seed(): Promise<SeedResult> {
  const emailsRaw = process.env.SUPER_ADMIN_EMAILS;
  if (!emailsRaw || !emailsRaw.trim()) {
    console.log("[seed-super-admins] SUPER_ADMIN_EMAILS is empty — no super admins to seed");
    return { created: [], existing: [], errors: [] };
  }

  const emails = emailsRaw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  const db = getDb();
  const usersRepo = createUsersRepo(db);

  const created: string[] = [];
  const existing: string[] = [];
  const errors: string[] = [];

  for (const email of emails) {
    try {
      // Check if already exists
      const existingUser = await usersRepo.findByEmail(email);
      if (existingUser) {
        console.log(`[seed-super-admins] ${email} — already exists (${existingUser.role})`);
        // If the user exists but is NOT super_admin, we skip to avoid overwriting
        // passwords. An admin must manually promote in that case.
        if (existingUser.role !== "super_admin") {
          console.log(`[seed-super-admins] ${email} is ${existingUser.role}, not super_admin — skipping promotion (manual step required)`);
        }
        existing.push(email);
        continue;
      }

      // Create with a random password — user onboards via reset-link
      const randomPw = randomBytes(32).toString("hex");
      const name = email.split("@")[0];

      await usersRepo.create({
        email,
        name,
        passwordHash: await hashPassword(randomPw),
        role: "super_admin",
        tenantId: null,
      });

      console.log(`[seed-super-admins] ${email} — created as super_admin`);
      created.push(email);
    } catch (err) {
      console.error(`[seed-super-admins] ${email} — error:`, err instanceof Error ? err.message : String(err));
      errors.push(email);
    }
  }

  return { created, existing, errors };
}

seed()
  .then((result) => {
    console.log("\n[seed-super-admins] Done.");
    console.log(`  Created:  ${result.created.length} (${result.created.join(", ") || "none"})`);
    console.log(`  Existing: ${result.existing.length} (${result.existing.join(", ") || "none"})`);
    if (result.errors.length > 0) {
      console.log(`  Errors:   ${result.errors.length} (${result.errors.join(", ")})`);
      process.exit(1);
    }
    process.exit(0);
  })
  .catch((err: unknown) => {
    console.error("[seed-super-admins] fatal error:", err);
    process.exit(1);
  });
