ALTER TABLE "user_settings" RENAME COLUMN "schedule_time" TO "pipeline_time";
ALTER TABLE "user_settings" ADD COLUMN "email_time" text;
ALTER TABLE "user_settings" ADD COLUMN "linkedin_time" text;
ALTER TABLE "user_settings" ADD COLUMN "twitter_time" text;
UPDATE "user_settings" SET
  "email_time" = to_char(("pipeline_time"::time + interval '30 minutes'), 'HH24:MI'),
  "linkedin_time" = to_char(("pipeline_time"::time + interval '30 minutes'), 'HH24:MI'),
  "twitter_time" = to_char(("pipeline_time"::time + interval '30 minutes'), 'HH24:MI');
ALTER TABLE "user_settings" ALTER COLUMN "email_time" SET NOT NULL;
ALTER TABLE "user_settings" ALTER COLUMN "linkedin_time" SET NOT NULL;
ALTER TABLE "user_settings" ALTER COLUMN "twitter_time" SET NOT NULL;
ALTER TABLE "user_settings" ADD COLUMN "email_enabled" boolean DEFAULT true NOT NULL;
ALTER TABLE "user_settings" ADD COLUMN "linkedin_enabled" boolean DEFAULT true NOT NULL;
ALTER TABLE "user_settings" ADD COLUMN "twitter_post_enabled" boolean DEFAULT true NOT NULL;
ALTER TABLE "user_settings" ADD COLUMN "auto_review" boolean DEFAULT false NOT NULL;
ALTER TABLE "run_archives" ADD COLUMN "email_sent_at" timestamp with time zone;
ALTER TABLE "run_archives" ADD COLUMN "notification_state" jsonb;
