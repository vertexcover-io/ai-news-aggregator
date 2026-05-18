ALTER TABLE "user_settings" ADD COLUMN "posthog_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "posthog_project_token" text;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "posthog_host" text;