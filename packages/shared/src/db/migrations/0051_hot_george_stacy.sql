ALTER TABLE "tenants" ADD COLUMN "custom_domain_status" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "custom_domain_verified_at" timestamp with time zone;