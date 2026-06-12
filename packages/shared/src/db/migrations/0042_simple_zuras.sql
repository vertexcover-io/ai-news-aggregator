ALTER TABLE "tenants" ADD COLUMN "previous_slug" text;--> statement-breakpoint
CREATE INDEX "tenants_previous_slug_idx" ON "tenants" USING btree ("previous_slug");