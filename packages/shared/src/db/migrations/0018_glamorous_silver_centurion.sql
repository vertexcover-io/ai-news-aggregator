ALTER TABLE "user_settings" ADD COLUMN "hn_enabled" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "reddit_enabled" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "web_enabled" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "twitter_enabled" boolean DEFAULT false;--> statement-breakpoint
UPDATE "user_settings"
SET
  "hn_enabled" = "hn_config" IS NOT NULL,
  "reddit_enabled" = "reddit_config" IS NOT NULL,
  "web_enabled" = "web_config" IS NOT NULL,
  "twitter_enabled" = "twitter_config" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ALTER COLUMN "hn_enabled" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ALTER COLUMN "reddit_enabled" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ALTER COLUMN "web_enabled" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ALTER COLUMN "twitter_enabled" SET NOT NULL;
