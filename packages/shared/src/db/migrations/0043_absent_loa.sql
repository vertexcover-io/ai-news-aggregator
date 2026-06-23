CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "audit_log_tenant_id_idx" ON "audit_log" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "audit_log_actor_user_id_idx" ON "audit_log" USING btree ("actor_user_id");