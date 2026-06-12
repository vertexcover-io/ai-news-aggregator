# AGENTLOOP Multi-Tenant Migration Runbook

Production cutover for converting the single-tenant AGENTLOOP deployment to
the multi-tenant schema (tenant 0 = AGENTLOOP, `TENANT_ZERO_ID =
00000000-0000-0000-0000-000000000000`, slug `agentloop`).

Covers: backup, migrations 0040–0042, `migrate-agentloop`,
`verify-tenant-migration`, service boot, smoke checks, rollback. Caddy/host
routing env vars (`APP_HOST`, wildcard TLS, etc.) are deployment wiring and
are covered in [deploy.md](./deploy.md); local dev workflow in [dev.md](./dev.md).

## Invariants (read before touching anything)

- **EC10 — `SESSION_SECRET` must NOT rotate across the migration.** It is the
  HKDF KEK for every encrypted credential at rest (LinkedIn/Twitter
  credentials and tokens, Slack webhooks). Rotating it makes them all
  undecryptable; the only recovery is re-connecting each integration per
  tenant. `migrate-agentloop` hard-aborts if the current secret cannot
  decrypt an existing tenant-0 credential.
- **EC12 — ordering.** `tenant_id` is added nullable (0040), backfilled to
  tenant 0 (0041), and only then made NOT NULL + FK-enforced (0042).
  Isolation enforcement must never precede the backfill. The Drizzle migrator
  applies them in this order; never apply 0042 by hand before 0041 completes.
- **REQ-114/127 — idempotency.** 0041 and `migrate-agentloop` are
  re-runnable; a partial failure can be fixed and re-run without duplicating
  tenants, sources rows, or users. Rehearse on a copy first (step 2).

## Prerequisites

- Maintenance window: stop the API and pipeline workers (no in-flight runs;
  check the review queue is empty or drained).
- Env on the host running the scripts: `DATABASE_URL`, the **unchanged**
  `SESSION_SECRET`, plus `AGENTLOOP_ADMIN_EMAIL`, `AGENTLOOP_ADMIN_PASSWORD`,
  and optionally `SUPER_ADMIN_EMAILS` (comma-separated) +
  `SUPER_ADMIN_PASSWORD`.
- `pnpm install` completed for the release being deployed.

## Cutover steps

1. **Backup.**
   ```bash
   pg_dump --format=custom --file=pre-multitenant-$(date +%Y%m%d%H%M).dump "$DATABASE_URL"
   ```
   Keep this until the new topology has survived several daily runs.
   Also snapshot pre-migration row counts — the verify script (step 5) checks
   row *ownership* at verify time, not parity against this snapshot, so the
   cross-check against pre-migration totals is yours to do manually:
   ```bash
   for t in raw_items run_archives run_logs review_edits email_sends subscribers \
     feedback_events ses_events eval_runs must_read_entries user_settings \
     social_credentials social_tokens; do
     psql "$DATABASE_URL" -t -c "SELECT '$t', count(*) FROM $t"
   done > pre-multitenant-counts.txt
   ```

2. **Rehearse on a copy (first time only).** Restore the dump into a scratch
   database, point `DATABASE_URL` at it, and run steps 3–5 there. The CI
   equivalent is `packages/api/tests/e2e/tenant-migration.e2e.test.ts`, which
   rehearses 0000→0042 + seed + verify on a scratch DB.

3. **Apply migrations 0040–0042.**
   ```bash
   pnpm --filter @newsletter/shared db:migrate
   ```
   0040 adds nullable `tenant_id` columns + the new tables; 0041 creates the
   AGENTLOOP tenant (canon on) and backfills all 13 tenant-scoped tables and
   the JSONB→sources lift; 0042 turns on NOT NULL + FK + per-tenant unique
   constraints.

4. **Seed accounts + branding (idempotent).**
   ```bash
   AGENTLOOP_ADMIN_EMAIL=... AGENTLOOP_ADMIN_PASSWORD=... \
   SUPER_ADMIN_EMAILS=... SUPER_ADMIN_PASSWORD=... \
   pnpm --filter @newsletter/api migrate:agentloop
   ```
   - `--dry-run` first if you want a written plan with no writes.
   - Creates the tenant-0 `tenant_admin` user (skips when present; existing
     passwords are never overwritten unless you pass `--reset-password`),
     seeds super admins, backfills NULL tenant-0 branding fields with the
     public-site defaults, and ensures `canon_enabled = true`.
   - Aborts non-zero on the EC10 cipher gate — if that fires, restore the
     original `SESSION_SECRET` and re-run; do NOT proceed.

5. **Verify (hard gate).**
   ```bash
   SUPER_ADMIN_EMAILS=... \
   pnpm --filter @newsletter/api verify:migration --expect-single-tenant --dry-run-pipeline
   ```
   Must print `PASS` for every check and exit 0:
   0042 enforcement live (tenant_id NOT NULL + per-tenant constraints —
   catches a half-applied step 3 where 0041 committed but 0042 didn't);
   zero NULL `tenant_id` across the 13 tables; exactly one tenant row and
   every row owned by tenant 0; archives/settings/sources/subscribers
   resolve through the tenant-scoped repos; tenant 0 active with slug
   `agentloop`; tenant-admin + super admins present; assembled collector set
   non-empty. **Do not boot services until this passes.**
   - `SUPER_ADMIN_EMAILS` must be set in this shell or the super-admin check
     prints `SKIP` and verifies nothing about super admins.
   - Row counts are taken at verify time; diff the totals it prints against
     `pre-multitenant-counts.txt` from step 1 for true pre/post parity.
   - `--expect-single-tenant` is only valid at the migration moment — once
     real tenants sign up, run it without that flag.

6. **Boot services.** Start API, then pipeline workers. Boot reconciles
   per-tenant schedulers for all active tenants — confirm the scheduler log
   line for tenant 0 matches the configured times.

7. **Smoke checks.**
   - Public archive renders under tenant 0 (legacy archives included —
     REQ-122 fallbacks).
   - Log in as the tenant-0 admin; dashboard, settings, and sources panel
     load with the migrated data.
   - Log in as a super admin; tenant list shows AGENTLOOP; impersonation
     opens its dashboard.
   - `/admin/settings` shows LinkedIn/Twitter/Slack as still connected
     (proves credentials decrypt — EC10).
   - Trigger a manual dry run (or wait for the next scheduled run) and watch
     it complete through review.

## Rollback

- **Before/during step 3 failure:** restore the step-1 dump
  (`pg_restore --clean`), restart services on the previous release. Nothing
  else to undo.
- **After 0042 but before traffic:** preferred rollback is still the dump
  restore — the migrations are not individually reversible (0041 moves data).
- **Seed-only problems (step 4):** no rollback needed; fix the env input and
  re-run — the script skips everything that already exists. A wrong
  tenant-admin password is fixed with `--reset-password`.
- **Never** roll back by deleting the tenant 0 row — 0042's FKs make
  dependent rows reference it.
- If the EC10 gate failed because `SESSION_SECRET` was changed: restore the
  original secret. If the original is lost, encrypted credentials are
  unrecoverable — reconnect LinkedIn/Twitter/Slack per tenant after cutover.
