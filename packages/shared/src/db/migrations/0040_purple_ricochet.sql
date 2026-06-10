CREATE TABLE "impersonation_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"acting_user_id" uuid NOT NULL,
	"target_tenant_id" uuid NOT NULL,
	"action" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onboarding_progress" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"furthest_step" integer DEFAULT 0 NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sending_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"provider_domain_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"dns_records" jsonb,
	"failure_reasons" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" text NOT NULL,
	"config" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"health" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"previous_slug" text,
	"status" text DEFAULT 'pending_setup' NOT NULL,
	"name" text,
	"headline" text,
	"topic_strip" text,
	"subtagline" text,
	"logo_bytes" text,
	"logo_content_type" text,
	"logo_version" integer DEFAULT 0 NOT NULL,
	"custom_domain" text,
	"canon_enabled" boolean DEFAULT false NOT NULL,
	"deliverability_enabled" boolean DEFAULT false NOT NULL,
	"eval_enabled" boolean DEFAULT false NOT NULL,
	"built_page_enabled" boolean DEFAULT false NOT NULL,
	"notification_email" text,
	"slack_webhook" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"email" text NOT NULL,
	"name" text,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'tenant_admin' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_sends" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "feedback_events" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "must_read_entries" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "raw_items" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "review_edits" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "run_archives" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "run_logs" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "ses_events" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "social_credentials" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "social_tokens" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "subscribers" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
CREATE INDEX "impersonation_audit_target_idx" ON "impersonation_audit" USING btree ("target_tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "password_reset_tokens_hash_uq" ON "password_reset_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "password_reset_tokens_user_idx" ON "password_reset_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sending_domains_tenant_id_uq" ON "sending_domains" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "sources_tenant_id_idx" ON "sources" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_slug_uq" ON "tenants" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "tenants_custom_domain_idx" ON "tenants" USING btree ("custom_domain");--> statement-breakpoint
CREATE INDEX "tenants_previous_slug_idx" ON "tenants" USING btree ("previous_slug");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_tenant_id_idx" ON "users" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "email_sends_tenant_id_idx" ON "email_sends" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "eval_runs_tenant_id_idx" ON "eval_runs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "feedback_events_tenant_id_idx" ON "feedback_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "must_read_entries_tenant_id_idx" ON "must_read_entries" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "raw_items_tenant_id_idx" ON "raw_items" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "review_edits_tenant_id_idx" ON "review_edits" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "run_archives_tenant_id_idx" ON "run_archives" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "run_logs_tenant_id_idx" ON "run_logs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ses_events_tenant_id_idx" ON "ses_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "social_credentials_tenant_id_idx" ON "social_credentials" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "social_tokens_tenant_id_idx" ON "social_tokens" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "subscribers_tenant_id_idx" ON "subscribers" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "user_settings_tenant_id_idx" ON "user_settings" USING btree ("tenant_id");