/**
 * Local-dev seed: stand up a second ACTIVE tenant so multi-tenant subdomain
 * serving can be exercised in the browser at `http://<slug>.lvh.me:5173`.
 *
 * Tenant 0 (AGENTLOOP) is created by `migrate:agentloop`; this script adds a
 * sibling tenant with its own branding + `tenant_admin` + a `user_settings`
 * row so its public site renders and the admin can log in. It is DEV-ONLY
 * tooling (not part of the deploy path) and fully idempotent — re-running it
 * leaves an existing tenant/admin/settings untouched.
 *
 * Unlike real activation (`services/onboarding.ts`), this does NOT register
 * BullMQ schedulers — `schedule_enabled` is left off so a local seed never
 * starts firing scheduled pipeline runs. Trigger runs manually from the admin
 * UI when you want them.
 *
 * Usage:
 *   pnpm --filter @newsletter/scripts seed:dev-tenant
 *   pnpm --filter @newsletter/scripts seed:dev-tenant -- --slug acme --name "Acme Daily" --email admin@acme.test
 * Env: DATABASE_URL (required). Optional: DEV_TENANT_SLUG, DEV_TENANT_NAME,
 *      DEV_TENANT_ADMIN_EMAIL, DEV_TENANT_ADMIN_PASSWORD.
 */
import { randomBytes, scryptSync } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import {
  DEFAULT_RANKING_PROMPT,
  DEFAULT_SHORTLIST_PROMPT,
} from "@newsletter/shared/constants";

export interface DevTenantSeedConfig {
  slug: string;
  name: string;
  headline: string;
  topicStrip: string;
  subtagline: string;
  adminEmail: string;
  adminName: string;
  /** Optional fixed password (otherwise a random temp password is generated). */
  adminPassword?: string;
}

export interface DevTenantSeedResult {
  tenantId: string;
  slug: string;
  createdTenant: boolean;
  createdAdmin: boolean;
  createdSettings: boolean;
  /** Set only when the admin user was created in this run. */
  adminTempPassword: string | null;
}

export const DEV_TENANT_DEFAULTS = {
  slug: "inference",
  name: "Inference Daily",
  headline: "Signal from the AI inference frontier.",
  topicStrip: "MODELS · SERVING · LATENCY · COST · EVALS",
  subtagline: "A second tenant for local multi-tenant testing.",
  adminName: "Inference Admin",
} as const;

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const;

/** Matches the interim scrypt hash format used by `migrate-agentloop-tenant.ts`. */
export function hashTempPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, SCRYPT_PARAMS);
  const params = `N=${SCRYPT_PARAMS.N},r=${SCRYPT_PARAMS.r},p=${SCRYPT_PARAMS.p}`;
  return `scrypt$${params}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

function generateTempPassword(): string {
  return randomBytes(18).toString("base64url");
}

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const RESERVED_SLUGS = new Set(["app", "www", "admin", "api", "mail"]);

export async function runDevTenantSeed(
  sql: postgres.Sql,
  cfg: DevTenantSeedConfig,
): Promise<DevTenantSeedResult> {
  const slug = cfg.slug.trim().toLowerCase();
  if (!SLUG_RE.test(slug) || RESERVED_SLUGS.has(slug)) {
    throw new Error(`invalid dev tenant slug: ${cfg.slug}`);
  }
  if (!cfg.adminEmail.includes("@")) {
    throw new Error(`invalid dev tenant admin email: ${cfg.adminEmail}`);
  }

  return sql.begin(async (tx) => {
    // -- 1. Tenant (active, idempotent). --------------------------------------
    const insertedTenant = await tx<{ id: string }[]>`
      INSERT INTO tenants (slug, name, status, headline, topic_strip, subtagline)
      VALUES (
        ${slug}, ${cfg.name}, 'active',
        ${cfg.headline}, ${cfg.topicStrip}, ${cfg.subtagline}
      )
      ON CONFLICT (slug) DO NOTHING
      RETURNING id
    `;
    const createdTenant = insertedTenant.length > 0;
    const tenant = createdTenant
      ? insertedTenant.at(0)
      : (await tx<{ id: string }[]>`SELECT id FROM tenants WHERE slug = ${slug}`).at(0);
    if (!tenant) throw new Error(`tenant ${slug} not found after insert`);
    const tenantId = tenant.id;

    // -- 2. Tenant admin (idempotent, no overwrite). --------------------------
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

    // -- 3. Settings row (one per tenant). Mirrors onboarding activation -----
    // defaults, but with schedule disabled (no scheduler registered here) and
    // the canonical prompts pre-filled so the tenant is immediately runnable.
    const insertedSettings = await tx`
      INSERT INTO user_settings (
        top_n, shortlist_size, ranking_prompt, shortlist_prompt,
        pipeline_time, email_time, linkedin_time, twitter_time,
        schedule_timezone, schedule_enabled, tenant_id
      ) VALUES (
        10, 30, ${DEFAULT_RANKING_PROMPT}, ${DEFAULT_SHORTLIST_PROMPT},
        '06:00', '07:30', '07:30', '07:30',
        'UTC', false, ${tenantId}
      )
      ON CONFLICT (tenant_id) DO NOTHING
      RETURNING id
    `;
    const createdSettings = insertedSettings.length > 0;

    return {
      tenantId,
      slug,
      createdTenant,
      createdAdmin,
      createdSettings,
      adminTempPassword: createdAdmin ? adminPassword : null,
    };
  });
}

function argValue(argv: string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  return idx >= 0 ? argv[idx + 1] : undefined;
}

function readConfig(
  env: NodeJS.ProcessEnv,
  argv: string[],
): DevTenantSeedConfig {
  const slug = (
    argValue(argv, "--slug") ?? env.DEV_TENANT_SLUG ?? DEV_TENANT_DEFAULTS.slug
  ).toLowerCase();
  const adminEmail =
    argValue(argv, "--email") ??
    env.DEV_TENANT_ADMIN_EMAIL ??
    `${slug}-admin@example.test`;
  const adminPassword =
    argValue(argv, "--password") ?? env.DEV_TENANT_ADMIN_PASSWORD;
  return {
    slug,
    name: argValue(argv, "--name") ?? env.DEV_TENANT_NAME ?? DEV_TENANT_DEFAULTS.name,
    headline: DEV_TENANT_DEFAULTS.headline,
    topicStrip: DEV_TENANT_DEFAULTS.topicStrip,
    subtagline: DEV_TENANT_DEFAULTS.subtagline,
    adminEmail,
    adminName: DEV_TENANT_DEFAULTS.adminName,
    ...(adminPassword ? { adminPassword } : {}),
  };
}

async function main(): Promise<void> {
  const { config } = await import("dotenv");
  config({ path: resolve(import.meta.dirname, "../../../.env") });

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const cfg = readConfig(process.env, process.argv);

  const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  try {
    const result = await runDevTenantSeed(sql, cfg);
    console.log(`dev tenant: ${result.tenantId} (${result.slug})`);
    console.log(
      result.createdTenant
        ? `  tenant created — public site: http://${result.slug}.lvh.me:5173`
        : `  tenant already existed — left untouched (http://${result.slug}.lvh.me:5173)`,
    );
    if (result.createdAdmin && result.adminTempPassword !== null) {
      console.log(
        `  tenant_admin ${cfg.adminEmail} created — TEMP PASSWORD (shown once): ${result.adminTempPassword}`,
      );
    } else {
      console.log(`  tenant_admin ${cfg.adminEmail} already existed — not modified`);
    }
    console.log(
      result.createdSettings
        ? "  user_settings row created (schedule disabled; prompts pre-filled)"
        : "  user_settings row already existed — not modified",
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
