import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "src", "db", "migrations");

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
];

describe("multi-tenant migration ordering (EC12)", () => {
  const addNullable = readFileSync(join(MIGRATIONS_DIR, "0040_multi_tenant_tables.sql"), "utf8");
  const backfill = readFileSync(join(MIGRATIONS_DIR, "0041_backfill_tenant_zero.sql"), "utf8");
  const enforce = readFileSync(join(MIGRATIONS_DIR, "0042_enforce_tenant_id.sql"), "utf8");

  it("0040 adds tenant_id as nullable (no inline NOT NULL) on every tenant-owned table", () => {
    for (const table of TENANT_OWNED_TABLES) {
      expect(addNullable).toContain(`ALTER TABLE "${table}" ADD COLUMN "tenant_id" uuid;`);
    }
    expect(addNullable).not.toContain(`ADD COLUMN "tenant_id" uuid NOT NULL`);
  });

  it("0041 backfill is guarded for idempotency and empty databases", () => {
    expect(backfill).toContain("ON CONFLICT (\"id\") DO NOTHING");
    expect(backfill).toContain("WHERE EXISTS (SELECT 1 FROM \"user_settings\" WHERE \"singleton\" = true)");
    expect(backfill).toMatch(/NOT EXISTS \(SELECT 1 FROM "sources"/);
    for (const table of TENANT_OWNED_TABLES) {
      expect(backfill).toContain(`UPDATE "${table}" SET "tenant_id" =`);
    }
  });

  it("0042 enforces NOT NULL + FK on every tenant-owned table", () => {
    for (const table of TENANT_OWNED_TABLES) {
      expect(enforce).toContain(`ALTER TABLE "${table}" ALTER COLUMN "tenant_id" SET NOT NULL;`);
      expect(enforce).toContain(
        `ALTER TABLE "${table}" ADD CONSTRAINT "${table}_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id")`,
      );
    }
  });

  it("0042 reshapes the singleton/global uniques to tenant-scoped ones", () => {
    expect(enforce).toContain('DROP INDEX "user_settings_singleton_uq"');
    expect(enforce).toContain('CREATE UNIQUE INDEX "user_settings_tenant_uq"');
    expect(enforce).toContain('DROP INDEX "subscribers_email_uq"');
    expect(enforce).toContain('CREATE UNIQUE INDEX "subscribers_tenant_email_uq"');
    expect(enforce).toContain('PRIMARY KEY("tenant_id","platform")');
  });
});
