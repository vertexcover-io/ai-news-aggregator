CREATE TABLE "raw_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" integer,
	"source_type" "source_type" NOT NULL,
	"external_id" text NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"source_url" text,
	"author" text,
	"content" text,
	"published_at" timestamp,
	"collected_at" timestamp DEFAULT now() NOT NULL,
	"engagement" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "raw_items_source_type_external_id_unique" UNIQUE("source_type","external_id")
);
--> statement-breakpoint
ALTER TABLE "raw_items" ADD CONSTRAINT "raw_items_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;