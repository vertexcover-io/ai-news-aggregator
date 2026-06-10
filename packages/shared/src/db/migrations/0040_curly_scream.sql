CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'pending_setup' NOT NULL,
	"custom_domain" text,
	"headline" text,
	"topic_strip" text,
	"subtagline" text,
	"logo_bytes" "bytea",
	"logo_content_type" text,
	"feature_canon" boolean DEFAULT false NOT NULL,
	"feature_deliverability" boolean DEFAULT false NOT NULL,
	"feature_eval" boolean DEFAULT false NOT NULL,
	"onboarding_state" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"email" "citext" NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'tenant_admin' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
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