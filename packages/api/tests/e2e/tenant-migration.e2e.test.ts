/**
 * Phase 13 e2e: AGENTLOOP migration rehearsal on a dedicated scratch database
 * (REQ-110, REQ-113, REQ-114, REQ-115, REQ-122, REQ-127, EDGE-012).
 *
 * Uses its own scratch DB (newsletter_migration_e2e, dropped + recreated per
 * run) so it can never collide with newsletter_test fixtures or the dev DB:
 *  - applies migrations 0000–0040, seeds legacy-shaped data (pre-tenant
 *    singleton settings + rows with NULL tenant_id)
 *  - runs the 0041 backfill TWICE and asserts identical state (REQ-114 — the
 *    DB-backed idempotency test deferred from Phase 1), then 0042 applies
 *    cleanly (EDGE-012 ordering: backfill before enforcement)
 *  - runs migrate-agentloop twice (second run all-skips), checks the
 *    EC10 cipher gate and --dry-run / --reset-password behavior
 *  - runs verify-tenant-migration happy path (REQ-115)
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import { getCredentialCipher } from "@newsletter/shared/services/credential-cipher";
import { TENANT_ZERO_ID } from "@newsletter/shared/constants";
import { tenants, users } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import { runMigrateAgentloop } from "../../scripts/migrate-agentloop.js";
import { runVerifyTenantMigration } from "../../scripts/verify-tenant-migration.js";
import { TENANT_ZERO_BRANDING_DEFAULTS } from "@api/routes/tenant-config.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
config({ path: resolve(REPO_ROOT, ".env") });

const SCRATCH_DB = "newsletter_migration_e2e";
const MIGRATIONS_DIR = resolve(REPO_ROOT, "packages/shared/src/db/migrations");
const SESSION_SECRET = "tenant-migration-e2e-secret-at-least-32-bytes";
const CIPHER_ENV = { SESSION_SECRET } as NodeJS.ProcessEnv;
const ADMIN_EMAIL = "admin@agentloop-migration.test";
const ADMIN_PASSWORD = "agentloop-admin-password-1";
const SUPER_ADMIN_EMAIL = "root@agentloop-migration.test";
const SUPER_ADMIN_PASSWORD = "super-admin-password-1";

interface JournalEntry {
  idx: number;
  tag: string;
}

const journal = JSON.parse(
  readFileSync(resolve(MIGRATIONS_DIR, "meta/_journal.json"), "utf8"),
) as { entries: JournalEntry[] };

function migrationStatements(tag: string): string[] {
  return readFileSync(resolve(MIGRATIONS_DIR, `${tag}.sql`), "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function applyMigration(sql: postgres.Sql, tag: string): Promise<void> {
  for (const stmt of migrationStatements(tag)) {
    await sql.unsafe(stmt);
  }
}

function tagByIdx(idx: number): string {
  const entry = journal.entries.find((e) => e.idx === idx);
  if (!entry) throw new Error(`no migration with idx ${String(idx)}`);
  return entry.tag;
}

const SEEDED_TABLES = [
  "raw_items",
  "run_archives",
  "subscribers",
  "user_settings",
  "social_credentials",
  "social_tokens",
  "must_read_entries",
] as const;

interface Snapshot {
  tenants: unknown[];
  sources: unknown[];
  counts: Record<string, { total: number; nulls: number; tenantZero: number }>;
}

let maintenance: postgres.Sql;
let scratch: postgres.Sql;
let drizzleClient: postgres.Sql;
let db: AppDb;

async function snapshot(): Promise<Snapshot> {
  const tenantRows = await scratch`
    SELECT id, slug, name, status, canon_enabled FROM tenants ORDER BY id`;
  const sourceRows = await scratch`
    SELECT tenant_id, type, config, enabled FROM sources
    ORDER BY type, config::text`;
  const counts: Snapshot["counts"] = {};
  for (const table of SEEDED_TABLES) {
    const [row] = await scratch.unsafe(`
      SELECT count(*)::int AS total,
        count(*) FILTER (WHERE tenant_id IS NULL)::int AS nulls,
        count(*) FILTER (WHERE tenant_id = '${TENANT_ZERO_ID}')::int AS tenant_zero
      FROM ${table}`);
    counts[table] = {
      total: row.total as number,
      nulls: row.nulls as number,
      tenantZero: row.tenant_zero as number,
    };
  }
  return {
    tenants: tenantRows.map((r) => ({ ...r })),
    sources: sourceRows.map((r) => ({ ...r })),
    counts,
  };
}

beforeAll(async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL not set");

  maintenance = postgres(databaseUrl.replace(/\/[^/]+$/, "/postgres"));
  await maintenance.unsafe(`DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`);
  await maintenance.unsafe(`CREATE DATABASE ${SCRATCH_DB}`);

  const scratchUrl = databaseUrl.replace(/\/[^/]+$/, `/${SCRATCH_DB}`);
  scratch = postgres(scratchUrl, { onnotice: () => undefined });
  // drizzle() mutates its client's JSON serializers, which would corrupt the
  // raw fixture's sql.json params — give it a dedicated connection.
  drizzleClient = postgres(scratchUrl, { onnotice: () => undefined });
  db = drizzle(drizzleClient) as unknown as AppDb;

  // Pre-multi-tenant shape: everything up to and including 0040 (nullable
  // tenant_id columns + new empty tables), NOT 0041/0042.
  for (const entry of journal.entries) {
    if (entry.idx > 40) continue;
    await applyMigration(scratch, entry.tag);
  }

  const cipher = getCredentialCipher(CIPHER_ENV);
  const slackBlob = cipher.encrypt("https://hooks.slack.com/services/T0/B0/x");
  const linkedinFields = {
    clientId: cipher.encrypt("li-client-id"),
    clientSecret: cipher.encrypt("li-client-secret"),
  };
  const tokenFields = {
    accessToken: cipher.encrypt("li-access-token"),
    refreshToken: cipher.encrypt("li-refresh-token"),
  };

  // Legacy singleton settings carrying all five source configs (exercises the
  // full JSONB -> sources lift) + legacy rows with NULL tenant_id.
  await scratch`
    INSERT INTO user_settings (
      singleton, top_n, shortlist_size, half_life_hours,
      hn_enabled, hn_config, reddit_enabled, reddit_config,
      web_enabled, web_config, twitter_enabled, twitter_config,
      web_search_enabled, web_search_config,
      ranking_prompt, shortlist_prompt,
      pipeline_time, email_time, linkedin_time, twitter_time,
      schedule_timezone, schedule_enabled, slack_webhook_encrypted
    ) VALUES (
      true, 10, 30, 24,
      true, ${scratch.json({ sinceDays: 1, pointsThreshold: 50 })},
      true, ${scratch.json({ subreddits: ["LocalLLaMA", "MachineLearning"], sinceDays: 2 })},
      true, ${scratch.json({ sources: [{ name: "Example Blog", listingUrl: "https://example.com/blog" }], maxItems: 10 })},
      true, ${scratch.json({ listIds: ["1234567890"], users: [{ handle: "someone" }] })},
      true, ${scratch.json({ provider: "tavily", queries: [{ query: "ai agent news", sinceDays: 1, maxItems: 5 }] })},
      'legacy ranking prompt', 'legacy shortlist prompt',
      '06:00', '07:00', '08:00', '09:00',
      'America/New_York', true, ${scratch.json(slackBlob)}
    )`;
  await scratch`
    INSERT INTO raw_items (source_type, external_id, title, url)
    VALUES
      ('hn', 'legacy-1', 'Legacy item 1', 'https://example.com/1'),
      ('hn', 'legacy-2', 'Legacy item 2', 'https://example.com/2'),
      ('reddit', 'legacy-3', 'Legacy item 3', 'https://example.com/3')`;
  await scratch`
    INSERT INTO run_archives (id, status, ranked_items, top_n, completed_at)
    VALUES
      (gen_random_uuid(), 'completed', '[]', 10, now()),
      (gen_random_uuid(), 'completed', '[]', 10, now())`;
  await scratch`
    INSERT INTO subscribers (email, status)
    VALUES
      ('legacy-confirmed@example.com', 'confirmed'),
      ('legacy-pending@example.com', 'pending')`;
  await scratch`
    INSERT INTO must_read_entries (url, title, annotation)
    VALUES ('https://example.com/canon', 'Canon entry', 'why it matters')`;
  await scratch`
    INSERT INTO social_credentials (platform, encrypted_fields)
    VALUES ('linkedin', ${scratch.json(linkedinFields)})`;
  await scratch`
    INSERT INTO social_tokens (platform, encrypted_fields, expires_at)
    VALUES ('linkedin', ${scratch.json(tokenFields)}, now() + interval '1 hour')`;
}, 60000);

afterAll(async () => {
  await drizzleClient?.end();
  await scratch?.end();
  if (maintenance) {
    await maintenance.unsafe(
      `DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)`,
    );
    await maintenance.end();
  }
});

describe("0041 backfill idempotency (REQ-114)", () => {
  let first: Snapshot;

  it("backfills tenant 0 and the sources lift on first run", async () => {
    await applyMigration(scratch, tagByIdx(41));
    first = await snapshot();

    expect(first.tenants).toHaveLength(1);
    expect(first.tenants[0]).toMatchObject({
      id: TENANT_ZERO_ID,
      slug: "agentloop",
      name: "AGENTLOOP",
      status: "active",
      canon_enabled: true,
    });
    // hn(1) + reddit(2) + web(1) + twitter(list+user=2) + web_search(1)
    expect(first.sources).toHaveLength(7);
    for (const table of SEEDED_TABLES) {
      expect(first.counts[table].nulls, `${table} nulls`).toBe(0);
      expect(first.counts[table].tenantZero, `${table} tenant0`).toBe(
        first.counts[table].total,
      );
    }
  });

  it("re-running 0041 produces identical state (no duplicate tenant/sources rows)", async () => {
    await applyMigration(scratch, tagByIdx(41));
    const second = await snapshot();
    expect(second).toEqual(first);
  });

  it("verify FAILs the schema-enforcement check while 0042 is missing (half-migrated guard)", async () => {
    const result = await runVerifyTenantMigration(db, {});
    const enforcement = result.checks.find((c) =>
      c.name.includes("0042 enforcement"),
    );
    expect(enforcement?.pass).toBe(false);
    expect(enforcement?.detail).toContain("nullable tenant_id");
    expect(result.ok).toBe(false);
  });

  it("0042 enforcement applies cleanly after the backfill (EDGE-012)", async () => {
    await applyMigration(scratch, tagByIdx(42));
    const [row] = await scratch`
      SELECT count(*)::int AS c FROM information_schema.columns
      WHERE table_name = 'raw_items' AND column_name = 'tenant_id'
        AND is_nullable = 'NO'`;
    expect(row.c).toBe(1);
  });
});

describe("migrate-agentloop seed (REQ-110, REQ-113, EC10)", () => {
  const baseOpts = {
    adminEmail: ADMIN_EMAIL,
    adminPassword: ADMIN_PASSWORD,
    superAdminEmails: [SUPER_ADMIN_EMAIL],
    superAdminPassword: SUPER_ADMIN_PASSWORD,
    env: CIPHER_ENV,
  };

  async function tenantZeroUser() {
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.tenantId, TENANT_ZERO_ID));
    return rows[0] ?? null;
  }

  it("dry-run reports planned changes and writes nothing", async () => {
    const report = await runMigrateAgentloop(db, { ...baseOpts, dryRun: true });
    expect(report.failures).toEqual([]);
    expect(await tenantZeroUser()).toBeNull();
    const [tenant] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, TENANT_ZERO_ID));
    expect(tenant.headline).toBeNull();
    const superAdmin = await db
      .select()
      .from(users)
      .where(eq(users.email, SUPER_ADMIN_EMAIL));
    expect(superAdmin).toHaveLength(0);
  });

  it("first run creates the tenant-admin, super admins, and branding", async () => {
    const report = await runMigrateAgentloop(db, baseOpts);
    expect(report.failures).toEqual([]);

    const admin = await tenantZeroUser();
    expect(admin).toMatchObject({ email: ADMIN_EMAIL, role: "tenant_admin" });

    const superAdmin = await db
      .select()
      .from(users)
      .where(eq(users.email, SUPER_ADMIN_EMAIL));
    expect(superAdmin[0]).toMatchObject({ role: "super_admin", tenantId: null });

    const [tenant] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, TENANT_ZERO_ID));
    expect(tenant.headline).toBe(TENANT_ZERO_BRANDING_DEFAULTS.headline);
    expect(tenant.topicStrip).toBe(TENANT_ZERO_BRANDING_DEFAULTS.topicStrip);
    expect(tenant.subtagline).toBe(TENANT_ZERO_BRANDING_DEFAULTS.subtagline);
    expect(tenant.canonEnabled).toBe(true);
  });

  it("second run all-skips: same user, unchanged password, no branding overwrite", async () => {
    const before = await tenantZeroUser();
    await db
      .update(tenants)
      .set({ headline: "Custom headline kept" })
      .where(eq(tenants.id, TENANT_ZERO_ID));

    const report = await runMigrateAgentloop(db, baseOpts);
    expect(report.failures).toEqual([]);

    const after = await tenantZeroUser();
    expect(after?.id).toBe(before?.id);
    expect(after?.passwordHash).toBe(before?.passwordHash);

    const [tenant] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, TENANT_ZERO_ID));
    expect(tenant.headline).toBe("Custom headline kept");

    const allUsers = await db.select().from(users);
    expect(allUsers).toHaveLength(2);
  });

  it("--reset-password rotates the tenant-admin hash; dry-run does not", async () => {
    const before = await tenantZeroUser();

    const dry = await runMigrateAgentloop(db, {
      ...baseOpts,
      resetPassword: true,
      dryRun: true,
    });
    expect(dry.failures).toEqual([]);
    expect((await tenantZeroUser())?.passwordHash).toBe(before?.passwordHash);

    const wet = await runMigrateAgentloop(db, {
      ...baseOpts,
      adminPassword: "rotated-password-2",
      resetPassword: true,
    });
    expect(wet.failures).toEqual([]);
    expect((await tenantZeroUser())?.passwordHash).not.toBe(
      before?.passwordHash,
    );
  });

  it("aborts when SESSION_SECRET cannot decrypt existing tenant-0 credentials (EC10)", async () => {
    const report = await runMigrateAgentloop(db, {
      ...baseOpts,
      env: {
        SESSION_SECRET: "a-different-session-secret-32-bytes-long!",
      } as NodeJS.ProcessEnv,
    });
    expect(report.failures.length).toBeGreaterThan(0);
    expect(report.failures.join("\n")).toMatch(/SESSION_SECRET/);
  });
});

describe("verify-tenant-migration (REQ-115, REQ-122)", () => {
  it("passes all checks on the migrated scratch DB", async () => {
    const result = await runVerifyTenantMigration(db, {
      expectSingleTenant: true,
      dryRunPipeline: true,
      superAdminEmails: [SUPER_ADMIN_EMAIL],
    });
    const failing = result.checks.filter((c) => !c.pass);
    expect(failing).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("fails --expect-single-tenant when another tenant owns rows", async () => {
    const [other] = await db
      .insert(tenants)
      .values({ slug: "other-tenant", name: "Other", status: "active" })
      .returning();

    const strayOnly = await runVerifyTenantMigration(db, {
      expectSingleTenant: true,
    });
    expect(strayOnly.ok).toBe(false);

    await scratch`
      INSERT INTO subscribers (tenant_id, email, status)
      VALUES (${other.id}, 'other@example.com', 'confirmed')`;

    const strict = await runVerifyTenantMigration(db, {
      expectSingleTenant: true,
    });
    expect(strict.ok).toBe(false);

    const loose = await runVerifyTenantMigration(db, {});
    expect(loose.ok).toBe(true);
  });
});
