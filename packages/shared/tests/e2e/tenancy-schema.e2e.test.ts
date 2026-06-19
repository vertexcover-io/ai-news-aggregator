/**
 * Phase 1+2 (multi-tenant) e2e: applies ALL migrations to a freshly created
 * throwaway database and asserts the tenancy schema landed:
 *   - `tenants` + `users` tables exist with the expected columns
 *   - `tenant_id` exists, is indexed, and is NOT NULL on every tenant-owned
 *     table (0041 enforce — fresh DBs pass the EDGE-012 guard trivially;
 *     populated DBs require the P2 AGENTLOOP backfill first)
 *   - user_settings traded its singleton unique index for unique(tenant_id)
 *   - tenants.slug is unique
 *   - users.email is citext and case-insensitively unique
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");
config({ path: resolve(REPO_ROOT, ".env") });

const migrationsFolder = resolve(HERE, "../../src/db/migrations");

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) throw new Error("DATABASE_URL must be set (see .env) to run schema e2e tests");

const testDbName = `tenancy_schema_test_${randomBytes(4).toString("hex")}`;

const admin = postgres(baseUrl, { max: 1 });
let sql: postgres.Sql;

const TENANT_OWNED_TABLES = [
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

interface ColumnInfo {
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: "YES" | "NO";
}

async function columnsOf(table: string): Promise<Map<string, ColumnInfo>> {
  const rows = await sql<ColumnInfo[]>`
    SELECT column_name, data_type, udt_name, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table}
  `;
  return new Map(rows.map((r) => [r.column_name, r]));
}

beforeAll(async () => {
  await admin.unsafe(`CREATE DATABASE ${testDbName}`);
  const testUrl = new URL(baseUrl);
  testUrl.pathname = `/${testDbName}`;
  sql = postgres(testUrl.toString(), { max: 1, onnotice: () => undefined });
  const db = drizzle(sql);
  await migrate(db, { migrationsFolder });
});

afterAll(async () => {
  await sql.end();
  await admin.unsafe(`DROP DATABASE IF EXISTS ${testDbName} WITH (FORCE)`);
  await admin.end();
});

describe("tenancy schema migration (e2e)", () => {
  it("test_REQ_010_all_tenant_tables_have_tenant_id — uuid tenant_id on every tenant-owned table (NOT NULL since 0041)", async () => {
    for (const table of TENANT_OWNED_TABLES) {
      const cols = await columnsOf(table);
      const tenantId = cols.get("tenant_id");
      expect(tenantId, `${table}.tenant_id missing`).toBeDefined();
      expect(tenantId?.udt_name, `${table}.tenant_id type`).toBe("uuid");
      // 0040 added the column nullable (D-105); 0041 enforces NOT NULL only
      // after the guard verified no NULL rows remain (EDGE-012).
      expect(tenantId?.is_nullable, `${table}.tenant_id must be NOT NULL post-0041`).toBe("NO");
    }
  });

  it("indexes tenant_id on every tenant-owned table", async () => {
    for (const table of TENANT_OWNED_TABLES) {
      const rows = await sql<{ indexdef: string }[]>`
        SELECT indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = ${table}
      `;
      // A standalone (tenant_id) index OR a composite index/PK LEADING on
      // tenant_id both satisfy tenant-scoped lookups (P12 re-keyed
      // social_credentials/social_tokens to a (tenant_id, platform) PK).
      const hasTenantIdx = rows.some((r) => /\(tenant_id[,)]/.test(r.indexdef));
      expect(hasTenantIdx, `${table} missing index on tenant_id`).toBe(true);
    }
  });

  it("creates the tenants table with the expected columns and nullability", async () => {
    const cols = await columnsOf("tenants");
    expect(cols.size).toBeGreaterThan(0);

    const expectNotNull = (name: string, udt: string): void => {
      const c = cols.get(name);
      expect(c, `tenants.${name} missing`).toBeDefined();
      expect(c?.udt_name, `tenants.${name} type`).toBe(udt);
      expect(c?.is_nullable, `tenants.${name} nullability`).toBe("NO");
    };
    const expectNullable = (name: string, udt: string): void => {
      const c = cols.get(name);
      expect(c, `tenants.${name} missing`).toBeDefined();
      expect(c?.udt_name, `tenants.${name} type`).toBe(udt);
      expect(c?.is_nullable, `tenants.${name} nullability`).toBe("YES");
    };

    expectNotNull("id", "uuid");
    expectNotNull("slug", "text");
    expectNotNull("name", "text");
    expectNotNull("status", "text");
    expectNullable("custom_domain", "text");
    expectNullable("headline", "text");
    expectNullable("topic_strip", "text");
    expectNullable("subtagline", "text");
    expectNullable("logo_bytes", "bytea");
    expectNullable("logo_content_type", "text");
    expectNotNull("feature_canon", "bool");
    expectNotNull("feature_deliverability", "bool");
    expectNotNull("feature_eval", "bool");
    expectNullable("onboarding_state", "jsonb");
    expectNotNull("created_at", "timestamptz");
    expectNotNull("updated_at", "timestamptz");
  });

  it("enforces tenants.slug uniqueness", async () => {
    await sql`INSERT INTO tenants (slug, name) VALUES ('acme', 'Acme One')`;
    await expect(
      sql`INSERT INTO tenants (slug, name) VALUES ('acme', 'Acme Two')`,
    ).rejects.toMatchObject({ code: "23505" });
    await sql`DELETE FROM tenants WHERE slug = 'acme'`;
  });

  it("creates the users table with the expected columns (tenant_id nullable for super_admin)", async () => {
    const cols = await columnsOf("users");
    expect(cols.size).toBeGreaterThan(0);

    expect(cols.get("id")?.is_nullable).toBe("NO");
    expect(cols.get("id")?.udt_name).toBe("uuid");
    expect(cols.get("tenant_id")?.udt_name).toBe("uuid");
    expect(cols.get("tenant_id")?.is_nullable, "users.tenant_id nullable (super_admin)").toBe("YES");
    expect(cols.get("email")?.udt_name, "users.email must be citext").toBe("citext");
    expect(cols.get("email")?.is_nullable).toBe("NO");
    expect(cols.get("name")?.is_nullable).toBe("NO");
    expect(cols.get("password_hash")?.udt_name).toBe("text");
    expect(cols.get("password_hash")?.is_nullable).toBe("NO");
    expect(cols.get("role")?.udt_name).toBe("text");
    expect(cols.get("role")?.is_nullable).toBe("NO");
    expect(cols.get("created_at")?.udt_name).toBe("timestamptz");
    expect(cols.get("updated_at")?.udt_name).toBe("timestamptz");
  });

  it("enforces users.email uniqueness case-insensitively (citext)", async () => {
    await sql`
      INSERT INTO users (email, name, password_hash, role)
      VALUES ('Admin@Example.com', 'Admin', 'hash', 'super_admin')
    `;
    await expect(
      sql`
        INSERT INTO users (email, name, password_hash, role)
        VALUES ('admin@example.COM', 'Admin Dupe', 'hash', 'super_admin')
      `,
    ).rejects.toMatchObject({ code: "23505" });
    await sql`DELETE FROM users WHERE email = 'admin@example.com'`;
  });

  it("swaps the user_settings singleton unique index for unique(tenant_id) (0041)", async () => {
    const rows = await sql<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'user_settings'
    `;
    const names = rows.map((r) => r.indexname);
    expect(names).not.toContain("user_settings_singleton_uq");
    expect(names).toContain("user_settings_tenant_id_uq");
  });
});
