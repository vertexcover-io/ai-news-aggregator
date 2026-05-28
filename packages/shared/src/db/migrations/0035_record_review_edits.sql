-- 0035_record_review_edits.sql
-- Adds review-edits capture: pre_review_snapshot on run_archives + review_edits event table.
-- The new column is nullable with no default — Postgres treats this as a metadata-only change,
-- safe against populated tables (see learnings/drizzle-not-null-add-column-existing-rows.md).
CREATE TABLE "review_edits" (
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
ALTER TABLE "run_archives" ADD COLUMN "pre_review_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "review_edits" ADD CONSTRAINT "review_edits_run_id_run_archives_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."run_archives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_edits_run_id_idx" ON "review_edits" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "review_edits_edit_type_idx" ON "review_edits" USING btree ("edit_type");
