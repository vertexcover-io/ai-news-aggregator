ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "notify_email" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "slack_webhook" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "notify_review_ready" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "notify_errors" boolean DEFAULT true NOT NULL;