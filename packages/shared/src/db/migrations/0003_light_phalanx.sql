ALTER TABLE "sources" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "sources" CASCADE;--> statement-breakpoint
ALTER TABLE "raw_items" DROP COLUMN "source_id";