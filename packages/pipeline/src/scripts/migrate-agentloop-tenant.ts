/**
 * AGENTLOOP tenant-0 backfill migration.
 *
 * Idempotent CLI script that:
 * 1. Creates the AGENTLOOP tenant + its tenant_admin user
 * 2. Seeds super-admin user(s) from SUPER_ADMIN_EMAILS
 * 3. Backfills tenant_id on all 13 tenant-owned tables
 * 4. Lifts singleton user_settings + social_credential/token rows to carry tenant_id
 *
 * Safe to run multiple times — uses INSERT ON CONFLICT DO NOTHING and
 * guarded UPDATE WHERE tenant_id IS NULL.
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import * as argon2 from "argon2";
import {
  tenants,
  users,
  rawItems,
  runArchives,
  runLogs,
  socialTokens,
  socialCredentials,
  userSettings,
  mustReadEntries,
  subscribers,
  emailSends,
  feedbackEvents,
  sesEvents,
  evalRuns,
  reviewEdits,
} from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";



config({ path: resolve(import.meta.dirname, "../../../../.env") });

const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
};

export interface MigrationResult {
  tenantId: string;
  tableCounts: Record<string, number>;
}

/** Tables with tenant_id that need backfill. */
const TENANT_TABLES = [
  { name: "raw_items", table: rawItems },
  { name: "run_archives", table: runArchives },
  { name: "run_logs", table: runLogs },
  { name: "social_tokens", table: socialTokens },
  { name: "social_credentials", table: socialCredentials },
  { name: "user_settings", table: userSettings },
  { name: "must_read_entries", table: mustReadEntries },
  { name: "subscribers", table: subscribers },
  { name: "email_sends", table: emailSends },
  { name: "feedback_events", table: feedbackEvents },
  { name: "ses_events", table: sesEvents },
  { name: "eval_runs", table: evalRuns },
  { name: "review_edits", table: reviewEdits },
] as const;

function generateTempPassword(): string {
  return randomBytes(16).toString("base64url");
}

export async function runAgentloopMigration(db: AppDb): Promise<MigrationResult> {
  const agentloopSlug = process.env.AGENTLOOP_SLUG || "agentloop";
  const agentloopName = process.env.AGENTLOOP_NAME || "AGENTLOOP";
  const agentloopCustomDomain = process.env.AGENTLOOP_CUSTOM_DOMAIN || null;
  const adminEmail = process.env.AGENTLOOP_ADMIN_EMAIL;
  const superAdminEmailsRaw = process.env.SUPER_ADMIN_EMAILS || "";
  const tempPassword = process.env.AGENTLOOP_TEMP_PASSWORD || generateTempPassword();

  const passwordHash = await argon2.hash(tempPassword, ARGON2_OPTIONS);

  // Pre-migration: capture row counts for each table
  const preCounts: Record<string, number> = {};
  for (const { name, table } of TENANT_TABLES) {
    const result = await db.select({ count: sql<number>`count(*)::int` }).from(table);
    preCounts[name] = result[0]?.count ?? 0;
  }

  // 1. Create AGENTLOOP tenant (idempotent via ON CONFLICT)
  const tenantId = randomUUID();
  await db.execute(sql`
    INSERT INTO ${tenants} (id, slug, name, status, custom_domain, feature_canon)
    VALUES (${tenantId}, ${agentloopSlug}, ${agentloopName}, 'active', ${agentloopCustomDomain}, true)
    ON CONFLICT (slug) DO NOTHING
  `);

  // Get the actual tenant id (may be different if already exists)
  const existingTenant = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(sql`${tenants.slug} = ${agentloopSlug}`)
    .limit(1);

  if (existingTenant.length === 0) {
    throw new Error("Failed to create or find AGENTLOOP tenant");
  }

  const actualTenantId = existingTenant[0].id;

  // 2. Create tenant_admin user (idempotent via ON CONFLICT)
  if (adminEmail) {
    await db.execute(sql`
      INSERT INTO ${users} (id, tenant_id, email, name, password_hash, role)
      VALUES (${randomUUID()}, ${actualTenantId}, ${adminEmail}, ${agentloopName + " Admin"}, ${passwordHash}, 'tenant_admin')
      ON CONFLICT (email) DO NOTHING
    `);
  }

  // 3. Seed super-admin users (no tenant)
  if (superAdminEmailsRaw) {
    const superAdminEmails = superAdminEmailsRaw
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean);

    for (const email of superAdminEmails) {
      const superAdminHash = await argon2.hash(tempPassword, ARGON2_OPTIONS);
      await db.execute(sql`
        INSERT INTO ${users} (id, tenant_id, email, name, password_hash, role)
        VALUES (${randomUUID()}, NULL, ${email}, ${"Super Admin"}, ${superAdminHash}, 'super_admin')
        ON CONFLICT (email) DO NOTHING
      `);
    }
  }

  // 4. Backfill tenant_id on all 13 tables (idempotent: WHERE tenant_id IS NULL)
  for (const { name, table } of TENANT_TABLES) {
    await db.execute(
      sql`UPDATE ${table} SET tenant_id = ${actualTenantId} WHERE tenant_id IS NULL`
    );
  }

  // Post-migration: capture row counts (should match pre-counts)
  const postCounts: Record<string, number> = {};
  for (const { name, table } of TENANT_TABLES) {
    const result = await db.select({ count: sql<number>`count(*)::int` }).from(table);
    postCounts[name] = result[0]?.count ?? 0;
  }

  return {
    tenantId: actualTenantId,
    tableCounts: postCounts,
  };
}

// CLI entry point
async function main(): Promise<void> {
  // Dynamic import to avoid loading DB client before env is configured
  const { getDb } = await import("@newsletter/shared/db");
  const db = getDb();

  console.log("Starting AGENTLOOP tenant-0 backfill migration...");
  const result = await runAgentloopMigration(db);
  console.log("Migration complete.");
  console.log(`  Tenant ID: ${result.tenantId}`);
  console.log("  Table counts:");
  for (const [table, count] of Object.entries(result.tableCounts)) {
    console.log(`    ${table}: ${count}`);
  }

  // Exit cleanly
  process.exit(0);
}

// Only run CLI when executed directly (not when imported in tests)
const isMainModule = process.argv[1]?.includes("migrate-agentloop-tenant");
if (isMainModule) {
  main().catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
}
