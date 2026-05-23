CREATE TABLE "eval_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mode" text NOT NULL,
	"fixture_id" text,
	"date" text,
	"window_size" integer,
	"draft_prompt_hash" text NOT NULL,
	"draft_prompt_snapshot" text NOT NULL,
	"saved_prompt_hash" text,
	"saved_prompt_snapshot" text,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"score_breakdown" jsonb,
	"cost_breakdown" jsonb,
	"error_message" text
);
--> statement-breakpoint
CREATE INDEX "eval_runs_started_at_idx" ON "eval_runs" USING btree ("started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "eval_runs_prompt_hash_idx" ON "eval_runs" USING btree ("draft_prompt_hash");