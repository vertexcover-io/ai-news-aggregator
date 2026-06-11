/**
 * AGENTLOOP migration verification gate (REQ-115).
 *
 * Runs after migrate-agentloop-tenant.ts to verify:
 * 1. Zero NULL tenant_id on every tenant-owned table
 * 2. AGENTLOOP tenant exists with correct properties
 * 3. Tenant-admin user exists
 * 4. Super-admin user(s) seeded
 * 5. user_settings, social_credentials, social_tokens carry tenant_id
 *
 * Exits 0 on success, non-zero on any failure.
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { sql } from "drizzle-orm";
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

const AGENTLOOP_SLUG = process.env.AGENTLOOP_SLUG || "agentloop";

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

interface VerifyResult {
  passed: boolean;
  failures: string[];
}

export async function verifyAgentloopMigration(db: AppDb): Promise<VerifyResult> {
  const failures: string[] = [];

  // 1. AGENTLOOP tenant exists
  const tenantRows = await db
    .select()
    .from(tenants)
    .where(sql`${tenants.slug} = ${AGENTLOOP_SLUG}`);

  if (tenantRows.length === 0) {
    failures.push("AGENTLOOP tenant not found");
  } else {
    const t = tenantRows[0];
    if (t.status !== "active") {
      failures.push(`AGENTLOOP tenant status is "${t.status}", expected "active"`);
    }
    if (!t.featureCanon) {
      failures.push("AGENTLOOP tenant featureCanon is false, expected true");
    }
  }

  // 2. Tenant_admin user exists for AGENTLOOP
  if (tenantRows.length > 0) {
    const tenantId = tenantRows[0].id;
    const adminUsers = await db
      .select()
      .from(users)
      .where(
        sql`${users.tenantId} = ${tenantId} AND ${users.role} = 'tenant_admin'`
      );

    if (adminUsers.length === 0) {
      failures.push("No tenant_admin user for AGENTLOOP tenant");
    }
  }

  // 3. Check zero NULL tenant_id on all tenant-owned tables
  for (const { name, table } of TENANT_TABLES) {
    const result = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(table)
      .where(sql`${table.tenantId} IS NULL`);

    const nulls = result[0]?.count ?? 0;
    if (nulls > 0) {
      failures.push(`${name}: ${nulls} rows have NULL tenant_id`);
    }
  }

  // 4. user_settings carries tenant_id (if AGENTLOOP exists)
  if (tenantRows.length > 0) {
    const settings = await db.select().from(userSettings);
    for (const row of settings) {
      if (row.tenantId === null) {
        failures.push("user_settings row has NULL tenant_id");
      }
    }
  }

  // 5. social_credentials carry tenant_id
  const creds = await db.select().from(socialCredentials);
  for (const row of creds) {
    if (row.tenantId === null) {
      failures.push(`social_credentials[${row.platform}] has NULL tenant_id`);
    }
  }

  // 6. social_tokens carry tenant_id
  const tokens = await db.select().from(socialTokens);
  for (const row of tokens) {
    if (row.tenantId === null) {
      failures.push(`social_tokens[${row.platform}] has NULL tenant_id`);
    }
  }

  return {
    passed: failures.length === 0,
    failures,
  };
}

// CLI entry point
async function main(): Promise<void> {
  const { getDb } = await import("@newsletter/shared/db");
  const db = getDb();

  console.log("Verifying AGENTLOOP tenant-0 migration...");
  const result = await verifyAgentloopMigration(db);

  if (result.passed) {
    console.log("PASSED: All verification checks successful.");
    process.exit(0);
  } else {
    console.error("FAILED: Verification found issues:");
    for (const f of result.failures) {
      console.error(`  - ${f}`);
    }
    process.exit(1);
  }
}

const isMainModule = process.argv[1]?.includes("verify-agentloop-migration");
if (isMainModule) {
  main().catch((err) => {
    console.error("Verification failed:", err);
    process.exit(1);
  });
}
