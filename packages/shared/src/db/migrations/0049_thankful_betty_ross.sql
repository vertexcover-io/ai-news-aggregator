ALTER TABLE "raw_items" DROP CONSTRAINT "raw_items_source_type_external_id_unique";--> statement-breakpoint
DROP INDEX "subscribers_email_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "subscribers_tenant_email_uq" ON "subscribers" USING btree ("tenant_id","email");--> statement-breakpoint
ALTER TABLE "raw_items" ADD CONSTRAINT "raw_items_tenant_source_type_external_id_unique" UNIQUE("tenant_id","source_type","external_id");