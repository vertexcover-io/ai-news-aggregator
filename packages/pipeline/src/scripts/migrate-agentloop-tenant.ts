/**
 * Phase 2: AGENTLOOP backfill migration
 *
 * Idempotent migration that:
 * 1. Creates the AGENTLOOP tenant (slug from env, branding from hardcoded values)
 * 2. Creates its tenant_admin user
 * 3. Seeds super-admin users from SUPER_ADMIN_EMAILS env var
 * 4. Backfills tenant_id = <agentloop_id> on all 13 tenant-owned tables
 * 5. Lifts singleton user_settings to carry tenant_id
 * 6. Enables AGENTLOOP-only features (Canon / feature_canon)
 *
 * Designed to be re-runnable: uses INSERT ... ON CONFLICT DO NOTHING
 * and guarded UPDATE WHERE tenant_id IS NULL.
 *
 * CRITICAL: Do NOT rotate SESSION_SECRET (D-104) — it is the HKDF KEK
 * for all encrypted credentials at rest.
 */

import { config } from "dotenv";
import { resolve } from "node:path";

import { getDb } from "@newsletter/shared/db";
import { sql } from "drizzle-orm";

export interface MigrationEnv {
  AGENTLOOP_SLUG?: string;
  AGENTLOOP_ADMIN_EMAIL?: string;
  SUPER_ADMIN_EMAILS?: string;
}

export interface MigrationResult {
  tenantId: string;
  adminUserId: string;
  tablesBackfilled: number;
  singletonLifted: boolean;
}

type RowWithId = { id: string };

export async function migrateAgentloopTenant(
  envOverride?: MigrationEnv,
): Promise<MigrationResult> {
  // Load .env if not already loaded
  config({ path: resolve(import.meta.dirname ?? process.cwd(), "../../../../.env") });

  const agentloopSlug = envOverride?.AGENTLOOP_SLUG ?? process.env.AGENTLOOP_SLUG ?? "agentloop";
  const adminEmail = envOverride?.AGENTLOOP_ADMIN_EMAIL ?? process.env.AGENTLOOP_ADMIN_EMAIL;
  const superAdminEmailsRaw = envOverride?.SUPER_ADMIN_EMAILS ?? process.env.SUPER_ADMIN_EMAILS ?? "";

  if (!adminEmail) {
    throw new Error(
      "AGENTLOOP_ADMIN_EMAIL is required. Set it in .env or pass via envOverride.",
    );
  }

  const db = getDb();

  // Step 1: Create the AGENTLOOP tenant (idempotent)
  const tenantRows = await db.execute<RowWithId>(sql`
    INSERT INTO tenants (
      slug, name, status,
      custom_domain, headline, topic_strip, subtagline,
      feature_canon, feature_deliverability, feature_eval
    ) VALUES (
      ${agentloopSlug},
      'AGENTLOOP',
      'active',
      ${process.env.AGENTLOOP_CUSTOM_DOMAIN ?? null},
      'Your daily AI news briefing',
      'AI',
      'Curated by the Vertexcover team',
      true,
      false,
      false
    )
    ON CONFLICT (slug) DO NOTHING
    RETURNING id
  `);

  let tenantId: string;
  if (tenantRows.length > 0 && tenantRows[0]) {
    tenantId = tenantRows[0].id;
  } else {
    const existing = await db.execute<RowWithId>(sql`
      SELECT id FROM tenants WHERE slug = ${agentloopSlug}
    `);
    if (!existing[0]) {
      throw new Error(`Failed to find or create tenant with slug: ${agentloopSlug}`);
    }
    tenantId = existing[0].id;
  }

  // Also ensure AGENTLOOP's features are enabled (idempotent update)
  await db.execute(sql`
    UPDATE tenants
    SET feature_canon = true
    WHERE id = ${tenantId}::uuid
  `);

  // Step 2: Create the tenant_admin user (idempotent)
  const userRows = await db.execute<RowWithId>(sql`
    INSERT INTO users (
      tenant_id, email, name, password_hash, role
    ) VALUES (
      ${tenantId}::uuid,
      ${adminEmail},
      'AGENTLOOP Admin',
      '',
      'tenant_admin'
    )
    ON CONFLICT (email) DO NOTHING
    RETURNING id
  `);

  let adminUserId: string;
  if (userRows.length > 0 && userRows[0]) {
    adminUserId = userRows[0].id;
  } else {
    const existingUser = await db.execute<RowWithId>(sql`
      SELECT id FROM users WHERE email = ${adminEmail}
    `);
    if (!existingUser[0]) {
      throw new Error(`Failed to find or create admin user: ${adminEmail}`);
    }
    adminUserId = existingUser[0].id;
  }

  // Step 3: Seed super-admins (idempotent, no tenant)
  const superAdminEmails = superAdminEmailsRaw
    .split(",")
    .map((e) => e.trim())
    .filter((e) => e.length > 0);

  for (const email of superAdminEmails) {
    const name = email.split("@")[0] ?? "Super Admin";
    await db.execute(sql`
      INSERT INTO users (
        tenant_id, email, name, password_hash, role
      ) VALUES (
        NULL,
        ${email},
        ${name},
        '',
        'super_admin'
      )
      ON CONFLICT (email) DO NOTHING
    `);
  }

  // Step 4: Backfill tenant_id on all 13 tenant-owned tables
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

  let tablesBackfilled = 0;
  for (const table of tableNames) {
    const result = await db.execute(
      sql.raw(
        `UPDATE "${table}" SET tenant_id = '${tenantId}'::uuid WHERE tenant_id IS NULL`,
      ),
    );
    // PgRaw<PgQueryResultKind<...>> — rowCount is part of the postgres-js result
    const pgResult = result as unknown as { rowCount: number };
    tablesBackfilled += pgResult.rowCount;
  }

  return {
    tenantId,
    adminUserId,
    tablesBackfilled,
    singletonLifted: true,
  };
}

// CLI entry point — run directly with tsx
// Only executes when this file is the entry point
const isMainModule = typeof import.meta !== "undefined" &&
  import.meta.url?.endsWith(process.argv[1]?.split("/").pop() ?? "");

if (isMainModule || process.argv[1]?.includes("migrate-agentloop-tenant")) {
  (async () => {
    const result = await migrateAgentloopTenant();
    console.log("AGENTLOOP tenant migration complete:");
    console.log(`  Tenant ID: ${result.tenantId}`);
    console.log(`  Admin User ID: ${result.adminUserId}`);
    console.log(`  Rows backfilled: ${result.tablesBackfilled}`);
    console.log(`  Singleton lifted: ${result.singletonLifted}`);
    process.exit(0);
  })().catch((err: unknown) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
}
