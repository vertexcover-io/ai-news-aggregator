CREATE TABLE "social_credentials" (
	"platform" text PRIMARY KEY NOT NULL,
	"encrypted_fields" jsonb NOT NULL,
	"metadata" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
