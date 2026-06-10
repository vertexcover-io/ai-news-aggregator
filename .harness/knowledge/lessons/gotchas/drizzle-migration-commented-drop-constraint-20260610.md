---
title: "Hand-edited Drizzle migration files with commented-out DROP CONSTRAINT cause cascading migration failures"
date: 2026-06-10
category: gotchas
tags: [drizzle, migrations, postgres, db, schema, pk, drizzle-kit]
component: shared
severity: critical
status: documented
applies_to: ["packages/shared/src/db/migrations/**", "packages/shared/src/db/schema.ts"]
stage: [code, review]
evidence_count: 1
last_validated: 2026-06-10
source: verify-break@multi-tenant
related: []
---

# Hand-edited Drizzle migration with commented-out DROP CONSTRAINT causes cascading failures

## Problem

Drizzle Kit generated migration `0043_dazzling_victor_mancha.sql` with commented-out `DROP CONSTRAINT` statements (PK name detection is not automated by drizzle-kit). The file had SQL like:

```sql
-- ALTER TABLE "social_credentials" DROP CONSTRAINT "<constraint_name>";
ALTER TABLE "social_credentials" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "social_credentials" ADD CONSTRAINT "social_credentials_tenant_id_platform_pk" PRIMARY KEY("tenant_id","platform");
```

The DROP was never uncommented, so the `ADD CONSTRAINT ... PRIMARY KEY` failed with `PostgresError: multiple primary keys for table "social_credentials" are not allowed`. This caused the entire migration to fail, blocking all subsequent migrations (0044 and 0045 -- domain columns and notification columns). The result: the tenants table was missing `domain_id`, `domain_name`, `domain_status`, `domain_records`, `notify_email`, `slack_webhook`, and `old_slug` columns, causing API 500 errors on `/api/home`.

## Insight

**Drizzle Kit generates migration files with commented-out constraint handlers when it cannot detect PK names. These MUST be uncommented with the correct constraint name before the migration is applied.** A migration file that has never been applied cleanly to a real DB is not truly "done" -- it's a scaffold that requires completion.

The root cause chain was:
1. drizzle-kit generated the migration with placeholders for PK drop
2. The migration was committed without uncommenting and filling in the real constraint name
3. `drizzle-kit migrate` ran the SQL as-is, hit the PK conflict, and failed
4. All downstream migrations were skipped in the same transaction/batch
5. The API code queried columns that didn't exist in the DB, causing 500 errors

## Solution

For every generated migration that contains commented-out `DROP CONSTRAINT` or similar placeholders:

1. Run the migration against a test DB (or examine the target DB) to get the actual constraint name:
   ```sql
   SELECT constraint_name FROM information_schema.table_constraints
   WHERE table_schema = 'public' AND table_name = 'social_credentials'
   AND constraint_type = 'PRIMARY KEY';
   ```
2. Uncomment the DROP line and replace `"<constraint_name>"` with the real name:
   ```sql
   ALTER TABLE "social_credentials" DROP CONSTRAINT "social_credentials_pkey";
   ```
3. Verify the full migration applies cleanly: `drizzle-kit migrate`
4. Check that all downstream migrations also apply

For this specific case, the fix was:
```sql
ALTER TABLE social_credentials DROP CONSTRAINT social_credentials_pkey;
ALTER TABLE social_credentials ADD CONSTRAINT social_credentials_tenant_id_platform_pk PRIMARY KEY(tenant_id, platform);
ALTER TABLE social_tokens DROP CONSTRAINT social_tokens_pkey;
ALTER TABLE social_tokens ADD CONSTRAINT social_tokens_tenant_id_platform_pk PRIMARY KEY(tenant_id, platform);
```

## Prevention

- After `drizzle-kit generate`, grep every new migration file for `-- ALTER.*DROP CONSTRAINT` and `<constraint_name>`. Every such pattern MUST be resolved before the migration is committed.
- Run `drizzle-kit migrate` against an actual database (not just `generate`) before committing migrations. A migration that only passed `generate` but not `migrate` is incomplete.
- In the quality gate, verify that the DB schema matches the Drizzle schema definitions by comparing column lists from `information_schema.columns` against the Drizzle table definitions.
