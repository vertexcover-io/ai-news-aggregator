/**
 * Phase 2 (multi-tenant) e2e: AGENTLOOP backfill → tenant 0 with zero data loss.
 *
 * Rehearses the full production migration sequence on a throwaway DB:
 *   1. Apply migrations through 0040 (legacy-shaped schema: nullable tenant_id).
 *   2. Seed legacy rows (NULL tenant_id) in all 13 tenant-owned tables,
 *      including the singleton user_settings row.
 *   3. EDGE-012: applying the enforce migration BEFORE backfill is rejected.
 *   4. Run the backfill script → tenant + admin + super-admins created,
 *      every row re-pointed, counts preserved, idempotent on re-run.
 *   5. Run the verification gate (REQ-115's four checks, incl. a --dry-run
 *      pipeline enqueue against real Redis).
 *   6. Apply the enforce migration → NOT NULL holds, singleton index swapped
 *      for unique(tenant_id), and legacy-shaped inserts still work via the
 *      tenant-0 column DEFAULT bridge (AGENTLOOP behaves identically).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { TENANT_OWNED_TABLES } from "../../src/tenant-tables.js";
import { runAgentloopBackfill } from "../../src/migrate-agentloop-tenant.js";
import type { AgentloopBackfillResult } from "../../src/migrate-agentloop-tenant.js";
import { runAgentloopVerification } from "../../src/verify-agentloop-migration.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
config({ path: resolve(REPO_ROOT, ".env") });

const fullMigrationsFolder = resolve(
  REPO_ROOT,
  "packages/shared/src/db/migrations",
);

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL must be set (see .env) to run migration e2e tests");
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

const testDbName = `agentloop_migration_test_${randomBytes(4).toString("hex")}`;

const admin = postgres(baseUrl, { max: 1 });
let sql: postgres.Sql;
let legacyMigrationsFolder: string;
let tmpRoot: string;

/** idx of the last pre-enforcement migration (nullable tenant_id, P1). */
const LEGACY_LAST_IDX = 40;

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

/** Copy the migrations folder but truncate the journal after `throughIdx`,
 * so drizzle applies only the legacy (pre-enforce) migrations. */
function buildLegacyMigrationsFolder(throughIdx: number): string {
  const journal = JSON.parse(
    readFileSync(join(fullMigrationsFolder, "meta/_journal.json"), "utf8"),
  ) as { version: string; dialect: string; entries: JournalEntry[] };
  const kept = journal.entries.filter((e) => e.idx <= throughIdx);
  expect(kept.length).toBe(throughIdx + 1);

  const dir = mkdtempSync(join(tmpRoot, "legacy-migrations-"));
  mkdirSync(join(dir, "meta"), { recursive: true });
  for (const entry of kept) {
    cpSync(
      join(fullMigrationsFolder, `${entry.tag}.sql`),
      join(dir, `${entry.tag}.sql`),
    );
  }
  writeFileSync(
    join(dir, "meta/_journal.json"),
    JSON.stringify({ ...journal, entries: kept }),
  );
  return dir;
}

const BACKFILL_CONFIG = {
  slug: "agentloop",
  name: "AGENTLOOP",
  customDomain: "agentloop.example.com",
  headline: "The daily read for people who ship with agents.",
  topicStrip: "AGENTIC CODING · HARNESS ENGINEERING · CONTEXT ENGINEERING · THE SOFTWARE FACTORY",
  subtagline: "No model releases. No benchmarks. No discourse. Just the craft.",
  adminEmail: "ops@agentloop.test",
  adminName: "AgentLoop Ops",
  adminPassword: "temp-password-for-rehearsal",
  superAdminEmails: ["aman@vertexcover.test", "ritesh@vertexcover.test"],
};

const RUN_ID = "5b7e9d34-1111-4222-8333-444455556666";

async function countAll(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of TENANT_OWNED_TABLES) {
    const [row] = await sql<{ n: string }[]>`
      SELECT count(*)::text AS n FROM ${sql(table)}
    `;
    counts[table] = Number(row?.n ?? "0");
  }
  return counts;
}

async function nullTenantCounts(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of TENANT_OWNED_TABLES) {
    const [row] = await sql<{ n: string }[]>`
      SELECT count(*)::text AS n FROM ${sql(table)} WHERE tenant_id IS NULL
    `;
    counts[table] = Number(row?.n ?? "0");
  }
  return counts;
}

async function seedLegacyRows(): Promise<void> {
  await sql`
    INSERT INTO user_settings (
      top_n, shortlist_size, half_life_hours,
      hn_enabled, hn_config,
      ranking_prompt, shortlist_prompt,
      pipeline_time, email_time, linkedin_time, twitter_time,
      schedule_timezone
    ) VALUES (
      10, 30, 24,
      true, '{"limit": 30}'::jsonb,
      'rank prompt', 'shortlist prompt',
      '06:00', '07:00', '08:00', '09:00',
      'Asia/Kolkata'
    )
  `;
  await sql`
    INSERT INTO run_archives (id, status, ranked_items, top_n, completed_at)
    VALUES (${RUN_ID}, 'completed', '[]'::jsonb, 10, now())
  `;
  await sql`
    INSERT INTO raw_items (source_type, external_id, title, url, run_id)
    VALUES ('hn', 'hn-legacy-1', 'Legacy item', 'https://example.com/1', ${RUN_ID})
  `;
  await sql`
    INSERT INTO run_logs (run_id, level, stage, event, message)
    VALUES (${RUN_ID}, 'info', 'collect', 'collector_started', 'legacy log')
  `;
  await sql`
    INSERT INTO review_edits (run_id, edit_type)
    VALUES (${RUN_ID}, 'reorder')
  `;
  const [subscriber] = await sql<{ id: string }[]>`
    INSERT INTO subscribers (email, status)
    VALUES ('reader@example.com', 'confirmed')
    RETURNING id
  `;
  if (!subscriber) throw new Error("seed: subscriber insert failed");
  await sql`
    INSERT INTO email_sends (subscriber_id, run_archive_id)
    VALUES (${subscriber.id}, ${RUN_ID})
  `;
  await sql`
    INSERT INTO feedback_events (subscriber_id, campaign, rating)
    VALUES (${subscriber.id}, 'launch', 'love')
  `;
  await sql`
    INSERT INTO ses_events (message_id, event_type, raw_payload, occurred_at)
    VALUES ('msg-1', 'delivery', '{}'::jsonb, now())
  `;
  await sql`
    INSERT INTO eval_runs (mode, draft_prompt_hash, draft_prompt_snapshot, status)
    VALUES ('fixture', 'hash-1', 'snapshot', 'completed')
  `;
  await sql`
    INSERT INTO must_read_entries (url, title, annotation)
    VALUES ('https://example.com/canon', 'Canon entry', 'Read this.')
  `;
  await sql`
    INSERT INTO social_credentials (platform, encrypted_fields)
    VALUES ('linkedin', '{"clientId": {"v": 1}}'::jsonb)
  `;
  await sql`
    INSERT INTO social_tokens (platform, encrypted_fields, expires_at)
    VALUES ('linkedin', '{"accessToken": {"v": 1}}'::jsonb, now() + interval '30 days')
  `;
}

let seededCounts: Record<string, number>;
let backfill: AgentloopBackfillResult;

beforeAll(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), "agentloop-migration-e2e-"));
  await admin.unsafe(`CREATE DATABASE ${testDbName}`);
  const testUrl = new URL(baseUrl);
  testUrl.pathname = `/${testDbName}`;
  sql = postgres(testUrl.toString(), { max: 1, onnotice: () => undefined });

  legacyMigrationsFolder = buildLegacyMigrationsFolder(LEGACY_LAST_IDX);
  await migrate(drizzle(sql), { migrationsFolder: legacyMigrationsFolder });
  await seedLegacyRows();
  seededCounts = await countAll();
});

afterAll(async () => {
  await sql.end();
  await admin.unsafe(`DROP DATABASE IF EXISTS ${testDbName} WITH (FORCE)`);
  await admin.end();
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("AGENTLOOP tenant-0 backfill migration (e2e)", () => {
  it("test_EDGE_012_enforcement_after_backfill — enforce migration rejects while NULL tenant_id rows remain", async () => {
    await expect(
      migrate(drizzle(sql), { migrationsFolder: fullMigrationsFolder }),
    ).rejects.toThrow(/backfill|tenant_id/i);

    // The failed enforce migration must roll back cleanly: tenant_id still
    // nullable, no journal entry recorded, seeded rows untouched.
    const [col] = await sql<{ is_nullable: string }[]>`
      SELECT is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'raw_items' AND column_name = 'tenant_id'
    `;
    expect(col?.is_nullable).toBe("YES");
    expect(await countAll()).toEqual(seededCounts);
  });

  it("test_REQ_110_migration_creates_tenant_admin_superadmin", async () => {
    backfill = await runAgentloopBackfill(sql, BACKFILL_CONFIG);

    const [tenant] = await sql<
      {
        id: string;
        slug: string;
        name: string;
        status: string;
        custom_domain: string | null;
        headline: string | null;
        topic_strip: string | null;
        subtagline: string | null;
      }[]
    >`
      SELECT id, slug, name, status, custom_domain, headline, topic_strip, subtagline
      FROM tenants WHERE slug = ${BACKFILL_CONFIG.slug}
    `;
    expect(tenant).toBeDefined();
    expect(tenant?.id).toBe(backfill.tenantId);
    expect(tenant?.name).toBe(BACKFILL_CONFIG.name);
    expect(tenant?.status).toBe("active");
    expect(tenant?.custom_domain).toBe(BACKFILL_CONFIG.customDomain);
    expect(tenant?.headline).toBe(BACKFILL_CONFIG.headline);
    expect(tenant?.topic_strip).toBe(BACKFILL_CONFIG.topicStrip);
    expect(tenant?.subtagline).toBe(BACKFILL_CONFIG.subtagline);

    const [adminUser] = await sql<
      { tenant_id: string | null; role: string; password_hash: string }[]
    >`
      SELECT tenant_id, role, password_hash FROM users WHERE email = ${BACKFILL_CONFIG.adminEmail}
    `;
    expect(adminUser?.role).toBe("tenant_admin");
    expect(adminUser?.tenant_id).toBe(backfill.tenantId);
    expect(adminUser?.password_hash).toMatch(/^scrypt\$/);

    // Super admins are platform-level: no tenant.
    const superAdmins = await sql<{ email: string; tenant_id: string | null }[]>`
      SELECT email, tenant_id FROM users WHERE role = 'super_admin' ORDER BY email
    `;
    expect(superAdmins.map((u) => u.email)).toEqual(
      [...BACKFILL_CONFIG.superAdminEmails].sort(),
    );
    for (const u of superAdmins) expect(u.tenant_id).toBeNull();
  });

  it("test_REQ_111_migration_no_null_tenant_id — zero NULLs, zero data loss", async () => {
    const nulls = await nullTenantCounts();
    for (const table of TENANT_OWNED_TABLES) {
      expect(nulls[table], `${table} still has NULL tenant_id rows`).toBe(0);
    }
    expect(await countAll()).toEqual(seededCounts);
    expect(backfill.preCounts).toEqual(seededCounts);
  });

  it("test_REQ_112_singleton_settings_lifted_to_tenant — settings + social creds carry tenant_id, payloads untouched", async () => {
    const [settings] = await sql<
      { tenant_id: string | null; hn_config: unknown; ranking_prompt: string }[]
    >`
      SELECT tenant_id, hn_config, ranking_prompt FROM user_settings WHERE singleton = true
    `;
    expect(settings?.tenant_id).toBe(backfill.tenantId);
    expect(settings?.hn_config).toEqual({ limit: 30 });
    expect(settings?.ranking_prompt).toBe("rank prompt");

    const [cred] = await sql<{ tenant_id: string | null; encrypted_fields: unknown }[]>`
      SELECT tenant_id, encrypted_fields FROM social_credentials WHERE platform = 'linkedin'
    `;
    expect(cred?.tenant_id).toBe(backfill.tenantId);
    expect(cred?.encrypted_fields).toEqual({ clientId: { v: 1 } });

    const [token] = await sql<{ tenant_id: string | null; encrypted_fields: unknown }[]>`
      SELECT tenant_id, encrypted_fields FROM social_tokens WHERE platform = 'linkedin'
    `;
    expect(token?.tenant_id).toBe(backfill.tenantId);
    expect(token?.encrypted_fields).toEqual({ accessToken: { v: 1 } });
  });

  it("test_REQ_113_agentloop_features_enabled — Canon (and existing AGENTLOOP-only surfaces) on for tenant 0", async () => {
    const [tenant] = await sql<
      { feature_canon: boolean; feature_deliverability: boolean; feature_eval: boolean }[]
    >`
      SELECT feature_canon, feature_deliverability, feature_eval
      FROM tenants WHERE id = ${backfill.tenantId}
    `;
    expect(tenant?.feature_canon).toBe(true);
    expect(tenant?.feature_deliverability).toBe(true);
    expect(tenant?.feature_eval).toBe(true);
  });

  it("test_REQ_114_migration_idempotent_rerun — second run: no dupes, no errors, no lockout", async () => {
    const rerun = await runAgentloopBackfill(sql, BACKFILL_CONFIG);

    expect(rerun.tenantId).toBe(backfill.tenantId);
    expect(rerun.createdTenant).toBe(false);
    expect(rerun.createdAdmin).toBe(false);
    expect(rerun.createdSuperAdmins).toEqual([]);
    for (const table of TENANT_OWNED_TABLES) {
      expect(rerun.updatedCounts[table], `${table} re-updated on rerun`).toBe(0);
    }

    expect(await countAll()).toEqual(seededCounts);
    const [tenantCount] = await sql<{ n: string }[]>`
      SELECT count(*)::text AS n FROM tenants WHERE slug = ${BACKFILL_CONFIG.slug}
    `;
    expect(Number(tenantCount?.n)).toBe(1);
    const [userCount] = await sql<{ n: string }[]>`
      SELECT count(*)::text AS n FROM users
    `;
    expect(Number(userCount?.n)).toBe(1 + BACKFILL_CONFIG.superAdminEmails.length);

    // Existing password hashes must not be overwritten (no lockout).
    const [adminUser] = await sql<{ password_hash: string }[]>`
      SELECT password_hash FROM users WHERE email = ${BACKFILL_CONFIG.adminEmail}
    `;
    expect(adminUser?.password_hash).toMatch(/^scrypt\$/);
  });

  it("test_REQ_115_post_migration_verification_passes — all four checks green (incl. dry-run enqueue)", async () => {
    const report = await runAgentloopVerification(sql, {
      slug: BACKFILL_CONFIG.slug,
      preCounts: backfill.preCounts,
      redisUrl,
    });

    for (const check of report.checks) {
      expect(check.pass, `${check.name}: ${check.detail}`).toBe(true);
    }
    expect(report.pass).toBe(true);
    expect(report.checks.length).toBe(4);
  });

  it("test_REQ_122_legacy_rows_resolve_tenant0 — seeded legacy archives/subscribers/runs resolve under the tenant", async () => {
    const [archive] = await sql<{ id: string }[]>`
      SELECT id FROM run_archives WHERE tenant_id = ${backfill.tenantId} AND id = ${RUN_ID}
    `;
    expect(archive?.id).toBe(RUN_ID);

    const [subscriber] = await sql<{ email: string }[]>`
      SELECT email FROM subscribers WHERE tenant_id = ${backfill.tenantId}
    `;
    expect(subscriber?.email).toBe("reader@example.com");

    const [log] = await sql<{ run_id: string }[]>`
      SELECT run_id FROM run_logs WHERE tenant_id = ${backfill.tenantId}
    `;
    expect(log?.run_id).toBe(RUN_ID);
  });

  it("test_EDGE_012_enforcement_after_backfill — enforce migration applies after backfill; NOT NULL + index swap + default bridge hold", async () => {
    await migrate(drizzle(sql), { migrationsFolder: fullMigrationsFolder });

    // NOT NULL on every tenant-owned table.
    for (const table of TENANT_OWNED_TABLES) {
      const [col] = await sql<{ is_nullable: string }[]>`
        SELECT is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${table} AND column_name = 'tenant_id'
      `;
      expect(col?.is_nullable, `${table}.tenant_id must be NOT NULL post-enforce`).toBe("NO");
    }

    // Singleton unique index swapped for unique(tenant_id).
    const indexes = await sql<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'user_settings'
    `;
    const names = indexes.map((i) => i.indexname);
    expect(names).not.toContain("user_settings_singleton_uq");
    expect(names).toContain("user_settings_tenant_id_uq");

    // Default bridge: pre-tenancy writers (pipeline/api before P4+) insert
    // without tenant_id — the column DEFAULT resolves them to tenant 0, so
    // AGENTLOOP behaves identically post-enforce.
    const [inserted] = await sql<{ tenant_id: string }[]>`
      INSERT INTO raw_items (source_type, external_id, title, url)
      VALUES ('hn', 'hn-post-enforce-1', 'Post-enforce item', 'https://example.com/2')
      RETURNING tenant_id
    `;
    expect(inserted?.tenant_id).toBe(backfill.tenantId);
    await sql`DELETE FROM raw_items WHERE external_id = 'hn-post-enforce-1'`;
  });

  // P14 fix (REQ-053 regression guard / EDGE-005): AGENTLOOP historically
  // broadcasts via the shared platform sender, so tenant 0 — and ONLY tenant
  // 0 — is grandfathered to sending_domain_status='verified'. Migration 0046
  // added the column NULLABLE with no default, which would have left
  // AGENTLOOP NULL → blocked by the (fail-closed) broadcast gate.
  it("test_REQ_053_agentloop_grandfathered_verified — full migrations grandfather AGENTLOOP to 'verified'; fresh tenants stay NULL (blocked) and the column has NO default", async () => {
    // The data migration (applied with the full folder in the previous test)
    // healed the AGENTLOOP row: NULL → 'verified'.
    const [agentloop] = await sql<{ sending_domain_status: string | null }[]>`
      SELECT sending_domain_status FROM tenants WHERE id = ${backfill.tenantId}
    `;
    expect(agentloop?.sending_domain_status).toBe("verified");

    // NOT a column default: a brand-new tenant must come up NULL → its
    // broadcast stays blocked until it actually verifies a domain (REQ-053).
    const [colDefault] = await sql<{ column_default: string | null }[]>`
      SELECT column_default FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'tenants'
        AND column_name = 'sending_domain_status'
    `;
    expect(colDefault?.column_default).toBeNull();

    const [fresh] = await sql<{ sending_domain_status: string | null }[]>`
      INSERT INTO tenants (slug, name) VALUES ('fresh-signup', 'Fresh Signup')
      RETURNING sending_domain_status
    `;
    expect(fresh?.sending_domain_status).toBeNull();
  });

  it("test_REQ_053_backfill_rerun_heals_sending_domain — backfill re-run (post-0046 schema) restores 'verified' for AGENTLOOP only, never clobbers a real status, leaves other tenants NULL", async () => {
    // Simulate a DB where the column landed after the original backfill ran.
    await sql`
      UPDATE tenants SET sending_domain_status = NULL WHERE id = ${backfill.tenantId}
    `;

    const rerun = await runAgentloopBackfill(sql, BACKFILL_CONFIG);
    expect(rerun.tenantId).toBe(backfill.tenantId);

    const [agentloop] = await sql<{ sending_domain_status: string | null }[]>`
      SELECT sending_domain_status FROM tenants WHERE id = ${backfill.tenantId}
    `;
    expect(agentloop?.sending_domain_status).toBe("verified");

    // Tenant-0-only: the fresh tenant from the previous test is untouched.
    const [fresh] = await sql<{ sending_domain_status: string | null }[]>`
      SELECT sending_domain_status FROM tenants WHERE slug = 'fresh-signup'
    `;
    expect(fresh?.sending_domain_status).toBeNull();

    // Guarded (IS NULL): a real in-flight status is never overwritten back
    // to 'verified' by an idempotent re-run.
    await sql`
      UPDATE tenants SET sending_domain_status = 'pending' WHERE id = ${backfill.tenantId}
    `;
    await runAgentloopBackfill(sql, BACKFILL_CONFIG);
    const [pending] = await sql<{ sending_domain_status: string | null }[]>`
      SELECT sending_domain_status FROM tenants WHERE id = ${backfill.tenantId}
    `;
    expect(pending?.sending_domain_status).toBe("pending");

    // Restore the grandfathered state for any later assertions.
    await sql`
      UPDATE tenants SET sending_domain_status = 'verified' WHERE id = ${backfill.tenantId}
    `;
  });
});
