// AGENTLOOP cutover seed (REQ-110, REQ-113, EC10). Idempotent, re-runnable;
// exits non-zero on any failure. Run AFTER migrations 0040–0042.
//
// - Ensures the tenant-0 tenant-admin user from AGENTLOOP_ADMIN_EMAIL +
//   AGENTLOOP_ADMIN_PASSWORD (skips when it exists; --reset-password rotates).
// - Seeds super admins from SUPER_ADMIN_EMAILS + SUPER_ADMIN_PASSWORD.
// - Backfills NULL tenant-0 branding fields with the public-route defaults
//   and ensures canon_enabled = true; never overwrites non-null values.
// - EC10 gate: cipher round-trip probe + decrypt of one existing tenant-0
//   credential per store to prove SESSION_SECRET did not rotate.
// - --dry-run reports what WOULD change and writes nothing.
//
// Usage: pnpm --filter @newsletter/api migrate:agentloop [--dry-run] [--reset-password]
import { pathToFileURL } from "node:url";
import { eq } from "drizzle-orm";
import {
  socialCredentials,
  socialTokens,
  tenants,
  userSettings,
  users,
} from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import type { EncryptedBlob } from "@newsletter/shared/services/credential-cipher";
import { getCredentialCipher } from "@newsletter/shared/services/credential-cipher";
import { TENANT_ZERO_ID } from "@newsletter/shared/constants";
import { hashPassword } from "../src/lib/password.js";
import { createUsersRepo } from "../src/repositories/users.js";
import { TENANT_ZERO_BRANDING_DEFAULTS } from "../src/routes/tenant-config.js";
import { seedSuperAdmins, parseSuperAdminEmails } from "./seed-super-admins.js";

export interface MigrateAgentloopOptions {
  adminEmail: string;
  adminPassword: string;
  superAdminEmails?: string[];
  superAdminPassword?: string;
  resetPassword?: boolean;
  dryRun?: boolean;
  /** Environment the credential cipher derives its KEK from (EC10). */
  env?: NodeJS.ProcessEnv;
}

export interface MigrateAgentloopReport {
  lines: string[];
  failures: string[];
}

function isEncryptedBlob(value: unknown): value is EncryptedBlob {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as EncryptedBlob).ct === "string" &&
    typeof (value as EncryptedBlob).iv === "string" &&
    typeof (value as EncryptedBlob).tag === "string"
  );
}

async function checkCipher(
  db: AppDb,
  env: NodeJS.ProcessEnv,
  report: MigrateAgentloopReport,
): Promise<void> {
  let cipher;
  try {
    cipher = getCredentialCipher(env);
    const probe = cipher.encrypt("agentloop-cipher-probe");
    if (cipher.decrypt(probe) !== "agentloop-cipher-probe") {
      report.failures.push("cipher probe round-trip produced a different value");
      return;
    }
  } catch (err) {
    report.failures.push(`cipher probe failed: ${String(err)}`);
    return;
  }
  report.lines.push("cipher: probe round-trip OK");

  const samples: { source: string; blob: EncryptedBlob }[] = [];

  const [cred] = await db
    .select({ fields: socialCredentials.encryptedFields })
    .from(socialCredentials)
    .where(eq(socialCredentials.tenantId, TENANT_ZERO_ID))
    .limit(1);
  if (cred) {
    const blob = Object.values(cred.fields).find(isEncryptedBlob);
    if (blob) samples.push({ source: "social_credentials", blob });
  }

  const [token] = await db
    .select({ fields: socialTokens.encryptedFields })
    .from(socialTokens)
    .where(eq(socialTokens.tenantId, TENANT_ZERO_ID))
    .limit(1);
  if (token) {
    const blob = Object.values(token.fields).find(isEncryptedBlob);
    if (blob) samples.push({ source: "social_tokens", blob });
  }

  const [settings] = await db
    .select({ slack: userSettings.slackWebhookEncrypted })
    .from(userSettings)
    .where(eq(userSettings.tenantId, TENANT_ZERO_ID))
    .limit(1);
  if (settings?.slack && isEncryptedBlob(settings.slack)) {
    samples.push({ source: "user_settings.slack_webhook_encrypted", blob: settings.slack });
  }

  if (samples.length === 0) {
    report.lines.push("cipher: no encrypted tenant-0 rows to verify (skipped)");
    return;
  }
  for (const sample of samples) {
    try {
      cipher.decrypt(sample.blob);
      report.lines.push(`cipher: decrypted existing ${sample.source} blob OK`);
    } catch {
      report.failures.push(
        `cipher: cannot decrypt existing ${sample.source} blob — SESSION_SECRET ` +
          "does not match the KEK these credentials were encrypted with (EC10). " +
          "Restore the original SESSION_SECRET; it must NOT rotate across the migration.",
      );
    }
  }
}

async function ensureTenantAdmin(
  db: AppDb,
  opts: MigrateAgentloopOptions,
  report: MigrateAgentloopReport,
): Promise<void> {
  const email = opts.adminEmail.toLowerCase();
  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.tenantId, TENANT_ZERO_ID))
    .limit(1);

  if (existing) {
    if (existing.email !== email) {
      report.lines.push(
        `tenant-admin: tenant 0 already owned by ${existing.email} — ` +
          `AGENTLOOP_ADMIN_EMAIL (${email}) ignored, skipping`,
      );
      return;
    }
    if (!opts.resetPassword) {
      report.lines.push(`tenant-admin: ${email} already exists, skipping`);
      return;
    }
    if (opts.dryRun) {
      report.lines.push(`tenant-admin: WOULD reset password for ${email} (dry-run)`);
      return;
    }
    await db
      .update(users)
      .set({ passwordHash: await hashPassword(opts.adminPassword), updatedAt: new Date() })
      .where(eq(users.id, existing.id));
    report.lines.push(`tenant-admin: password reset for ${email}`);
    return;
  }

  const usersRepo = createUsersRepo(db);
  const emailHolder = await usersRepo.findByEmail(email);
  if (emailHolder) {
    report.failures.push(
      `tenant-admin: ${email} already belongs to another account (role ${emailHolder.role}); ` +
        "pick a different AGENTLOOP_ADMIN_EMAIL",
    );
    return;
  }
  if (opts.dryRun) {
    report.lines.push(`tenant-admin: WOULD create ${email} (dry-run)`);
    return;
  }
  await db.insert(users).values({
    tenantId: TENANT_ZERO_ID,
    email,
    name: email.split("@")[0],
    passwordHash: await hashPassword(opts.adminPassword),
    role: "tenant_admin",
  });
  report.lines.push(`tenant-admin: created ${email}`);
}

async function ensureSuperAdmins(
  db: AppDb,
  opts: MigrateAgentloopOptions,
  report: MigrateAgentloopReport,
): Promise<void> {
  const emails = opts.superAdminEmails ?? [];
  if (emails.length === 0) {
    report.lines.push("super-admins: SUPER_ADMIN_EMAILS not set, skipping");
    return;
  }
  if (!opts.superAdminPassword) {
    report.failures.push("super-admins: SUPER_ADMIN_PASSWORD is required when SUPER_ADMIN_EMAILS is set");
    return;
  }
  if (opts.dryRun) {
    const usersRepo = createUsersRepo(db);
    for (const email of emails) {
      const existing = await usersRepo.findByEmail(email);
      report.lines.push(
        existing
          ? `super-admins: ${email} already exists, would skip`
          : `super-admins: WOULD create ${email} (dry-run)`,
      );
    }
    return;
  }
  const result = await seedSuperAdmins(db, emails, opts.superAdminPassword);
  for (const email of result.created) report.lines.push(`super-admins: created ${email}`);
  for (const email of result.existing) report.lines.push(`super-admins: ${email} already exists, skipping`);
}

async function ensureBranding(
  db: AppDb,
  opts: MigrateAgentloopOptions,
  report: MigrateAgentloopReport,
): Promise<void> {
  const [tenant] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.id, TENANT_ZERO_ID))
    .limit(1);
  if (!tenant) return;

  const patch: Partial<typeof tenants.$inferInsert> = {};
  if (tenant.headline === null) patch.headline = TENANT_ZERO_BRANDING_DEFAULTS.headline;
  if (tenant.topicStrip === null) patch.topicStrip = TENANT_ZERO_BRANDING_DEFAULTS.topicStrip;
  if (tenant.subtagline === null) patch.subtagline = TENANT_ZERO_BRANDING_DEFAULTS.subtagline;
  if (!tenant.canonEnabled) patch.canonEnabled = true;

  const fields = Object.keys(patch);
  if (fields.length === 0) {
    report.lines.push("branding: all fields already set, skipping");
    return;
  }
  if (opts.dryRun) {
    report.lines.push(`branding: WOULD set ${fields.join(", ")} (dry-run)`);
    return;
  }
  await db
    .update(tenants)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(tenants.id, TENANT_ZERO_ID));
  report.lines.push(`branding: set ${fields.join(", ")}`);
}

export async function runMigrateAgentloop(
  db: AppDb,
  opts: MigrateAgentloopOptions,
): Promise<MigrateAgentloopReport> {
  const report: MigrateAgentloopReport = { lines: [], failures: [] };
  const env = opts.env ?? process.env;

  const [tenantZero] = await db
    .select({ id: tenants.id, slug: tenants.slug, status: tenants.status })
    .from(tenants)
    .where(eq(tenants.id, TENANT_ZERO_ID))
    .limit(1);
  if (!tenantZero) {
    report.failures.push(
      "tenant 0 not found — the 0041 backfill only creates it from a legacy singleton user_settings row. " +
        "Run migrations 0040–0042 against the database holding the legacy AGENTLOOP data; " +
        "a fresh/empty deployment has nothing to migrate and does not need this script",
    );
    return report;
  }
  report.lines.push(`tenant 0: ${tenantZero.slug} (${tenantZero.status})`);

  await checkCipher(db, env, report);
  if (report.failures.length > 0) return report; // EC10: abort before writing anything

  await ensureTenantAdmin(db, opts, report);
  await ensureSuperAdmins(db, opts, report);
  await ensureBranding(db, opts, report);
  return report;
}

async function main(): Promise<void> {
  const { config } = await import("dotenv");
  config({ path: "../../.env" });
  const { getDb } = await import("@newsletter/shared/db");

  const dryRun = process.argv.includes("--dry-run");
  const resetPassword = process.argv.includes("--reset-password");

  const adminEmail = process.env.AGENTLOOP_ADMIN_EMAIL;
  const adminPassword = process.env.AGENTLOOP_ADMIN_PASSWORD;
  if (!adminEmail || !adminPassword) {
    console.error("AGENTLOOP_ADMIN_EMAIL and AGENTLOOP_ADMIN_PASSWORD are required");
    process.exit(1);
  }

  const report = await runMigrateAgentloop(getDb(), {
    adminEmail,
    adminPassword,
    superAdminEmails: process.env.SUPER_ADMIN_EMAILS
      ? parseSuperAdminEmails(process.env.SUPER_ADMIN_EMAILS)
      : [],
    superAdminPassword: process.env.SUPER_ADMIN_PASSWORD,
    resetPassword,
    dryRun,
  });

  for (const line of report.lines) console.log(line);
  for (const failure of report.failures) console.error(`FAIL: ${failure}`);
  if (report.failures.length > 0) {
    console.error("migrate-agentloop FAILED");
    process.exit(1);
  }
  console.log(dryRun ? "migrate-agentloop dry-run OK (nothing written)" : "migrate-agentloop OK");
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
