ALTER TABLE "tenants" ADD COLUMN "sending_domain_name" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "sending_domain_id" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "sending_domain_status" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "sending_domain_records" jsonb;