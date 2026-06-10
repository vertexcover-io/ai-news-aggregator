ALTER TABLE "tenants" ADD COLUMN "domain_id" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "domain_name" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "domain_status" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "domain_records" jsonb;