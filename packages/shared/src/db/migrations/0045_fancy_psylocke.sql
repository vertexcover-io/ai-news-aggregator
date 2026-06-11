-- P12 credentials rework (REQ-082/083/086, NF6):
--   1. New `app_credentials` table for APP-LEVEL shared secrets (LinkedIn
--      OAuth client, Twitter collector cookie) — super-admin only.
--   2. Repoint existing rows: LinkedIn client + Twitter collector move out of
--      `social_credentials` into `app_credentials` VERBATIM (ciphertext is
--      copied, never re-encrypted — D-104).
--   3. Re-key `social_credentials` / `social_tokens` from a platform-only PK
--      to a composite (tenant_id, platform) PK. The P2 AGENTLOOP backfill
--      already stamped tenant_id; the guard below refuses to proceed while
--      any NULL tenant_id rows remain (D-105: never enforce without backfill).
DO $$
DECLARE
  t text;
  n bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY['social_credentials', 'social_tokens'] LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE tenant_id IS NULL', t) INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION 'P12 credentials re-key blocked: % row(s) in % still have NULL tenant_id — run the AGENTLOOP backfill (packages/scripts/src/migrate-agentloop-tenant.ts) first', n, t;
    END IF;
  END LOOP;
END $$;--> statement-breakpoint
CREATE TABLE "app_credentials" (
	"key" text PRIMARY KEY NOT NULL,
	"encrypted_fields" jsonb NOT NULL,
	"metadata" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
-- Move app-level secrets out of social_credentials. Ciphertext copied
-- verbatim (same SESSION_SECRET-derived KEK — D-104). DISTINCT ON keeps the
-- most recently updated row per platform should multiple tenants have one.
INSERT INTO "app_credentials" ("key", "encrypted_fields", "metadata", "updated_at", "updated_by")
SELECT DISTINCT ON (sc."platform")
  CASE sc."platform" WHEN 'linkedin' THEN 'linkedin_client' ELSE 'twitter_collector' END,
  sc."encrypted_fields", sc."metadata", sc."updated_at", sc."updated_by"
FROM "social_credentials" sc
WHERE sc."platform" IN ('linkedin', 'twitter_collector')
ORDER BY sc."platform", sc."updated_at" DESC;--> statement-breakpoint
DELETE FROM "social_credentials" WHERE "platform" IN ('linkedin', 'twitter_collector');--> statement-breakpoint
DROP INDEX IF EXISTS "social_credentials_tenant_id_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "social_tokens_tenant_id_idx";--> statement-breakpoint
-- Composite (tenant_id, platform) PK (REQ-083). The platform-only PK was the
-- column-level default name <table>_pkey (drizzle-kit cannot resolve it —
-- verified against the live database).
ALTER TABLE "social_credentials" DROP CONSTRAINT "social_credentials_pkey";--> statement-breakpoint
ALTER TABLE "social_credentials" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "social_tokens" DROP CONSTRAINT "social_tokens_pkey";--> statement-breakpoint
ALTER TABLE "social_tokens" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "social_credentials" ADD CONSTRAINT "social_credentials_tenant_id_platform_pk" PRIMARY KEY("tenant_id","platform");--> statement-breakpoint
ALTER TABLE "social_tokens" ADD CONSTRAINT "social_tokens_tenant_id_platform_pk" PRIMARY KEY("tenant_id","platform");
