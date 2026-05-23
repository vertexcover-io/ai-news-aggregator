CREATE TABLE "must_read_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"author" text,
	"year" integer,
	"annotation" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "must_read_entries_url_unique" UNIQUE("url")
);
--> statement-breakpoint
CREATE INDEX "must_read_entries_added_at_idx" ON "must_read_entries" USING btree ("added_at" desc);