/**
 * P6 e2e: super-admin seeding with reset-link onboarding (REQ-110 super-admin
 * part; complements REQ-006 — super admins are NEVER creatable via signup,
 * only via this operator script).
 *
 * Asserts against the real DB:
 *   - users created from SUPER_ADMIN_EMAILS: role super_admin, NO tenant,
 *     unusable (random) scrypt password hash;
 *   - a single-use reset token is issued per created admin (sha256 hash
 *     persisted via the injected store — Redis `auth:reset:<hash>` in the
 *     CLI), with the reset URL pointing at /reset-password?token=…;
 *   - idempotent: re-running skips existing emails, creates no duplicates
 *     and issues no new tokens.
 */
import { describe, it, expect, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import postgres from "postgres";
import {
  runSeedSuperAdmins,
  RESET_LINK_TTL_SECONDS,
} from "../../src/seed-super-admins.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
config({ path: resolve(REPO_ROOT, ".env") });

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) throw new Error("DATABASE_URL must be set (see .env)");

const STAMP = `p6seed${Date.now().toString(36)}`;
const EMAIL_A = `${STAMP}-a@example.com`;
const EMAIL_B = `${STAMP}-b@example.com`;

const sql = postgres(dbUrl, { max: 1 });

afterAll(async () => {
  await sql`DELETE FROM users WHERE email LIKE ${`${STAMP}-%`}`;
  await sql.end();
});

interface SavedToken {
  tokenHash: string;
  userId: string;
  ttlSeconds: number;
}

describe("seed-super-admins (P6)", () => {
  it("creates super_admin users with no tenant and reset-link onboarding", async () => {
    const saved: SavedToken[] = [];
    const result = await runSeedSuperAdmins(sql, {
      emails: [EMAIL_A, ` ${EMAIL_B} `, ""],
      webBaseUrl: "http://web.test",
      saveResetToken: (tokenHash, userId, ttlSeconds) => {
        saved.push({ tokenHash, userId, ttlSeconds });
        return Promise.resolve();
      },
    });

    expect(result.created.map((c) => c.email).sort()).toEqual(
      [EMAIL_A, EMAIL_B].sort(),
    );
    expect(result.skipped).toEqual([]);

    const rows = await sql<
      { email: string; role: string; tenant_id: string | null; password_hash: string; id: string }[]
    >`SELECT id, email, role, tenant_id, password_hash FROM users WHERE email LIKE ${`${STAMP}-%`} ORDER BY email`;
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.role).toBe("super_admin");
      expect(row.tenant_id).toBeNull();
      // Unusable until reset: a well-formed scrypt hash of a discarded secret.
      expect(row.password_hash).toMatch(/^scrypt\$N=\d+,r=\d+,p=\d+\$/);
    }

    // One reset token per created admin, stored by sha256 hash with the
    // documented TTL, and the URL carries the raw token.
    expect(saved).toHaveLength(2);
    for (const created of result.created) {
      const token = new URL(created.resetUrl).searchParams.get("token");
      expect(created.resetUrl.startsWith("http://web.test/reset-password?token=")).toBe(true);
      expect(token).toBeTruthy();
      const hash = createHash("sha256").update(token ?? "").digest("hex");
      const match = saved.find((s) => s.tokenHash === hash);
      expect(match).toBeDefined();
      expect(match?.ttlSeconds).toBe(RESET_LINK_TTL_SECONDS);
      const userRow = rows.find((r) => r.email === created.email);
      expect(match?.userId).toBe(userRow?.id);
    }
  });

  it("is idempotent: existing emails are skipped, no duplicates, no new tokens", async () => {
    const saved: SavedToken[] = [];
    const result = await runSeedSuperAdmins(sql, {
      emails: [EMAIL_A, EMAIL_B],
      webBaseUrl: "http://web.test",
      saveResetToken: (tokenHash, userId, ttlSeconds) => {
        saved.push({ tokenHash, userId, ttlSeconds });
        return Promise.resolve();
      },
    });

    expect(result.created).toEqual([]);
    expect(result.skipped.sort()).toEqual([EMAIL_A, EMAIL_B].sort());
    expect(saved).toEqual([]);

    const [{ count }] = await sql<{ count: string }[]>`
      SELECT count(*) FROM users WHERE email LIKE ${`${STAMP}-%`}`;
    expect(Number(count)).toBe(2);
  });
});
