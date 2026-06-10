ALTER TABLE "tenants" ADD COLUMN "notify_email" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "slack_webhook" jsonb;