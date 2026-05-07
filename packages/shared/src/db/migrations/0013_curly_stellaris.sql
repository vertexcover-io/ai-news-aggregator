ALTER TABLE "run_archives" ADD COLUMN "source_telemetry" jsonb;--> statement-breakpoint
ALTER TABLE "run_archives" ADD COLUMN "slack_notified_at" timestamp with time zone;