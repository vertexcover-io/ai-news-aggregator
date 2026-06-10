/**
 * AGENTLOOP tenant-0 backfill (Phase 2 — REQ-110..114, REQ-127, EDGE-012).
 *
 * Idempotent, transactional CLI that stands AGENTLOOP up as tenant 0 with
 * zero data loss:
 *   1. Creates the AGENTLOOP tenant (slug/domain/branding from env,
 *      `active`, Canon/deliverability/eval features on) — `ON CONFLICT DO NOTHING`.
 *   2. Creates its `tenant_admin` user (temp password printed once; replaced
 *      by the real auth flow in P3) and seeds platform `super_admin`
 *      account(s) from SUPER_ADMIN_EMAILS — both `ON CONFLICT DO NOTHING`.
 *   3. Backfills `tenant_id` on all 13 tenant-owned tables with a guarded
 *      `UPDATE … WHERE tenant_id IS NULL` (lifts the singleton user_settings
 *      row; stamps social_credentials/social_tokens — PK change is P12).
 *   4. Sets a column DEFAULT (= AGENTLOOP tenant id) on every tenant-owned
 *      table so pre-tenancy writers (pipeline/api before P4+) keep working
 *      once the follow-up migration enforces NOT NULL (EDGE-012 bridge).
 *
 * Captures pre-migration row counts BEFORE any update (inside the same
 * transaction) and writes them to a counts file consumed by
 * `verify-agentloop-migration.ts` (REQ-115 check 1).
 *
 * NEVER rotates SESSION_SECRET (D-104) — it is the HKDF KEK for the encrypted
 * social credentials this migration re-points; this script does not touch it.
 *
 * Usage:
 *   pnpm --filter @newsletter/scripts migrate:agentloop [-- --counts-file <path>]
 * Env: DATABASE_URL (required), AGENTLOOP_ADMIN_EMAIL (required),
 *      AGENTLOOP_SLUG, AGENTLOOP_NAME, AGENTLOOP_CUSTOM_DOMAIN,
 *      AGENTLOOP_HEADLINE, AGENTLOOP_TOPIC_STRIP, AGENTLOOP_SUBTAGLINE,
 *      AGENTLOOP_ADMIN_NAME, AGENTLOOP_ADMIN_PASSWORD, SUPER_ADMIN_EMAILS.
 */
import { randomBytes, scryptSync } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import { TENANT_OWNED_TABLES } from "./tenant-tables.js";

export interface AgentloopBackfillConfig {
  slug: string;
  name: string;
  customDomain: string | null;
  headline: string;
  topicStrip: string;
  subtagline: string;
  adminEmail: string;
  adminName: string;
  /** Optional fixed password (rehearsals); a random temp password otherwise. */
  adminPassword?: string;
  superAdminEmails: string[];
}

export interface AgentloopBackfillResult {
  tenantId: string;
  createdTenant: boolean;
  createdAdmin: boolean;
  /** Set only when the admin user was created in this run. */
  adminTempPassword: string | null;
  createdSuperAdmins: { email: string; tempPassword: string }[];
  /** Row counts per tenant-owned table BEFORE any backfill update. */
  preCounts: Record<string, number>;
  /** Rows re-pointed (tenant_id was NULL) per table in this run. */
  updatedCounts: Record<string, number>;
}

/** Current hardcoded AGENTLOOP branding (packages/web HomePage/Masthead). */
export const AGENTLOOP_DEFAULTS = {
  slug: "agentloop",
  name: "AGENTLOOP",
  headline: "The daily read for people who ship with agents.",
  topicStrip:
    "AGENTIC CODING · HARNESS ENGINEERING · CONTEXT ENGINEERING · THE SOFTWARE FACTORY",
  subtagline: "No model releases. No benchmarks. No discourse. Just the craft.",
  adminName: "AgentLoop Admin",
} as const;

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const;

/**
 * Interim scrypt hash (`scrypt$N=…,r=…,p=…$<salt>$<hash>`, base64). P3 replaces
 * auth with argon2id; these accounts are expected to go through the password
 * reset flow — the temp password is only printed once at creation time.
 */
export function hashTempPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, SCRYPT_PARAMS);
  const params = `N=${SCRYPT_PARAMS.N},r=${SCRYPT_PARAMS.r},p=${SCRYPT_PARAMS.p}`;
  return `scrypt$${params}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

function generateTempPassword(): string {
  return randomBytes(18).toString("base64url");
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function runAgentloopBackfill(
  sql: postgres.Sql,
  cfg: AgentloopBackfillConfig,
): Promise<AgentloopBackfillResult> {
  if (!cfg.adminEmail.includes("@")) {
    throw new Error(`invalid AGENTLOOP admin email: ${cfg.adminEmail}`);
  }

  return sql.begin(async (tx) => {
    // -- 0. Pre-migration counts (REQ-115 check 1), before any write. --------
    const preCounts: Record<string, number> = {};
    for (const table of TENANT_OWNED_TABLES) {
      const [row] = await tx<{ n: string }[]>`
        SELECT count(*)::text AS n FROM ${tx(table)}
      `;
      preCounts[table] = Number(row.n);
    }

    // -- 1. AGENTLOOP tenant (idempotent). ------------------------------------
    const insertedTenant = await tx<{ id: string }[]>`
      INSERT INTO tenants (
        slug, name, status, custom_domain, headline, topic_strip, subtagline,
        feature_canon, feature_deliverability, feature_eval
      ) VALUES (
        ${cfg.slug}, ${cfg.name}, 'active', ${cfg.customDomain},
        ${cfg.headline}, ${cfg.topicStrip}, ${cfg.subtagline},
        true, true, true
      )
      ON CONFLICT (slug) DO NOTHING
      RETURNING id
    `;
    const createdTenant = insertedTenant.length > 0;
    const tenant = createdTenant
      ? insertedTenant.at(0)
      : (await tx<{ id: string }[]>`SELECT id FROM tenants WHERE slug = ${cfg.slug}`).at(0);
    if (!tenant) throw new Error(`tenant ${cfg.slug} not found after insert`);
    const tenantId = tenant.id;
    if (!UUID_RE.test(tenantId)) {
      throw new Error(`unexpected non-uuid tenant id: ${tenantId}`);
    }

    // -- 2. Tenant admin + platform super-admins (idempotent, no overwrite). --
    const adminPassword = cfg.adminPassword ?? generateTempPassword();
    const insertedAdmin = await tx`
      INSERT INTO users (tenant_id, email, name, password_hash, role)
      VALUES (
        ${tenantId}, ${cfg.adminEmail}, ${cfg.adminName},
        ${hashTempPassword(adminPassword)}, 'tenant_admin'
      )
      ON CONFLICT (email) DO NOTHING
      RETURNING id
    `;
    const createdAdmin = insertedAdmin.length > 0;

    const createdSuperAdmins: { email: string; tempPassword: string }[] = [];
    const seen = new Set([cfg.adminEmail.toLowerCase()]);
    for (const rawEmail of cfg.superAdminEmails) {
      const email = rawEmail.trim();
      if (!email || seen.has(email.toLowerCase())) continue;
      seen.add(email.toLowerCase());
      const tempPassword = generateTempPassword();
      const inserted = await tx`
        INSERT INTO users (tenant_id, email, name, password_hash, role)
        VALUES (NULL, ${email}, ${email.split("@")[0]},
                ${hashTempPassword(tempPassword)}, 'super_admin')
        ON CONFLICT (email) DO NOTHING
        RETURNING id
      `;
      if (inserted.length > 0) createdSuperAdmins.push({ email, tempPassword });
    }

    // -- 3. Backfill tenant_id on all 13 tenant-owned tables (guarded). -------
    // Lifts the singleton user_settings row and stamps social_credentials /
    // social_tokens (their PK change to (tenant_id, platform) happens in P12).
    const updatedCounts: Record<string, number> = {};
    for (const table of TENANT_OWNED_TABLES) {
      const result = await tx`
        UPDATE ${tx(table)} SET tenant_id = ${tenantId} WHERE tenant_id IS NULL
      `;
      updatedCounts[table] = result.count;
    }

    // -- 4. Default bridge (EDGE-012): until P4+ writers pass tenant_id -------
    // explicitly, new rows from the legacy single-tenant code paths default to
    // AGENTLOOP, so enforcing NOT NULL (follow-up migration) changes nothing.
    for (const table of TENANT_OWNED_TABLES) {
      await tx.unsafe(
        `ALTER TABLE "${table}" ALTER COLUMN tenant_id SET DEFAULT '${tenantId}'`,
      );
    }

    return {
      tenantId,
      createdTenant,
      createdAdmin,
      adminTempPassword: createdAdmin ? adminPassword : null,
      createdSuperAdmins,
      preCounts,
      updatedCounts,
    };
  });
}

export const DEFAULT_COUNTS_FILE = "agentloop-migration-counts.json";

export interface CountsFilePayload {
  capturedAt: string;
  slug: string;
  tenantId: string;
  preCounts: Record<string, number>;
}

function readEnvConfig(env: NodeJS.ProcessEnv): AgentloopBackfillConfig {
  const adminEmail = env.AGENTLOOP_ADMIN_EMAIL;
  if (!adminEmail) {
    throw new Error("AGENTLOOP_ADMIN_EMAIL is required (tenant admin account)");
  }
  return {
    slug: env.AGENTLOOP_SLUG ?? AGENTLOOP_DEFAULTS.slug,
    name: env.AGENTLOOP_NAME ?? AGENTLOOP_DEFAULTS.name,
    customDomain: env.AGENTLOOP_CUSTOM_DOMAIN ?? null,
    headline: env.AGENTLOOP_HEADLINE ?? AGENTLOOP_DEFAULTS.headline,
    topicStrip: env.AGENTLOOP_TOPIC_STRIP ?? AGENTLOOP_DEFAULTS.topicStrip,
    subtagline: env.AGENTLOOP_SUBTAGLINE ?? AGENTLOOP_DEFAULTS.subtagline,
    adminEmail,
    adminName: env.AGENTLOOP_ADMIN_NAME ?? AGENTLOOP_DEFAULTS.adminName,
    ...(env.AGENTLOOP_ADMIN_PASSWORD
      ? { adminPassword: env.AGENTLOOP_ADMIN_PASSWORD }
      : {}),
    superAdminEmails: (env.SUPER_ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim())
      .filter((e) => e.length > 0),
  };
}

function argValue(argv: string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  return idx >= 0 ? argv[idx + 1] : undefined;
}

async function main(): Promise<void> {
  const { config } = await import("dotenv");
  config({ path: resolve(import.meta.dirname, "../../../.env") });

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const cfg = readEnvConfig(process.env);
  const countsFile = resolve(
    argValue(process.argv, "--counts-file") ?? DEFAULT_COUNTS_FILE,
  );

  const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  try {
    const result = await runAgentloopBackfill(sql, cfg);

    const payload: CountsFilePayload = {
      capturedAt: new Date().toISOString(),
      slug: cfg.slug,
      tenantId: result.tenantId,
      preCounts: result.preCounts,
    };
    writeFileSync(countsFile, `${JSON.stringify(payload, null, 2)}\n`);

    console.log(`AGENTLOOP tenant: ${result.tenantId} (${cfg.slug})`);
    console.log(
      result.createdTenant ? "  tenant created" : "  tenant already existed — left untouched",
    );
    if (result.createdAdmin && result.adminTempPassword !== null) {
      console.log(
        `  tenant_admin ${cfg.adminEmail} created — TEMP PASSWORD (shown once): ${result.adminTempPassword}`,
      );
    } else {
      console.log(`  tenant_admin ${cfg.adminEmail} already existed — not modified`);
    }
    for (const sa of result.createdSuperAdmins) {
      console.log(
        `  super_admin ${sa.email} created — TEMP PASSWORD (shown once): ${sa.tempPassword}`,
      );
    }
    for (const table of TENANT_OWNED_TABLES) {
      console.log(
        `  ${table}: ${result.preCounts[table]} rows, ${result.updatedCounts[table]} backfilled`,
      );
    }
    console.log(`pre-migration counts written to ${countsFile}`);
    console.log(
      "Next: run verify-agentloop-migration.ts, then apply the enforce migration (pnpm migrate:up).",
    );
  } finally {
    await sql.end();
  }
}

const cliEntry = process.argv.at(1);
const isCliEntry =
  cliEntry !== undefined && import.meta.url === pathToFileURL(cliEntry).href;

if (isCliEntry) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}
