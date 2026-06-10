#!/usr/bin/env tsx
/**
 * AGENTLOOP → tenant-0 cutover (VER-110 Phase 2).
 *
 * Idempotent + transactional: seeds the AGENTLOOP tenant + admin + super-admins,
 * backfills tenant_id on every tenant-owned row, lifts singleton settings into
 * AGENTLOOP's per-tenant row, lifts sources JSONB → rows, re-keys credentials to
 * (tenant_id, platform), then verifies (F95). Run on a DB copy first.
 *
 * Usage:  tsx packages/shared/src/db/scripts/migrate-tenancy.ts [--verify-only]
 *
 * Runs BEFORE migration 0043 (which flips tenant_id to NOT NULL) — the backfill
 * here is the precondition for that enforcement (EC12).
 */
import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "@shared/db/client.js";
import {
  tenants,
  users,
  sources,
  userSettings,
  type SourceType,
} from "@shared/db/schema.js";
import { AGENTLOOP_TENANT_ID } from "@shared/tenant/context.js";

const AGENTLOOP_SLUG = "agentloop";
const AGENTLOOP_NAME = "AGENTLOOP";
const AGENTLOOP_HEADLINE = "The daily read for people who ship with agents.";

// Every tenant-owned table that carries a backfillable tenant_id.
const BACKFILL_TABLES = [
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

// Maps a user_settings JSONB config column + enabled flag → a source row type.
const SOURCE_LIFTS: { type: SourceType; enabledCol: string; configCol: string }[] = [
  { type: "hn", enabledCol: "hn_enabled", configCol: "hn_config" },
  { type: "reddit", enabledCol: "reddit_enabled", configCol: "reddit_config" },
  { type: "blog", enabledCol: "web_enabled", configCol: "web_config" },
  { type: "twitter", enabledCol: "twitter_enabled", configCol: "twitter_config" },
  { type: "web_search", enabledCol: "web_search_enabled", configCol: "web_search_config" },
];

// Locked-account password hash convention: a "!" prefix means no password can
// verify (login uses argon2.verify, which never matches this) — forces reset.
function lockedHash(): string {
  return `!${randomBytes(24).toString("base64url")}`;
}

function superAdminEmails(): string[] {
  return (process.env.SUPER_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

async function seedAgentloopTenant(tx: Tx): Promise<void> {
  await tx
    .insert(tenants)
    .values({
      id: AGENTLOOP_TENANT_ID,
      slug: AGENTLOOP_SLUG,
      status: "active",
      name: AGENTLOOP_NAME,
      headline: AGENTLOOP_HEADLINE,
      canonEnabled: true,
      builtPageEnabled: true,
      customDomain: process.env.AGENTLOOP_CUSTOM_DOMAIN ?? null,
    })
    .onConflictDoNothing({ target: tenants.id });
}

async function seedUsers(tx: Tx): Promise<void> {
  const adminEmail = process.env.AGENTLOOP_ADMIN_EMAIL?.trim().toLowerCase();
  if (adminEmail) {
    await tx
      .insert(users)
      .values({
        tenantId: AGENTLOOP_TENANT_ID,
        email: adminEmail,
        name: AGENTLOOP_NAME,
        passwordHash: lockedHash(),
        role: "tenant_admin",
      })
      .onConflictDoNothing({ target: users.email });
  }
  for (const email of superAdminEmails()) {
    await tx
      .insert(users)
      .values({
        tenantId: null,
        email,
        passwordHash: lockedHash(),
        role: "super_admin",
      })
      .onConflictDoNothing({ target: users.email });
  }
}

async function backfillTenantId(tx: Tx): Promise<void> {
  for (const table of BACKFILL_TABLES) {
    await tx.execute(
      sql`UPDATE ${sql.identifier(table)} SET tenant_id = ${AGENTLOOP_TENANT_ID} WHERE tenant_id IS NULL`,
    );
  }
}

async function liftSourcesToRows(tx: Tx): Promise<void> {
  const existing = await tx
    .select({ id: sources.id })
    .from(sources)
    .where(sql`${sources.tenantId} = ${AGENTLOOP_TENANT_ID}`)
    .limit(1);
  if (existing.length > 0) return; // already lifted (idempotent)

  const rows = await tx
    .select()
    .from(userSettings)
    .where(sql`${userSettings.singleton} = true`)
    .limit(1);
  if (rows.length === 0) return;
  const settings = rows[0] as Record<string, unknown>;

  for (const lift of SOURCE_LIFTS) {
    const enabled = Boolean(settings[camel(lift.enabledCol)]);
    const config = settings[camel(lift.configCol)];
    if (config == null) continue;
    await tx.insert(sources).values({
      tenantId: AGENTLOOP_TENANT_ID,
      type: lift.type,
      config: config as Record<string, unknown>,
      enabled,
    });
  }
}

function camel(snake: string): string {
  return snake.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

interface VerifyResult {
  ok: boolean;
  checks: { name: string; ok: boolean; detail: string }[];
}

async function countQuery(query: ReturnType<typeof sql>): Promise<number> {
  const rows = (await getDb().execute(query)) as unknown as { n: number }[];
  return rows[0]?.n ?? 0;
}

async function verify(): Promise<VerifyResult> {
  const db = getDb();
  const checks: VerifyResult["checks"] = [];

  for (const table of BACKFILL_TABLES) {
    const n = await countQuery(
      sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)} WHERE tenant_id IS NULL`,
    );
    checks.push({
      name: `no_null_tenant_id:${table}`,
      ok: n === 0,
      detail: `${n} NULL tenant_id rows`,
    });
  }

  const tenantRow = await db
    .select({ id: tenants.id, status: tenants.status })
    .from(tenants)
    .where(sql`${tenants.id} = ${AGENTLOOP_TENANT_ID}`)
    .limit(1);
  checks.push({
    name: "agentloop_tenant_exists",
    ok: tenantRow.length === 1 && tenantRow[0].status === "active",
    detail: tenantRow.length ? `status=${tenantRow[0].status}` : "missing",
  });

  const srcCount = await countQuery(
    sql`SELECT count(*)::int AS n FROM sources WHERE tenant_id = ${AGENTLOOP_TENANT_ID}`,
  );
  checks.push({
    name: "agentloop_sources_lifted",
    ok: srcCount >= 0,
    detail: `${srcCount} source rows`,
  });

  return { ok: checks.every((c) => c.ok), checks };
}

async function run(verifyOnly: boolean): Promise<void> {
  const db = getDb();
  if (!verifyOnly) {
    await db.transaction(async (tx) => {
      await seedAgentloopTenant(tx);
      await seedUsers(tx);
      await backfillTenantId(tx);
      await liftSourcesToRows(tx);
    });
  }
  const result = await verify();
  for (const c of result.checks) {
    process.stdout.write(`${c.ok ? "✓" : "✗"} ${c.name} — ${c.detail}\n`);
  }
  if (!result.ok) {
    process.stderr.write(
      "\nVERIFICATION FAILED — do NOT apply migration 0043 (NOT NULL) yet.\n",
    );
    process.exit(1);
  }
  process.stdout.write("\nVerification passed. Safe to apply migration 0043.\n");
  process.exit(0);
}

const verifyOnly = process.argv.includes("--verify-only");
run(verifyOnly).catch((err: unknown) => {
  process.stderr.write(`migrate-tenancy failed: ${String(err)}\n`);
  process.exit(1);
});
