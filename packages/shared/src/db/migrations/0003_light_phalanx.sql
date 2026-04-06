ALTER TABLE "sources" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "raw_items" DROP CONSTRAINT "raw_items_source_id_sources_id_fk";
--> statement-breakpoint
ALTER TABLE "raw_items" DROP COLUMN "source_id";--> statement-breakpoint
DROP TABLE "sources" CASCADE;