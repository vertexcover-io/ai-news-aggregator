CREATE TABLE "user_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"singleton" boolean DEFAULT true NOT NULL,
	"profile_name" text,
	"top_n" integer NOT NULL,
	"half_life_hours" integer,
	"hn_config" jsonb,
	"reddit_config" jsonb,
	"web_config" jsonb,
	"schedule_time" text NOT NULL,
	"schedule_timezone" text NOT NULL,
	"schedule_enabled" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "run_archives" ADD COLUMN "reviewed" boolean DEFAULT false;--> statement-breakpoint
UPDATE "run_archives" SET "reviewed" = true WHERE "reviewed" = false;--> statement-breakpoint
ALTER TABLE "run_archives" ALTER COLUMN "reviewed" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "run_archives" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "user_settings_singleton_uq" ON "user_settings" USING btree ("singleton");
