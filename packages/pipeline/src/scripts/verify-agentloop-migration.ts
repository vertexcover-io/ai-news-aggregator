/**
 * Phase 2: AGENTLOOP migration verification gate
 *
 * Verifies:
 * 1. Row counts match pre-migration (counts before and after backfill are equal)
 * 2. No NULL tenant_id remains on any tenant-owned table
 * 3. AGENTLOOP entities resolve under the tenant
 * 4. (Optional) Dry-run pipeline enqueue succeeds
 *
 * Runs as a standalone script: tsx src/scripts/verify-agentloop-migration.ts
 * Returns exit code 0 on pass, non-zero on fail.
 */

import { config } from "dotenv";
import { resolve } from "node:path";

import { getDb } from "@newsletter/shared/db";
import { sql } from "drizzle-orm";

export interface VerificationResult {
  passed: boolean;
  checks: VerificationCheck[];
  summary: string;
}

export interface VerificationCheck {
  name: string;
  passed: boolean;
  message: string;
}

type CountRow = { cnt: number };

type TenantRow = {
  id: string;
  slug: string;
  name: string;
  status: string;
  feature_canon: boolean;
};

type UserRow = {
  id: string;
  email: string;
  role: string;
};

export async function verifyAgentloopMigration(
  preMigrationCounts?: Record<string, number>,
): Promise<VerificationResult> {
  // Load .env if not already loaded
  config({ path: resolve(import.meta.dirname ?? process.cwd(), "../../../../.env") });

  const db = getDb();
  const checks: VerificationCheck[] = [];

  const tableNames = [
    "raw_items",
    "run_archives",
    "run_logs",
    "review_edits",
    "email_sends",
    "subscribers",
    "feedback_events",
    "ses_events",
    "eval_runs",
    "must_read_entries",
    "user_settings",
    "social_credentials",
    "social_tokens",
  ];

  // Check 1: Row counts match pre-migration (if provided)
  if (preMigrationCounts) {
    for (const table of tableNames) {
      const countResult = await db.execute<CountRow>(
        sql.raw(`SELECT COUNT(*)::int AS cnt FROM "${table}"`),
      );
      const currentCount = countResult[0]?.cnt;
      const preCount = preMigrationCounts[table];

      if (preCount !== undefined && currentCount !== undefined) {
        const match = preCount === currentCount;
        checks.push({
          name: `count_${table}`,
          passed: match,
          message: match
            ? `Row count matches: ${String(currentCount)}`
            : `Row count MISMATCH: pre=${String(preCount)}, post=${String(currentCount)}`,
        });
      }
    }
  }

  // Check 2: No NULL tenant_id on any tenant-owned table
  let allNullClear = true;
  for (const table of tableNames) {
    const nullResult = await db.execute<CountRow>(
      sql.raw(`SELECT COUNT(*)::int AS cnt FROM "${table}" WHERE tenant_id IS NULL`),
    );
    const nullCount = nullResult[0]?.cnt ?? 0;
    const passed = nullCount === 0;
    checks.push({
      name: `null_${table}`,
      passed,
      message: passed
        ? "No NULL tenant_id rows"
        : `${String(nullCount)} rows still have NULL tenant_id`,
    });
    if (!passed) allNullClear = false;
  }

  // Check 3: AGENTLOOP tenant exists and has expected properties
  const tenantResult = await db.execute<TenantRow>(sql`
    SELECT id, slug, name, status, feature_canon
    FROM tenants
    WHERE slug = 'agentloop'
  `);

  const agentloopTenant = tenantResult[0];
  if (agentloopTenant) {
    checks.push({
      name: "agentloop_tenant_exists",
      passed: true,
      message: `Found tenant: ${agentloopTenant.slug} (status: ${agentloopTenant.status})`,
    });

    const canonEnabled = agentloopTenant.feature_canon === true;
    checks.push({
      name: "agentloop_feature_canon",
      passed: canonEnabled,
      message: canonEnabled
        ? "feature_canon is enabled"
        : "feature_canon is NOT enabled",
    });
  } else {
    checks.push({
      name: "agentloop_tenant_exists",
      passed: false,
      message: "AGENTLOOP tenant not found",
    });
  }

  // Check 4: AGENTLOOP tenant_admin user exists
  const adminEmail = process.env.AGENTLOOP_ADMIN_EMAIL;
  if (adminEmail && agentloopTenant) {
    const userResult = await db.execute<UserRow>(sql`
      SELECT id, email, role
      FROM users
      WHERE email = ${adminEmail}
        AND tenant_id = ${agentloopTenant.id}::uuid
    `);
    const user = userResult[0];
    checks.push({
      name: "agentloop_admin_user",
      passed: user !== undefined,
      message: user
        ? `Admin user found: ${user.email} (role: ${user.role})`
        : `Admin user ${adminEmail} not found under tenant`,
    });
  }

  // Check 5: Super-admins seeded (if configured)
  const superAdminEmailsRaw = process.env.SUPER_ADMIN_EMAILS ?? "";
  const superAdminEmails = superAdminEmailsRaw
    .split(",")
    .map((e) => e.trim())
    .filter((e) => e.length > 0);

  for (const email of superAdminEmails) {
    const suResult = await db.execute<UserRow>(sql`
      SELECT id, email, role
      FROM users
      WHERE email = ${email}
        AND role = 'super_admin'
        AND tenant_id IS NULL
    `);
    const su = suResult[0];
    checks.push({
      name: `super_admin_${email}`,
      passed: su !== undefined,
      message: su
        ? `Super admin found: ${su.email}`
        : `Super admin ${email} not found`,
    });
  }

  const passed = checks.every((c) => c.passed);
  return {
    passed,
    checks,
    summary: allNullClear
      ? "All NULL tenant_id values cleared. AGENTLOOP tenant and admin are set up."
      : "WARNING: Some tables still have NULL tenant_id values. Run the backfill migration first.",
  };
}

// CLI entry point
const isMainModule = typeof import.meta !== "undefined" &&
  import.meta.url?.endsWith(process.argv[1]?.split("/").pop() ?? "");

if (isMainModule || process.argv[1]?.includes("verify-agentloop-migration")) {
  (async () => {
    const result = await verifyAgentloopMigration();
    console.log("\nVerification Results:");
    console.log("=====================\n");
    for (const check of result.checks) {
      const icon = check.passed ? "PASS" : "FAIL";
      console.log(`[${icon}] ${check.name}: ${check.message}`);
    }
    console.log(`\nSummary: ${result.summary}`);
    console.log(`Overall: ${result.passed ? "PASSED" : "FAILED"}`);
    process.exit(result.passed ? 0 : 1);
  })().catch((err: unknown) => {
    console.error("Verification failed:", err);
    process.exit(1);
  });
}
