CREATE TABLE "error_incidents" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"fingerprint" text NOT NULL,
	"category" text NOT NULL,
	"fixability" text NOT NULL,
	"source_package" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"occurrence_count" integer DEFAULT 1 NOT NULL,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"github_ref" text,
	"posthog_issue_url" text,
	"context" jsonb,
	"tenant_id" uuid
);
--> statement-breakpoint
CREATE UNIQUE INDEX "error_incidents_fingerprint_uq" ON "error_incidents" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "error_incidents_status_idx" ON "error_incidents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "error_incidents_tenant_id_idx" ON "error_incidents" USING btree ("tenant_id");