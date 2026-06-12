// Post-migration verification (REQ-115, REQ-122). Exits non-zero on any
// failed check; prints a PASS/FAIL line per check.
//
// - 0042 enforcement is live: tenant_id NOT NULL on all 13 tenant-scoped
//   tables + the per-tenant unique/PK reshapes exist (catches a DB where the
//   0041 backfill committed but 0042 failed midway).
// - Zero NULL tenant_id across all 13 tenant-scoped tables.
// - Row ownership: with --expect-single-tenant every row must belong to
//   tenant 0 and tenants must contain exactly one row (the migration
//   moment); without it, per-tenant counts are reported informationally.
//   Counts are taken at verify time — compare totals against a pre-migration
//   snapshot manually if you captured one.
// - AGENTLOOP entities resolve through the scoped repos (archives, settings,
//   sources, subscribers) — proves the tenant seam sees the migrated data.
// - Tenant 0 active with slug agentloop; tenant-admin exists; super admins
//   exist when SUPER_ADMIN_EMAILS is set.
// - --dry-run-pipeline: assembles tenant-0 run configs (enqueues nothing) and
//   requires a non-empty collector set.
//
// Usage: pnpm --filter @newsletter/api verify:migration [--expect-single-tenant] [--dry-run-pipeline]
import { pathToFileURL } from "node:url";
import { and, eq, sql } from "drizzle-orm";
import { users } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import { TENANT_ZERO_ID } from "@newsletter/shared/constants";
import { assembleRunConfigs } from "@newsletter/shared/services/sources-assembler";
import { createTenantsRepo } from "../src/repositories/tenants.js";
import { createRunArchivesRepo } from "../src/repositories/run-archives.js";
import { createUserSettingsRepo } from "../src/repositories/user-settings.js";
import { createSourcesRepo } from "../src/repositories/sources.js";
import { createSubscribersRepo } from "../src/repositories/subscribers.js";
import { createUsersRepo } from "../src/repositories/users.js";
import { parseSuperAdminEmails } from "./seed-super-admins.js";

const TENANT_SCOPED_TABLES = [
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
] as const;

export interface VerifyOptions {
  expectSingleTenant?: boolean;
  dryRunPipeline?: boolean;
  superAdminEmails?: string[];
}

export interface VerifyCheck {
  name: string;
  pass: boolean;
  detail: string;
  skipped?: boolean;
}

export interface VerifyResult {
  checks: VerifyCheck[];
  ok: boolean;
}

interface TableCounts {
  table: string;
  total: number;
  nulls: number;
  tenantZero: number;
}

async function tableCounts(db: AppDb, table: string): Promise<TableCounts> {
  const result = await db.execute<{
    total: number;
    nulls: number;
    tenant_zero: number;
  }>(sql`
    SELECT count(*)::int AS total,
      count(*) FILTER (WHERE tenant_id IS NULL)::int AS nulls,
      count(*) FILTER (WHERE tenant_id = ${TENANT_ZERO_ID})::int AS tenant_zero
    FROM ${sql.raw(table)}`);
  const row = result[0];
  return {
    table,
    total: row.total,
    nulls: row.nulls,
    tenantZero: row.tenant_zero,
  };
}

// Sentinel constraints created by 0042 — their absence means the enforcement
// migration never (fully) ran, even when the 0041 backfill left no NULLs.
const ENFORCEMENT_SENTINELS = [
  "subscribers_tenant_email_uq",
  "user_settings_tenant_uq",
  "raw_items_tenant_source_type_external_id_unique",
  "social_credentials_tenant_id_platform_pk",
] as const;

async function enforcementCheck(db: AppDb): Promise<VerifyCheck> {
  const nullableTables = await db.execute<{ table_name: string }>(sql`
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'tenant_id'
      AND table_name IN ${[...TENANT_SCOPED_TABLES]}
      AND is_nullable = 'YES'
    ORDER BY table_name`);
  const present = await db.execute<{ name: string }>(sql`
    SELECT indexname AS name FROM pg_indexes
    WHERE schemaname = 'public' AND indexname IN ${[...ENFORCEMENT_SENTINELS]}
    UNION
    SELECT conname AS name FROM pg_constraint
    WHERE conname IN ${[...ENFORCEMENT_SENTINELS]}`);
  const presentNames = new Set(present.map((r) => r.name));
  const missingSentinels = ENFORCEMENT_SENTINELS.filter((s) => !presentNames.has(s));

  const problems: string[] = [];
  if (nullableTables.length > 0) {
    problems.push(
      `nullable tenant_id: ${nullableTables.map((r) => r.table_name).join(", ")}`,
    );
  }
  if (missingSentinels.length > 0) {
    problems.push(`missing constraints: ${missingSentinels.join(", ")}`);
  }
  return {
    name: "0042 enforcement applied (NOT NULL + per-tenant constraints)",
    pass: problems.length === 0,
    detail:
      problems.length === 0
        ? "tenant_id NOT NULL on all 13 tables; per-tenant constraints present"
        : `${problems.join("; ")} — migration 0042 did not complete; re-run db:migrate`,
  };
}

export async function runVerifyTenantMigration(
  db: AppDb,
  opts: VerifyOptions,
): Promise<VerifyResult> {
  const checks: VerifyCheck[] = [];
  checks.push(await enforcementCheck(db));

  const counts: TableCounts[] = [];
  for (const table of TENANT_SCOPED_TABLES) {
    counts.push(await tableCounts(db, table));
  }

  const withNulls = counts.filter((c) => c.nulls > 0);
  checks.push({
    name: "no NULL tenant_id (13 tables)",
    pass: withNulls.length === 0,
    detail:
      withNulls.length === 0
        ? "0 NULL rows"
        : withNulls.map((c) => `${c.table}=${String(c.nulls)}`).join(", "),
  });

  if (opts.expectSingleTenant) {
    const tenantRows = await db.execute<{ c: number }>(
      sql`SELECT count(*)::int AS c FROM tenants`,
    );
    checks.push({
      name: "single tenant: tenants table has exactly one row",
      pass: tenantRows[0].c === 1,
      detail: `${String(tenantRows[0].c)} tenant rows`,
    });

    const offTenantZero = counts.filter((c) => c.tenantZero !== c.total);
    checks.push({
      name: "row-count parity (all rows on tenant 0)",
      pass: offTenantZero.length === 0,
      detail:
        offTenantZero.length === 0
          ? counts.map((c) => `${c.table}=${String(c.total)}`).join(", ")
          : offTenantZero
              .map((c) => `${c.table}: total=${String(c.total)} tenant0=${String(c.tenantZero)}`)
              .join(", "),
    });
  } else {
    checks.push({
      name: "per-tenant row counts (informational)",
      pass: true,
      detail: counts
        .map((c) => `${c.table}: total=${String(c.total)} tenant0=${String(c.tenantZero)}`)
        .join(", "),
    });
  }

  // REQ-122: the migrated data must resolve through the tenant-scoped seam.
  const archives = await createRunArchivesRepo(db, TENANT_ZERO_ID).list(5);
  checks.push({
    name: "scoped repo: run archives resolve for tenant 0",
    pass: archives.length > 0,
    detail: `list(5) returned ${String(archives.length)} rows`,
  });

  const settings = await createUserSettingsRepo(db, TENANT_ZERO_ID).get();
  checks.push({
    name: "scoped repo: settings resolve for tenant 0",
    pass: settings !== null,
    detail: settings ? `pipelineTime=${settings.pipelineTime}` : "get() returned null",
  });

  const enabledSources = await createSourcesRepo(db, TENANT_ZERO_ID).listEnabled();
  checks.push({
    name: "scoped repo: enabled sources non-empty for tenant 0",
    pass: enabledSources.length > 0,
    detail: `listEnabled() returned ${String(enabledSources.length)} rows`,
  });

  const confirmed = await createSubscribersRepo(db, TENANT_ZERO_ID).countConfirmed();
  checks.push({
    name: "scoped repo: subscribers count (reported)",
    pass: true,
    detail: `${String(confirmed)} confirmed subscribers`,
  });

  const tenantZero = await createTenantsRepo(db).findById(TENANT_ZERO_ID);
  checks.push({
    name: "tenant 0 active with slug agentloop",
    pass: tenantZero?.slug === "agentloop" && tenantZero.status === "active",
    detail: tenantZero
      ? `slug=${tenantZero.slug} status=${tenantZero.status}`
      : "tenant 0 row missing",
  });

  const [tenantAdmin] = await db
    .select({ email: users.email })
    .from(users)
    .where(and(eq(users.tenantId, TENANT_ZERO_ID), eq(users.role, "tenant_admin")))
    .limit(1);
  checks.push({
    name: "tenant-admin user exists for tenant 0",
    pass: tenantAdmin !== undefined,
    detail: tenantAdmin ? tenantAdmin.email : "no tenant_admin user on tenant 0",
  });

  const superAdminEmails = opts.superAdminEmails ?? [];
  if (superAdminEmails.length === 0) {
    checks.push({
      name: "super admins exist (SUPER_ADMIN_EMAILS)",
      pass: true,
      skipped: true,
      detail: "SUPER_ADMIN_EMAILS not set — check skipped, NOT verified",
    });
  } else {
    const usersRepo = createUsersRepo(db);
    const missing: string[] = [];
    for (const email of superAdminEmails) {
      const user = await usersRepo.findByEmail(email);
      if (!user || user.role !== "super_admin") missing.push(email);
    }
    checks.push({
      name: "super admins exist (SUPER_ADMIN_EMAILS)",
      pass: missing.length === 0,
      detail:
        missing.length === 0
          ? `${String(superAdminEmails.length)} present`
          : `missing: ${missing.join(", ")}`,
    });
  }

  if (opts.dryRunPipeline) {
    const collectors =
      settings === null ? {} : assembleRunConfigs(enabledSources, settings);
    const names = Object.keys(collectors);
    checks.push({
      name: "dry-run pipeline: assembled collector set non-empty",
      pass: names.length > 0,
      detail: names.length > 0 ? names.join(", ") : "no collectors assembled",
    });
  }

  return { checks, ok: checks.every((c) => c.pass) };
}

async function main(): Promise<void> {
  const { config } = await import("dotenv");
  config({ path: "../../.env" });
  const { getDb } = await import("@newsletter/shared/db");

  const result = await runVerifyTenantMigration(getDb(), {
    expectSingleTenant: process.argv.includes("--expect-single-tenant"),
    dryRunPipeline: process.argv.includes("--dry-run-pipeline"),
    superAdminEmails: process.env.SUPER_ADMIN_EMAILS
      ? parseSuperAdminEmails(process.env.SUPER_ADMIN_EMAILS)
      : [],
  });

  for (const check of result.checks) {
    const status = check.skipped ? "SKIP" : check.pass ? "PASS" : "FAIL";
    console.log(`${status}  ${check.name} — ${check.detail}`);
  }
  if (!result.ok) {
    console.error("verify-tenant-migration FAILED");
    process.exit(1);
  }
  console.log("verify-tenant-migration OK");
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
