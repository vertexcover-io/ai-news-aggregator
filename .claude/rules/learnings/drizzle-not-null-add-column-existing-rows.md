# A generated `ADD COLUMN ... NOT NULL` migration fails on any table that already has rows

When a Drizzle schema change replaces columns on an existing table — e.g. dropping plaintext
`access_token`/`refresh_token` and adding an `encrypted_fields jsonb NOT NULL` — `drizzle-kit generate`
emits a bare `ALTER TABLE ... ADD COLUMN "x" jsonb NOT NULL;` with **no DEFAULT and no data step**.
PostgreSQL rejects that statement the moment the table contains even one row, because every existing
row would need a value for the new NOT NULL column. It passes every local test (empty test DB) and
only explodes at deploy time against a populated production table.

## What bit us

The `admin-linkedin-oauth` feature re-shaped `social_tokens` to store encrypted tokens. Migration
`0034_encrypt_social_tokens.sql` was generated as:

```sql
ALTER TABLE "social_tokens" ADD COLUMN "encrypted_fields" jsonb NOT NULL;
ALTER TABLE "social_tokens" DROP COLUMN "access_token";
ALTER TABLE "social_tokens" DROP COLUMN "refresh_token";
```

Production's `social_tokens` had the LinkedIn row (the dead token that triggered the whole feature).
The `ADD COLUMN NOT NULL` would have aborted the migration on deploy. Caught in code review (C1).

## Rule

After `drizzle-kit generate` produces a migration that **adds a NOT NULL column to an existing table**,
stop and decide which case you're in, then hand-edit the generated SQL accordingly:

1. **The old data must be preserved** → add a `DEFAULT` (or backfill in a prior `UPDATE`/`ADD COLUMN
   nullable → backfill → SET NOT NULL` sequence). Never ship a bare NOT NULL add.
2. **The old data is disposable** (it can't be migrated — e.g. tokens that can't be re-encrypted
   without the KEK, and the old columns are being dropped anyway) → prepend an explicit
   `DELETE FROM "<table>";` with a comment explaining why, and document the operator's recovery action.

We chose (2): `DELETE FROM "social_tokens";` first, with a comment telling operators to reconnect via
`/admin/settings`.

## Heuristic

Empty-DB tests will *always* green-light a NOT NULL add — that's exactly why this defect class is
invisible until deploy. Whenever a generated migration contains `ADD COLUMN ... NOT NULL`, ask: "Does
this table have rows in production?" If yes (or unknown), the bare statement is wrong. The cheapest
proof is to run the migration against a DB seeded with one row before trusting it.

## Related

- `.claude/rules/learnings/partial-update-db-writers-precondition.md` — the sibling "row-existence
  precondition" lesson for partial UPDATE writers.
