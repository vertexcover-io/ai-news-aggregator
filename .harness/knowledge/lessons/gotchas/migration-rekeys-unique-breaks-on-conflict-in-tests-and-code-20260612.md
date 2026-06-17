---
title: "Re-keying a UNIQUE constraint silently breaks every ON CONFLICT that targets the old key"
date: 2026-06-12
category: gotchas
tags: [postgres, on-conflict, upsert, migration, unique-constraint, multi-tenant, e2e, test-helpers, false-green]
component: shared/db migrations + e2e test helpers
severity: high
status: observed
applies_to: ["packages/shared/src/db/migrations/**", "packages/*/tests/**", "packages/*/src/repositories/**"]
stage: [code, verify]
evidence_count: 3
last_validated: 2026-06-12
source: gate-blocked@multi-tenant
related: [".harness/knowledge/lessons/gotchas/stale-db-false-green-per-purpose-postgres-20260612.md"]
---

# Re-keying a UNIQUE constraint silently breaks every ON CONFLICT that targets the old key

## Problem

The multi-tenant migration re-keyed the `subscribers` unique from `subscribers_email_uq (email)` to `subscribers_tenant_email_uq (tenant_id, email)` (and `raw_items` similarly to `(tenant_id, source_type, external_id)`). That schema change is correct. But a web e2e test helper still did:

```sql
INSERT INTO subscribers (id, email, status, subscribed_at)
VALUES ($1, $2, 'confirmed', NOW())
ON CONFLICT (email) DO UPDATE SET status='confirmed', subscribed_at=NOW()
```

Against the migrated schema this fails **deterministically** with `ERROR: there is no unique or exclusion constraint matching the ON CONFLICT specification` — because there is no longer a unique on `(email)` alone. Four e2e tests (`subscribe-tokens.spec.ts`, REQ-007/015/017, EDGE-003/004/012) flipped red and **blocked the quality gate**, even though the feature code and migrations were correct. The constraint change was made in the C1 review-fix phase; that phase's claims stayed green because it did not re-run these particular specs.

## Insight

**`ON CONFLICT (cols)` is a hard reference to a specific unique/exclusion constraint — re-keying the constraint orphans every upsert (in code AND in tests) that names the old columns, and the failure surfaces only when that exact statement runs.** Two follow-ons:

- The break is invisible to typecheck and to any phase that doesn't execute the affected statement. Per-phase "all green" claims can coexist with a real regression when the constraint-changing phase and the statement-using phase are different phases (a coverage/sequencing gap — the sibling of the stale-DB false-green trap).
- Test helpers are first-class consumers of constraints. A migration PR that changes a UNIQUE must update them too; an out-of-date `ON CONFLICT` in a test fixture is a real regression, not "just a test."

## Solution

When a migration changes a table's UNIQUE/exclusion constraint, grep the whole repo for every upsert against that table and update the conflict target:

```bash
# find every consumer of the old key — code AND tests
grep -rn "ON CONFLICT" packages/ --include="*.ts" --include="*.sql" | grep -i subscribers
grep -rni "onConflict" packages/ --include="*.ts" | grep -i subscribers   # drizzle .onConflictDoUpdate({ target: ... })
```

Fix the helper to the new key (tenant_id is bridged by the tenant-0 column DEFAULT, so the INSERT need not supply it explicitly):

```sql
ON CONFLICT (tenant_id, email) DO UPDATE SET status='confirmed', subscribed_at=NOW()
```

## Prevention / Reuse

- Migration checklist: when a generated/hand-written migration contains `DROP CONSTRAINT … _uq` / `CREATE UNIQUE`, immediately `grep -rn "ON CONFLICT\|onConflict"` for that table across `src/` AND `tests/` and update every match in the same PR.
- Treat e2e/test helpers as constraint consumers — they break the same way production upserts do.
- Don't trust per-phase green as proof a constraint change is safe; the proof is re-running the specs that upsert that table. The quality gate's full-suite run is where this surfaces — which is exactly why the gate runs the whole e2e suite, not just the changed phase's tests.
- Recurrence signal: `there is no unique or exclusion constraint matching the ON CONFLICT specification` in a test that passed before a migration.

## Related

- `.harness/knowledge/lessons/gotchas/stale-db-false-green-per-purpose-postgres-20260612.md` — the other way per-phase green hides a real schema regression
