ALTER TABLE "run_archives" ADD COLUMN "started_at" timestamp;--> statement-breakpoint
ALTER TABLE "run_archives" ADD COLUMN "source_types" jsonb;