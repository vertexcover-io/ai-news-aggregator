-- Drop singleton constraint on user_settings, replace with per-tenant unique,
-- and tighten tenant_id to NOT NULL on all tenant-owned tables.
-- Runs AFTER the AGENTLOOP backfill script (migrate-agentloop-tenant.ts).

-- user_settings: drop singleton unique, add unique(tenant_id)
DROP INDEX IF EXISTS "user_settings_singleton_uq";
CREATE UNIQUE INDEX IF NOT EXISTS "user_settings_tenant_id_uq" ON "user_settings" ("tenant_id");

-- Set tenant_id NOT NULL on all 13 tenant-owned tables
ALTER TABLE "raw_items" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "run_archives" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "run_logs" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "social_tokens" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "social_credentials" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "user_settings" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "must_read_entries" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "subscribers" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "email_sends" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "feedback_events" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "ses_events" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "eval_runs" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "review_edits" ALTER COLUMN "tenant_id" SET NOT NULL;
