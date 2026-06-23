ALTER TABLE "tenants" ADD COLUMN "email_mode" text DEFAULT 'managed' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "smtp_config_enc" jsonb;