/**
 * The 13 tenant-owned tables that carry a `tenant_id` column (migration 0040).
 * Single source of truth for the AGENTLOOP backfill + verification gate —
 * keep in sync with `packages/shared/src/db/schema.ts`.
 */
export const TENANT_OWNED_TABLES = [
  "raw_items",
  "run_archives",
  "run_logs",
  "review_edits",
  "email_sends",
  "subscribers",
  "feedback_events",
  "ses_events",
  "eval_runs",
  "must_read_entries",
  "user_settings",
  "social_credentials",
  "social_tokens",
] as const;

export type TenantOwnedTable = (typeof TENANT_OWNED_TABLES)[number];
