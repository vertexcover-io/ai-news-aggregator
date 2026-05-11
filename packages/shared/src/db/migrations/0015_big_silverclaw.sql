CREATE TABLE "social_tokens" (
	"platform" text PRIMARY KEY NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"metadata" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "run_archives" ADD COLUMN "linkedin_posted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "run_archives" ADD COLUMN "twitter_posted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "run_archives" ADD COLUMN "social_metadata" jsonb;
