-- Wipe plaintext token rows before adding the NOT NULL encrypted column.
-- Tokens stored here (via scripts/auth-linkedin.ts / auth-twitter.ts) cannot be
-- migrated without the KEK, and the plaintext columns are being dropped anyway.
-- Operators must reconnect via /admin/settings (LinkedIn OAuth) or re-run the
-- auth scripts (Twitter) after this migration.
DELETE FROM "social_tokens";--> statement-breakpoint
ALTER TABLE "social_tokens" ADD COLUMN "encrypted_fields" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "social_tokens" DROP COLUMN "access_token";--> statement-breakpoint
ALTER TABLE "social_tokens" DROP COLUMN "refresh_token";