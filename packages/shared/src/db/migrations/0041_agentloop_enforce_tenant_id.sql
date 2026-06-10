-- Phase 2 follow-up: Enforce tenant_id after backfill
-- Runs AFTER migrate-agentloop-tenant.ts has backfilled all NULL tenant_id values.
-- This migration:
-- 1. Drops the singleton constraint on user_settings
-- 2. Replaces it with a unique(tenant_id) constraint
-- 3. Sets tenant_id NOT NULL on all tenant-owned tables
--
-- PRECONDITION: No rows with NULL tenant_id remain. The migration script
-- verifies this before this migration should be applied.

-- Step 1: Drop singleton constraint on user_settings, add per-tenant uniqueness
DROP INDEX IF EXISTS "user_settings_singleton_uq";
CREATE UNIQUE INDEX IF NOT EXISTS "user_settings_tenant_id_uq" ON "user_settings" ("tenant_id");

-- Step 2: Set tenant_id NOT NULL on all tenant-owned tables.
-- These run in a single ALTER TABLE per table to minimize locking.
-- Using explicit ALTER COLUMN SET NOT NULL — safe because pre-condition
-- guarantees no NULL values exist.

ALTER TABLE "raw_items" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "run_archives" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "run_logs" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "review_edits" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "email_sends" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "subscribers" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "feedback_events" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "ses_events" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "eval_runs" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "must_read_entries" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "user_settings" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "social_credentials" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "social_tokens" ALTER COLUMN "tenant_id" SET NOT NULL;
