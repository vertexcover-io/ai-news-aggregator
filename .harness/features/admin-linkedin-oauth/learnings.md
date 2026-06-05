---
title: "admin-linkedin-oauth learnings"
date: 2026-05-27
spec: admin-linkedin-oauth
---

# Learnings — admin-linkedin-oauth

---

## Learning 1: Two .harness directories — sub-agents write to repo-root, verify step runs in worktree

### Problem

This pipeline ran in a git worktree at `.claude/worktrees/admin-linkedin-oauth/`. Sub-agents (coder phases) ran against the worktree, so their `git` commands and file writes resolved relative to the worktree. The `.harness/admin-linkedin-oauth/` directory they wrote claims and vitest JSON files to was therefore at `/newsletter/.claude/worktrees/admin-linkedin-oauth/.harness/admin-linkedin-oauth/`.

But the verify and quality-gate steps were invoked with `--harness-dir .harness/admin-linkedin-oauth/` anchored at the *repo root* (`/newsletter/`), where a second `.harness/admin-linkedin-oauth/` also existed (the orchestrator's working copy, synced from the sub-agents at each phase boundary). This created two live directories:

- `/newsletter/.harness/admin-linkedin-oauth/` — phase files (phase-1.md … phase-4.md), review/, claims.json from aggregation
- `/newsletter/.claude/worktrees/admin-linkedin-oauth/.harness/admin-linkedin-oauth/` — baseline.json, gate reports, per-phase vitest JSON

When the quality gate tried to read `baseline.json` using the repo-root path it was not found; gate report and baseline were only accessible via the worktree path.

### Rule

When a pipeline runs in a worktree, **establish at the start which `.harness/` path is canonical** and pass that absolute path to every sub-agent and orchestration step. Do not mix relative `--harness-dir` paths across steps that run from different working directories.

Concretely: if the worktree is at `<root>/.claude/worktrees/<name>/`, use `<root>/.claude/worktrees/<name>/.harness/<spec>/` as the single harness directory for baseline, gate reports, and vitest artifacts. Sub-agents invoked from the worktree root will resolve it correctly. Gate and verify steps invoked from outside must receive the absolute path.

The repo-root `.harness/<spec>/` should only hold the phase-*.md files and review/ artifacts that the orchestrator creates — it is the orchestrator's scratchpad, not the artifact store.

---

## Learning 2: NOT NULL column without DEFAULT (or pre-delete) fails on non-empty tables

### Problem

The Phase 1 migration added an `encrypted_fields jsonb NOT NULL` column to the `social_tokens` table. The original Drizzle-generated SQL was:

```sql
ALTER TABLE "social_tokens" ADD COLUMN "encrypted_fields" jsonb NOT NULL;
ALTER TABLE "social_tokens" DROP COLUMN "access_token";
ALTER TABLE "social_tokens" DROP COLUMN "refresh_token";
```

This fails at runtime if any rows exist — Postgres cannot assign a non-null value to the new column for existing rows. Drizzle Kit generates this form for `NOT NULL` columns because it assumes the table is empty or the developer will supply a backfill. In this case the existing tokens are dead (plaintext, encrypted with a key that no longer applies after the migration), so no backfill is possible.

Code review pass 1 caught this and the fix was a `DELETE FROM "social_tokens";` before the `ALTER TABLE`:

```sql
-- Wipe plaintext token rows before adding the NOT NULL encrypted column.
-- Tokens stored here cannot be migrated without the KEK and are dead anyway.
-- Operators must reconnect via /admin/settings after this migration.
DELETE FROM "social_tokens";
ALTER TABLE "social_tokens" ADD COLUMN "encrypted_fields" jsonb NOT NULL;
ALTER TABLE "social_tokens" DROP COLUMN "access_token";
ALTER TABLE "social_tokens" DROP COLUMN "refresh_token";
```

### Rule

When adding a `NOT NULL` column to a table that may contain rows, choose exactly one of:
1. **Supply a DEFAULT** — `ADD COLUMN x type NOT NULL DEFAULT <value>` (works in-place, no data loss)
2. **Backfill then constrain** — `ADD COLUMN x type NULL; UPDATE SET x = <expr>; ALTER COLUMN x SET NOT NULL` (for complex transforms)
3. **DELETE first** — only valid when existing rows are dead/invalid and operators accept reconnecting

Option 3 is appropriate here because: the old tokens are unrecoverable without the original plaintext, a per-row key-migration would require access to the KEK during the migration (not available to `drizzle-kit migrate`), and the reconnect cost is low (admin OAuth flow takes 30 seconds).

**Drizzle Kit will not warn you.** It generates the `NOT NULL` without `DEFAULT` form as a first-class migration pattern. Always audit generated migrations for this before committing.

### Related

- See `docs/solutions/orchestration/verify-subagent-artifact-claims-independently.md` for the related pattern of not trusting sub-agent phase completion prose.
- The eslint rule `newsletter/no-raw-alter` prevents hand-written `ALTER TABLE` in source; always generate via `db:generate`. This rule does not protect against missing `DEFAULT` — that review must be manual.
