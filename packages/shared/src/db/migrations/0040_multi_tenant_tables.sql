CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"previous_slug" text,
	"name" text NOT NULL,
	"status" text DEFAULT 'pending_setup' NOT NULL,
	"headline" text,
	"topic_strip" text,
	"subtagline" text,
	"logo" "bytea",
	"logo_content_type" text,
	"logo_version" integer DEFAULT 0 NOT NULL,
	"canon_enabled" boolean DEFAULT false NOT NULL,
	"deliverability_enabled" boolean DEFAULT false NOT NULL,
	"eval_enabled" boolean DEFAULT false NOT NULL,
	"onboarding" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"email" text NOT NULL,
	"name" text,
	"password_hash" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_reset_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "impersonation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"super_admin_user_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"action" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sending_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"resend_domain_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"dns_records" jsonb,
	"failure_reason" text,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sending_domains_tenant_id_unique" UNIQUE("tenant_id")
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
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impersonation_events" ADD CONSTRAINT "impersonation_events_super_admin_user_id_users_id_fk" FOREIGN KEY ("super_admin_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impersonation_events" ADD CONSTRAINT "impersonation_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sending_domains" ADD CONSTRAINT "sending_domains_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_tenant_id_uq" ON "users" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "sources_tenant_id_type_idx" ON "sources" USING btree ("tenant_id","type");--> statement-breakpoint
ALTER TABLE "raw_items" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "run_archives" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "run_logs" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "review_edits" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "email_sends" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "subscribers" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "feedback_events" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "ses_events" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "must_read_entries" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "social_credentials" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "social_tokens" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "notification_email" text;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "slack_webhook_encrypted" jsonb;
