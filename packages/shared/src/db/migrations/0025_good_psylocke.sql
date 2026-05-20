ALTER TABLE "user_settings" ADD COLUMN "web_search_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "web_search_config" jsonb;