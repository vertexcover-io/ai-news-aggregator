/**
 * Phase 12 (multi-tenant) e2e: the credentials-rework migration re-keys
 * `social_credentials`/`social_tokens` from a platform-only PK to a composite
 * `(tenant_id, platform)` PK and splits the two trust tiers (REQ-083,
 * REQ-082, D-105/D-113):
 *
 *   - app-level secrets (LinkedIn client id/secret, Twitter collector cookie)
 *     are MOVED verbatim (ciphertext untouched — D-104: the migration must
 *     never re-encrypt) into the new super-admin-only `app_credentials` table
 *   - tenant-level rows (Twitter OAuth1 posting creds, LinkedIn OAuth tokens)
 *     stay put, now keyed `(tenant_id, platform)`
 *
 * The test replays the real upgrade path: migrate a throwaway DB to the
 * pre-P12 journal head, seed AGENTLOOP-shaped rows (tenant_id already
 * stamped by the P2 backfill), then apply the remaining migrations and
 * assert the data was repointed, the PKs changed, and decryption still
 * round-trips with the same SESSION_SECRET-derived key.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { getCredentialCipher } from "../../src/services/credential-cipher.js";
import type { EncryptedBlob } from "../../src/services/credential-cipher.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
config({ path: resolve(REPO_ROOT, ".env") });

const migrationsFolder = resolve(HERE, "../../src/db/migrations");

/** Last migration idx BEFORE the P12 credentials rework (0044). */
const PRE_P12_LAST_IDX = 44;

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL must be set (see .env) to run schema e2e tests");

const SESSION_SECRET = "p12-creds-rekey-test-secret-32-bytes!!";
const cipher = getCredentialCipher({ SESSION_SECRET } as NodeJS.ProcessEnv);

const testDbName = `creds_rekey_test_${randomBytes(4).toString("hex")}`;

const admin = postgres(baseUrl, { max: 1 });
let sql: postgres.Sql;
let tmpMigrations: string;
let agentloopTenantId: string;

interface JournalEntry {
  idx: number;
  tag: string;
  when: number;
}

function makePreP12MigrationsCopy(): string {
  const dir = mkdtempSync(join(tmpdir(), "pre-p12-migrations-"));
  cpSync(migrationsFolder, dir, { recursive: true });
  const journalPath = join(dir, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: JournalEntry[];
  };
  journal.entries = journal.entries.filter((e) => e.idx <= PRE_P12_LAST_IDX);
  writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

const seeded = {
  linkedinClientId: "agentloop-linkedin-client-id",
  linkedinClientSecret: "agentloop-linkedin-client-secret",
  collectorCookie: "agentloop-rettiwt-cookie",
  twitterApiKey: "agentloop-twitter-api-key",
  tokenAccess: "agentloop-linkedin-access-token",
};

beforeAll(async () => {
  await admin.unsafe(`CREATE DATABASE ${testDbName}`);
  const testUrl = new URL(baseUrl);
  testUrl.pathname = `/${testDbName}`;
  sql = postgres(testUrl.toString(), { max: 1, onnotice: () => undefined });
  const db = drizzle(sql);

  // 1. Migrate to the pre-P12 head (platform-only PKs, no app_credentials).
  tmpMigrations = makePreP12MigrationsCopy();
  await migrate(db, { migrationsFolder: tmpMigrations });

  // 2. Seed AGENTLOOP-shaped rows: P2 already stamped tenant_id.
  const [tenant] = await sql<{ id: string }[]>`
    INSERT INTO tenants (slug, name, status) VALUES ('agentloop-p12', 'AgentLoop', 'active')
    RETURNING id
  `;
  agentloopTenantId = tenant.id;

  const linkedinFields = {
    clientId: cipher.encrypt(seeded.linkedinClientId),
    clientSecret: cipher.encrypt(seeded.linkedinClientSecret),
  };
  const twitterFields = {
    apiKey: cipher.encrypt(seeded.twitterApiKey),
    apiSecret: cipher.encrypt("agentloop-twitter-api-secret"),
    accessToken: cipher.encrypt("agentloop-twitter-access-token"),
    accessTokenSecret: cipher.encrypt("agentloop-twitter-access-token-secret"),
  };
  const collectorFields = { apiKey: cipher.encrypt(seeded.collectorCookie) };
  await sql`
    INSERT INTO social_credentials (platform, encrypted_fields, metadata, updated_by, tenant_id) VALUES
      ('linkedin', ${JSON.stringify(linkedinFields)}::jsonb, ${JSON.stringify({ apiVersion: "202511" })}::jsonb, 'admin', ${agentloopTenantId}),
      ('twitter', ${JSON.stringify(twitterFields)}::jsonb, NULL, 'admin', ${agentloopTenantId}),
      ('twitter_collector', ${JSON.stringify(collectorFields)}::jsonb, NULL, 'admin', ${agentloopTenantId})
  `;
  const tokenFields = {
    accessToken: cipher.encrypt(seeded.tokenAccess),
    refreshToken: cipher.encrypt(""),
  };
  await sql`
    INSERT INTO social_tokens (platform, encrypted_fields, expires_at, metadata, tenant_id)
    VALUES ('linkedin', ${JSON.stringify(tokenFields)}::jsonb, now() + interval '30 days', ${JSON.stringify({ name: "AgentLoop" })}::jsonb, ${agentloopTenantId})
  `;

  // 3. Apply the remaining migrations (the P12 credentials rework).
  await migrate(db, { migrationsFolder });
});

afterAll(async () => {
  await sql.end();
  await admin.unsafe(`DROP DATABASE IF EXISTS ${testDbName} WITH (FORCE)`);
  await admin.end();
  rmSync(tmpMigrations, { recursive: true, force: true });
});

async function primaryKeyColumns(table: string): Promise<string[]> {
  const rows = await sql<{ attname: string }[]>`
    SELECT a.attname
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
    WHERE i.indrelid = ${table}::regclass AND i.indisprimary
    ORDER BY array_position(i.indkey, a.attnum)
  `;
  return rows.map((r) => r.attname);
}

describe("P12 credentials re-key migration (e2e)", () => {
  it("test_REQ_083_creds_keyed_tenant_platform_encrypted — composite PK on both tables, tenant_id NOT NULL", async () => {
    expect(await primaryKeyColumns("social_credentials")).toEqual(["tenant_id", "platform"]);
    expect(await primaryKeyColumns("social_tokens")).toEqual(["tenant_id", "platform"]);

    const cols = await sql<{ table_name: string; is_nullable: string }[]>`
      SELECT table_name, is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'tenant_id'
        AND table_name IN ('social_credentials', 'social_tokens')
    `;
    expect(cols).toHaveLength(2);
    for (const c of cols) expect(c.is_nullable, `${c.table_name}.tenant_id`).toBe("NO");

    // Composite key admits the same platform for a second tenant…
    const [other] = await sql<{ id: string }[]>`
      INSERT INTO tenants (slug, name, status) VALUES ('other-p12', 'Other', 'active') RETURNING id
    `;
    const fields = JSON.stringify({
      accessToken: cipher.encrypt("other-access"),
      refreshToken: cipher.encrypt(""),
    });
    await sql`
      INSERT INTO social_tokens (tenant_id, platform, encrypted_fields, expires_at)
      VALUES (${other.id}, 'linkedin', ${fields}::jsonb, now())
    `;
    // …but rejects a duplicate (tenant_id, platform) pair.
    await expect(
      sql`
        INSERT INTO social_tokens (tenant_id, platform, encrypted_fields, expires_at)
        VALUES (${other.id}, 'linkedin', ${fields}::jsonb, now())
      `,
    ).rejects.toMatchObject({ code: "23505" });

    // Stored values are ciphertext, not plaintext (REQ-083).
    const rows = await sql<{ encrypted_fields: { accessToken: EncryptedBlob } }[]>`
      SELECT encrypted_fields FROM social_tokens
      WHERE tenant_id = ${agentloopTenantId} AND platform = 'linkedin'
    `;
    expect(rows).toHaveLength(1);
    const raw = JSON.stringify(rows[0].encrypted_fields);
    expect(raw).not.toContain(seeded.tokenAccess);
    expect(cipher.decrypt(rows[0].encrypted_fields.accessToken)).toBe(seeded.tokenAccess);
  });

  it("moves app-level secrets into app_credentials verbatim (ciphertext untouched, D-104)", async () => {
    const rows = await sql<
      { key: string; encrypted_fields: Record<string, EncryptedBlob>; metadata: { apiVersion?: string } | null }[]
    >`SELECT key, encrypted_fields, metadata FROM app_credentials ORDER BY key`;
    expect(rows.map((r) => r.key)).toEqual(["linkedin_client", "twitter_collector"]);

    const linkedin = rows[0];
    expect(cipher.decrypt(linkedin.encrypted_fields.clientId)).toBe(seeded.linkedinClientId);
    expect(cipher.decrypt(linkedin.encrypted_fields.clientSecret)).toBe(seeded.linkedinClientSecret);
    expect(linkedin.metadata?.apiVersion).toBe("202511");

    const collector = rows[1];
    expect(cipher.decrypt(collector.encrypted_fields.apiKey)).toBe(seeded.collectorCookie);
  });

  it("removes app-level rows from social_credentials, keeping tenant-level twitter under (tenant_id, platform)", async () => {
    const rows = await sql<{ platform: string; tenant_id: string }[]>`
      SELECT platform, tenant_id FROM social_credentials
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].platform).toBe("twitter");
    expect(rows[0].tenant_id).toBe(agentloopTenantId);

    const fields = await sql<{ encrypted_fields: { apiKey: EncryptedBlob } }[]>`
      SELECT encrypted_fields FROM social_credentials
      WHERE tenant_id = ${agentloopTenantId} AND platform = 'twitter'
    `;
    expect(cipher.decrypt(fields[0].encrypted_fields.apiKey)).toBe(seeded.twitterApiKey);
  });

  it("keeps the AGENTLOOP LinkedIn OAuth token resolvable by (tenant_id, 'linkedin') after the PK change", async () => {
    const rows = await sql<{ encrypted_fields: { accessToken: EncryptedBlob } }[]>`
      SELECT encrypted_fields FROM social_tokens
      WHERE tenant_id = ${agentloopTenantId} AND platform = 'linkedin'
    `;
    expect(rows).toHaveLength(1);
    expect(cipher.decrypt(rows[0].encrypted_fields.accessToken)).toBe(seeded.tokenAccess);
  });
});
