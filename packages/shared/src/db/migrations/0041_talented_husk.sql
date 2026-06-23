-- Multi-tenant enforce migration (Phase 2, EDGE-012 / REQ-111 / REQ-127).
-- Applies ONLY after the AGENTLOOP backfill + verification gate passed:
--   packages/scripts/src/migrate-agentloop-tenant.ts  (backfill, sets the
--   tenant-0 column DEFAULT bridge for pre-tenancy writers)
--   packages/scripts/src/verify-agentloop-migration.ts (REQ-115 gate)
-- The guard below refuses to enforce while any NULL tenant_id rows remain
-- (D-105: never a bare NOT NULL without backfill ordering). Fresh/empty
-- databases pass trivially.
DO $$
DECLARE
  t text;
  n bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'raw_items', 'run_archives', 'run_logs', 'review_edits', 'email_sends',
    'subscribers', 'feedback_events', 'ses_events', 'eval_runs',
    'must_read_entries', 'user_settings', 'social_credentials', 'social_tokens'
  ] LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE tenant_id IS NULL', t) INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION 'multi-tenant enforce blocked: % row(s) in % still have NULL tenant_id — run the AGENTLOOP backfill (packages/scripts/src/migrate-agentloop-tenant.ts) and verification gate (verify-agentloop-migration.ts) first', n, t;
    END IF;
  END LOOP;
END $$;--> statement-breakpoint
DROP INDEX "user_settings_singleton_uq";--> statement-breakpoint
DROP INDEX "user_settings_tenant_id_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "user_settings_tenant_id_uq" ON "user_settings" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "raw_items" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "run_archives" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "run_logs" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "review_edits" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "email_sends" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "subscribers" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "feedback_events" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ses_events" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "must_read_entries" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "social_credentials" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "social_tokens" ALTER COLUMN "tenant_id" SET NOT NULL;