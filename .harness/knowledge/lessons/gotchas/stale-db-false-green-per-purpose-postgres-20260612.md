---
title: "Stale per-purpose Postgres DBs cause false-green AND false-red migrations — reset the schema, not infra"
date: 2026-06-12
category: gotchas
tags: [drizzle, migrations, postgres, false-green, hermetic-e2e, multi-tenant, backfill, dev-infra]
component: shared/db migrations + e2e infra
severity: high
status: documented
applies_to: ["packages/shared/src/db/**", "packages/*/tests/e2e/**", "**/run-e2e.mjs", "**/global-setup.ts"]
stage: [code, verify]
evidence_count: 5
last_validated: 2026-06-12
source: stale-test-db-false-green@multi-tenant
related: [".harness/knowledge/lessons/design-patterns/tenant-scoped-repos-stamp-on-insert-not-just-filter-select-20260612.md"]
---

# Stale per-purpose Postgres DBs cause false-green AND false-red migrations — reset the schema, not infra

## Problem

This project keeps several long-lived Postgres databases on one container (`newsletter`, `newsletter_mt` on :5434, `newsletter_test` for pipeline seam) plus fresh hermetic ones in CI. Across a multi-tenant migration set, two opposite failures appeared, both wasting an hour:

- **False GREEN:** `drizzle-kit migrate` reported success while applying NOTHING. The journal had 45 entries but the DB's `__drizzle_migrations` had 42 — and the last applied row's `created_at` was *newer* than the pending migrations' `when` timestamps, so drizzle-kit considered them already applied. Tests then ran against a schema missing `tenants.previous_slug`, etc.
- **False RED / silent exit 1:** `drizzle-kit migrate` printed only its spinner and exited 1 with **zero error output** (even under pty capture). Root cause was a column from an abandoned earlier attempt already existing, plus the tool connecting to a *different database than the psql used for inspection* (`.env` `DATABASE_URL` → `newsletter_mt`, while a stale legacy `newsletter` DB also lived on the same container).

## Insight

**A migration journal and a long-lived DB drift independently; "migrate succeeded" only means the tool's bookkeeping agreed with itself, not that your schema matches HEAD.** Three concrete consequences:

1. **Reset the SCHEMA, not the infra.** `DROP SCHEMA public CASCADE; DROP SCHEMA drizzle CASCADE; CREATE SCHEMA public;` then `db:migrate`. This applies to ANY per-purpose DB (`newsletter_mt`, `newsletter_test`), and is preferable to `pnpm infra:reset` when the system Postgres squats the compose port (here system PG holds :5433, so the project DB is on :5434 — an `infra:reset` hits a port conflict).
2. **A freshly-migrated DB is NOT ready** when the migration set enforces `tenant_id NOT NULL` and relies on a tenant-0 column DEFAULT bridge that a *separate backfill script* sets. Until `migrate-agentloop-tenant.ts` runs after `db:migrate`, every pre-tenancy writer (`PUT /api/settings`, `/subscribe`) 500s. Hermetic e2e harnesses (`run-e2e.mjs`) and dev resets must chain `db:migrate → backfill` (the backfill also creates the admin login account).
3. **drizzle-kit failures are debuggable only server-side.** `ALTER SYSTEM SET log_statement='all'; SELECT pg_reload_conf();` then read the container logs — that exposes both the actual failing statement and which database the tool really connected to.

## Solution

```bash
# Heal a drifted per-purpose DB (NOT infra:reset — port conflict on the squatted compose port)
psql "$DATABASE_URL" -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE;'
pnpm --filter @newsletter/shared db:migrate
pnpm --filter @newsletter/scripts migrate:agentloop   # backfill: tenant-0 DEFAULT bridge + admin account

# Debug a silent drizzle-kit exit 1
psql "$DATABASE_URL" -c "ALTER SYSTEM SET log_statement='all'; SELECT pg_reload_conf();"
# re-run migrate, then read podman/docker logs of the PG container for the real failing SQL
```

For a not-yet-applied migration that collides with columns left by an abandoned attempt, rewrite it with the idempotent `ADD COLUMN IF NOT EXISTS` pattern (D-113) rather than resetting.

## Prevention / Reuse

- Before trusting a green test run on a long-lived dev DB, verify `count(__drizzle_migrations) == journal entries` and that the schema has the columns your branch added — a passing suite on a drifted DB is a false green (the inverse of TDD's red).
- In hermetic e2e provisioning, always chain `migrate → backfill` and assert the backfill ran (e.g. the admin account exists).
- Keep exactly one `DATABASE_URL` per shell and confirm `\conninfo` matches what the failing tool uses — two DBs on one container is a classic "works in psql, fails in the tool" trap.
- Recurrence signal: "migrate succeeded but the column is missing," or a tool exit 1 with no stderr.

## Related

- `.harness/knowledge/lessons/design-patterns/tenant-scoped-repos-stamp-on-insert-not-just-filter-select-20260612.md` — why the tenant-0 DEFAULT bridge + backfill ordering exists
