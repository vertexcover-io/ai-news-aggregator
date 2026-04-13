CREATE TABLE "run_archives" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ranked_items" jsonb NOT NULL,
	"top_n" integer NOT NULL,
	"profile_name" text,
	"completed_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
