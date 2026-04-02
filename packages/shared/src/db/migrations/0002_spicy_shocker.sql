ALTER TABLE "raw_items" ALTER COLUMN "source_type" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "raw_items" ALTER COLUMN "engagement" SET DEFAULT '{"points":0,"commentCount":0}'::jsonb;--> statement-breakpoint
ALTER TABLE "raw_items" ALTER COLUMN "metadata" SET DEFAULT '{"comments":[]}'::jsonb;--> statement-breakpoint
ALTER TABLE "sources" ALTER COLUMN "type" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."source_type";