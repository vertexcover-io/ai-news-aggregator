CREATE TABLE "run_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"level" text NOT NULL,
	"stage" text NOT NULL,
	"source" text,
	"event" text NOT NULL,
	"message" text NOT NULL,
	"context" jsonb
);
--> statement-breakpoint
ALTER TABLE "run_archives" ADD COLUMN "run_funnel" jsonb;--> statement-breakpoint
CREATE INDEX "run_logs_run_id_id_idx" ON "run_logs" USING btree ("run_id","id");