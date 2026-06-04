-- 0035_record_review_edits.sql
-- Adds review-edits capture: pre_review_snapshot on run_archives + review_edits event table.
-- The new column is nullable with no default — Postgres treats this as a metadata-only change,
-- safe against populated tables (see learnings/drizzle-not-null-add-column-existing-rows.md).
--
-- NOTE (2026-06-04): rewritten to the idempotent form and the journal `when` corrected.
-- The original entry carried a backdated timestamp, so already-migrated databases skipped
-- this file silently; 0037_reapply_record_review_edits heals them. Idempotency here covers
-- databases whose last applied migration predates the corrected timestamp and which would
-- therefore re-run this file. Semantics are unchanged from the original.
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
