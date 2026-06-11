/**
 * Super-admin seeding (P6 — REQ-110 super-admin part, complements REQ-006).
 *
 * Super admins are NEVER creatable via the public signup path — this operator
 * CLI is the only way to mint them. For each address in SUPER_ADMIN_EMAILS it
 * creates a platform-level `super_admin` user (NO tenant) whose password is a
 * discarded random secret: the account is unusable until the printed
 * single-use reset link is redeemed (reset-link onboarding via the normal
 * POST /api/auth/reset flow).
 *
 * The reset token is stored in Redis under `auth:reset:<sha256(token)>` —
 * the exact key format the API's resetTokenStore consumes
 * (packages/api/src/index.ts). Idempotent: existing emails are skipped.
 *
 * Usage:
 *   pnpm --filter @newsletter/scripts seed:super-admins
 * Env: DATABASE_URL, REDIS_URL, SUPER_ADMIN_EMAILS (comma-separated),
 *      NEWSLETTER_BASE_URL (reset-link origin; defaults to PUBLIC_BASE_URL).
 */
import { createHash, randomBytes, scryptSync } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import postgres from "postgres";

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const;

/**
 * Onboarding links live longer than the interactive 30-minute forgot-password
 * TTL — the operator sends them out-of-band and the admin may redeem later.
 */
export const RESET_LINK_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Same stored format as the API's scrypt hasher (services/password.ts). */
function hashDiscardedPassword(): string {
  const salt = randomBytes(16);
  const hash = scryptSync(randomBytes(32).toString("base64url"), salt, 64, SCRYPT_PARAMS);
  const params = `N=${SCRYPT_PARAMS.N},r=${SCRYPT_PARAMS.r},p=${SCRYPT_PARAMS.p}`;
  return `scrypt$${params}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export interface SeedSuperAdminsDeps {
  /** Raw SUPER_ADMIN_EMAILS entries; blanks ignored, whitespace trimmed. */
  emails: string[];
  /** Web origin the reset link points at (…/reset-password?token=). */
  webBaseUrl: string;
  /** Persists sha256(token) → userId with a TTL (Redis in the CLI). */
  saveResetToken: (
    tokenHash: string,
    userId: string,
    ttlSeconds: number,
  ) => Promise<void>;
}

export interface SeedSuperAdminsResult {
  created: { email: string; resetUrl: string }[];
  /** Emails that already had a user row (any role) — left untouched. */
  skipped: string[];
}

export async function runSeedSuperAdmins(
  sql: postgres.Sql,
  deps: SeedSuperAdminsDeps,
): Promise<SeedSuperAdminsResult> {
  const created: SeedSuperAdminsResult["created"] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();

  for (const raw of deps.emails) {
    const email = raw.trim();
    if (!email || seen.has(email.toLowerCase())) continue;
    seen.add(email.toLowerCase());

    const name = email.split("@")[0] || email;
    // users.email is citext + unique — ON CONFLICT DO NOTHING makes the
    // insert race-safe; an empty RETURNING set means the email existed.
    const rows = await sql<{ id: string }[]>`
      INSERT INTO users (tenant_id, email, name, password_hash, role)
      VALUES (NULL, ${email}, ${name}, ${hashDiscardedPassword()}, 'super_admin')
      ON CONFLICT (email) DO NOTHING
      RETURNING id`;
    if (rows.length === 0) {
      skipped.push(email);
      continue;
    }
    const row = rows[0];

    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    await deps.saveResetToken(tokenHash, row.id, RESET_LINK_TTL_SECONDS);
    created.push({
      email,
      resetUrl: `${deps.webBaseUrl}/reset-password?token=${token}`,
    });
  }

  return { created, skipped };
}

async function main(): Promise<void> {
  const { config } = await import("dotenv");
  config({ path: resolve(process.cwd(), "../../.env") });

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error("REDIS_URL is required");
  const emails = (process.env.SUPER_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter((e) => e.length > 0);
  if (emails.length === 0) {
    throw new Error("SUPER_ADMIN_EMAILS is required (comma-separated)");
  }
  const webBaseUrl = (
    process.env.NEWSLETTER_BASE_URL ??
    process.env.PUBLIC_BASE_URL ??
    "http://localhost:5173"
  ).replace(/\/$/, "");

  const sql = postgres(databaseUrl, { max: 1 });
  const { default: IORedis } = await import("ioredis");
  const redis = new IORedis(redisUrl);
  try {
    const result = await runSeedSuperAdmins(sql, {
      emails,
      webBaseUrl,
      saveResetToken: async (tokenHash, userId, ttlSeconds) => {
        // MUST match the API's resetTokenStore key (packages/api/src/index.ts).
        await redis.set(`auth:reset:${tokenHash}`, userId, "EX", ttlSeconds);
      },
    });
    for (const c of result.created) {
      console.log(`super_admin ${c.email} created — onboarding reset link (shown once, valid ${String(RESET_LINK_TTL_SECONDS / 86400)} days):`);
      console.log(`  ${c.resetUrl}`);
    }
    for (const s of result.skipped) {
      console.log(`super_admin ${s} already exists — skipped`);
    }
  } finally {
    await sql.end();
    redis.disconnect();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
