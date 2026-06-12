-- Backfill tenant 0 (AGENTLOOP). Idempotent and re-runnable; every statement
-- no-ops on a fresh/empty database (no legacy singleton row -> no tenant row
-- -> guarded updates and lifts touch nothing).
INSERT INTO "tenants" ("id", "slug", "name", "status", "canon_enabled")
SELECT '00000000-0000-0000-0000-000000000000', 'agentloop', 'AGENTLOOP', 'active', true
WHERE EXISTS (SELECT 1 FROM "user_settings" WHERE "singleton" = true)
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
UPDATE "raw_items" SET "tenant_id" = '00000000-0000-0000-0000-000000000000' WHERE "tenant_id" IS NULL AND EXISTS (SELECT 1 FROM "tenants" WHERE "id" = '00000000-0000-0000-0000-000000000000');--> statement-breakpoint
UPDATE "run_archives" SET "tenant_id" = '00000000-0000-0000-0000-000000000000' WHERE "tenant_id" IS NULL AND EXISTS (SELECT 1 FROM "tenants" WHERE "id" = '00000000-0000-0000-0000-000000000000');--> statement-breakpoint
UPDATE "run_logs" SET "tenant_id" = '00000000-0000-0000-0000-000000000000' WHERE "tenant_id" IS NULL AND EXISTS (SELECT 1 FROM "tenants" WHERE "id" = '00000000-0000-0000-0000-000000000000');--> statement-breakpoint
UPDATE "review_edits" SET "tenant_id" = '00000000-0000-0000-0000-000000000000' WHERE "tenant_id" IS NULL AND EXISTS (SELECT 1 FROM "tenants" WHERE "id" = '00000000-0000-0000-0000-000000000000');--> statement-breakpoint
UPDATE "email_sends" SET "tenant_id" = '00000000-0000-0000-0000-000000000000' WHERE "tenant_id" IS NULL AND EXISTS (SELECT 1 FROM "tenants" WHERE "id" = '00000000-0000-0000-0000-000000000000');--> statement-breakpoint
UPDATE "subscribers" SET "tenant_id" = '00000000-0000-0000-0000-000000000000' WHERE "tenant_id" IS NULL AND EXISTS (SELECT 1 FROM "tenants" WHERE "id" = '00000000-0000-0000-0000-000000000000');--> statement-breakpoint
UPDATE "feedback_events" SET "tenant_id" = '00000000-0000-0000-0000-000000000000' WHERE "tenant_id" IS NULL AND EXISTS (SELECT 1 FROM "tenants" WHERE "id" = '00000000-0000-0000-0000-000000000000');--> statement-breakpoint
UPDATE "ses_events" SET "tenant_id" = '00000000-0000-0000-0000-000000000000' WHERE "tenant_id" IS NULL AND EXISTS (SELECT 1 FROM "tenants" WHERE "id" = '00000000-0000-0000-0000-000000000000');--> statement-breakpoint
UPDATE "eval_runs" SET "tenant_id" = '00000000-0000-0000-0000-000000000000' WHERE "tenant_id" IS NULL AND EXISTS (SELECT 1 FROM "tenants" WHERE "id" = '00000000-0000-0000-0000-000000000000');--> statement-breakpoint
UPDATE "must_read_entries" SET "tenant_id" = '00000000-0000-0000-0000-000000000000' WHERE "tenant_id" IS NULL AND EXISTS (SELECT 1 FROM "tenants" WHERE "id" = '00000000-0000-0000-0000-000000000000');--> statement-breakpoint
UPDATE "user_settings" SET "tenant_id" = '00000000-0000-0000-0000-000000000000' WHERE "tenant_id" IS NULL AND EXISTS (SELECT 1 FROM "tenants" WHERE "id" = '00000000-0000-0000-0000-000000000000');--> statement-breakpoint
UPDATE "social_credentials" SET "tenant_id" = '00000000-0000-0000-0000-000000000000' WHERE "tenant_id" IS NULL AND EXISTS (SELECT 1 FROM "tenants" WHERE "id" = '00000000-0000-0000-0000-000000000000');--> statement-breakpoint
UPDATE "social_tokens" SET "tenant_id" = '00000000-0000-0000-0000-000000000000' WHERE "tenant_id" IS NULL AND EXISTS (SELECT 1 FROM "tenants" WHERE "id" = '00000000-0000-0000-0000-000000000000');--> statement-breakpoint
INSERT INTO "sources" ("tenant_id", "type", "config", "enabled")
SELECT '00000000-0000-0000-0000-000000000000', 'hn', us."hn_config", us."hn_enabled"
FROM "user_settings" us
WHERE us."singleton" = true AND us."hn_config" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "sources" s WHERE s."tenant_id" = '00000000-0000-0000-0000-000000000000' AND s."type" = 'hn');--> statement-breakpoint
INSERT INTO "sources" ("tenant_id", "type", "config", "enabled")
SELECT '00000000-0000-0000-0000-000000000000', 'reddit',
  jsonb_strip_nulls(jsonb_build_object(
    'subreddit', to_jsonb(sub.value),
    'sort', us."reddit_config"->'sort',
    'limit', us."reddit_config"->'limit',
    'sinceDays', us."reddit_config"->'sinceDays'
  )),
  us."reddit_enabled"
FROM "user_settings" us,
  jsonb_array_elements_text(us."reddit_config"->'subreddits') AS sub(value)
WHERE us."singleton" = true AND us."reddit_config" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "sources" s WHERE s."tenant_id" = '00000000-0000-0000-0000-000000000000' AND s."type" = 'reddit');--> statement-breakpoint
INSERT INTO "sources" ("tenant_id", "type", "config", "enabled")
SELECT '00000000-0000-0000-0000-000000000000', 'web', site.value, us."web_enabled"
FROM "user_settings" us,
  jsonb_array_elements(us."web_config"->'sources') AS site(value)
WHERE us."singleton" = true AND us."web_config" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "sources" s WHERE s."tenant_id" = '00000000-0000-0000-0000-000000000000' AND s."type" = 'web');--> statement-breakpoint
INSERT INTO "sources" ("tenant_id", "type", "config", "enabled")
SELECT '00000000-0000-0000-0000-000000000000', 'twitter', cfg.value, us."twitter_enabled"
FROM "user_settings" us
CROSS JOIN LATERAL (
  SELECT jsonb_build_object('kind', 'list', 'listId', l.value) AS value
  FROM jsonb_array_elements_text(us."twitter_config"->'listIds') AS l(value)
  UNION ALL
  SELECT jsonb_strip_nulls(jsonb_build_object('kind', 'user', 'handle', u.value->>'handle', 'userId', u.value->>'userId')) AS value
  FROM jsonb_array_elements(us."twitter_config"->'users') AS u(value)
) AS cfg
WHERE us."singleton" = true AND us."twitter_config" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "sources" s WHERE s."tenant_id" = '00000000-0000-0000-0000-000000000000' AND s."type" = 'twitter');--> statement-breakpoint
INSERT INTO "sources" ("tenant_id", "type", "config", "enabled")
SELECT '00000000-0000-0000-0000-000000000000', 'web_search', q.value, us."web_search_enabled"
FROM "user_settings" us,
  jsonb_array_elements(us."web_search_config"->'queries') AS q(value)
WHERE us."singleton" = true AND us."web_search_config" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "sources" s WHERE s."tenant_id" = '00000000-0000-0000-0000-000000000000' AND s."type" = 'web_search');
