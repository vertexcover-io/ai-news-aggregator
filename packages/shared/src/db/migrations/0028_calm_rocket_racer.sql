ALTER TABLE "raw_items" ADD COLUMN "run_id" uuid;--> statement-breakpoint
CREATE INDEX "raw_items_run_id_idx" ON "raw_items" USING btree ("run_id");