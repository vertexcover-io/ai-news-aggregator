ALTER TABLE "raw_items" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "run_archives" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "run_logs" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "review_edits" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "email_sends" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "subscribers" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "feedback_events" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ses_events" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "must_read_entries" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "social_credentials" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "social_tokens" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "raw_items" ADD CONSTRAINT "raw_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_archives" ADD CONSTRAINT "run_archives_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_logs" ADD CONSTRAINT "run_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_edits" ADD CONSTRAINT "review_edits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_sends" ADD CONSTRAINT "email_sends_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscribers" ADD CONSTRAINT "subscribers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_events" ADD CONSTRAINT "feedback_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ses_events" ADD CONSTRAINT "ses_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "must_read_entries" ADD CONSTRAINT "must_read_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_credentials" ADD CONSTRAINT "social_credentials_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_tokens" ADD CONSTRAINT "social_tokens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
DROP INDEX "user_settings_singleton_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "user_settings_tenant_uq" ON "user_settings" USING btree ("tenant_id");--> statement-breakpoint
DROP INDEX "subscribers_email_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "subscribers_tenant_email_uq" ON "subscribers" USING btree ("tenant_id","email");--> statement-breakpoint
ALTER TABLE "raw_items" DROP CONSTRAINT "raw_items_source_type_external_id_unique";--> statement-breakpoint
ALTER TABLE "raw_items" ADD CONSTRAINT "raw_items_tenant_source_type_external_id_unique" UNIQUE("tenant_id","source_type","external_id");--> statement-breakpoint
ALTER TABLE "must_read_entries" DROP CONSTRAINT "must_read_entries_url_unique";--> statement-breakpoint
ALTER TABLE "must_read_entries" ADD CONSTRAINT "must_read_entries_tenant_url_unique" UNIQUE("tenant_id","url");--> statement-breakpoint
ALTER TABLE "social_tokens" DROP CONSTRAINT "social_tokens_pkey";--> statement-breakpoint
ALTER TABLE "social_tokens" ADD CONSTRAINT "social_tokens_tenant_id_platform_pk" PRIMARY KEY("tenant_id","platform");--> statement-breakpoint
ALTER TABLE "social_credentials" DROP CONSTRAINT "social_credentials_pkey";--> statement-breakpoint
ALTER TABLE "social_credentials" ADD CONSTRAINT "social_credentials_tenant_id_platform_pk" PRIMARY KEY("tenant_id","platform");--> statement-breakpoint
CREATE INDEX "raw_items_tenant_id_idx" ON "raw_items" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "run_archives_tenant_id_idx" ON "run_archives" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "run_logs_tenant_id_idx" ON "run_logs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "email_sends_tenant_id_idx" ON "email_sends" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "subscribers_tenant_id_idx" ON "subscribers" USING btree ("tenant_id");
