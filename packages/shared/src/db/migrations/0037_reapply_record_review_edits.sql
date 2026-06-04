-- 0037_reapply_record_review_edits.sql
-- Idempotent re-apply of 0035_record_review_edits.
--
-- WHY: 0035 originally shipped with a backdated journal `when` (1748433600000,
-- out of order with its neighbours). drizzle-kit only applies entries whose `when`
-- is greater than the last applied migration's recorded timestamp, so every
-- database that had already migrated past 0034 before 0035 landed SKIPPED it
-- silently — no review_edits table, no run_archives.pre_review_snapshot column,
-- and runtime 42703 errors on the next archive query. Fresh databases were
-- unaffected (everything applies in order from zero), which is why CI never
-- caught it.
--
-- This migration heals any such database on its next normal `db:migrate` and is
-- a no-op everywhere 0035 actually ran. 0035 itself was rewritten to the same
-- idempotent form and its journal `when` corrected; the monotonicity regression
-- test in tests/unit/migrations-journal.test.ts prevents a recurrence.
CREATE TABLE IF NOT EXISTS "review_edits" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"edit_type" text NOT NULL,
	"raw_item_id" integer,
	"field" text,
	"before" jsonb,
	"after" jsonb,
	"position_before" integer,
	"position_after" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "run_archives" ADD COLUMN IF NOT EXISTS "pre_review_snapshot" jsonb;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'review_edits_run_id_run_archives_id_fk'
  ) THEN
    ALTER TABLE "review_edits" ADD CONSTRAINT "review_edits_run_id_run_archives_id_fk"
      FOREIGN KEY ("run_id") REFERENCES "public"."run_archives"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "review_edits_run_id_idx" ON "review_edits" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "review_edits_edit_type_idx" ON "review_edits" USING btree ("edit_type");
