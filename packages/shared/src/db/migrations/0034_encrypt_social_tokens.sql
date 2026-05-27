ALTER TABLE "social_tokens" ADD COLUMN "encrypted_fields" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "social_tokens" DROP COLUMN "access_token";--> statement-breakpoint
ALTER TABLE "social_tokens" DROP COLUMN "refresh_token";