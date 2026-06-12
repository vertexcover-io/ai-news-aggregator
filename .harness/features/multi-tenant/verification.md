# Verification — Multi-Tenancy (VER-110)

Final sweep date: 2026-06-12. Verdict: GO for PR.

## Gates (fresh runs at sweep time)

| Gate | Result |
|---|---|
| `pnpm turbo typecheck lint --force` | 7/7 + 6/6 OK |
| `pnpm build` | 5/5 OK |
| Units (shared/eslint-plugin/api/pipeline/web) | 447 / 53 / 977 / 1250 / 921 — 3,648 passed, 0 fail |
| API e2e (full) | 228 passed, 1 skipped (live-ses) — incl. tenant-isolation, onboarding-smoke, super-admin-impersonation, tenant-migration |
| Pipeline e2e (seam + crawler) | 75 passed, 1 skipped |
| Playwright journeys (VS-1 / VS-3 / VS-4) | 4 passed, ran twice |
| Bundle secret scan (`test:bundle` vs fresh `dist/`) | 1 passed |

## Spec coverage — REQ-001..127 + EDGE-001..014 (93 items)

- **87 implemented + directly tested** (named tests per section: auth, isolation, host routing, onboarding, branding/public, subscribers, pipeline scheduling/cap/jitter/throttle, sources, credentials/sending domains, notifications/flags, super admin/impersonation/audit, migration, NF gates, all 14 EDGEs).
- **4 indirect (accepted):** REQ-041 (layout reuse via VS-3 + HomePage units), REQ-052 (broadcast scoping via tenant-scoped subscribers repo + isolation e2e), REQ-064/124 (attribution via 0042 NOT NULL + scoped factories + verify script).
- **2 deferred (pre-approved):** REQ-123 (load test; run-cap seam e2e partially covers), REQ-067 beyond the twitter bucket.
- **0 MISSING.**

## Migration evidence (REQ-114/115/127)

Authoritative: `packages/api/tests/e2e/tenant-migration.e2e.test.ts` — scratch-DB rehearsal of 0041 backfill idempotency, 0042 enforcement (EDGE-012), `migrate:agentloop` dry-run/first-run/re-run/`--reset-password`/EC10-abort, and `verify:migration` pass + correct `--expect-single-tenant` failure. GREEN in the api e2e gate.

Dev-DB `verify:migration`: 1/10 red ("settings resolve for tenant 0") — caused by a since-fixed unscoped delete in `archives.e2e.test.ts` that wiped `user_settings` on every api e2e run, not by the migration scripts. Tenant-0 settings must be re-saved once (defaults via `/admin/settings`); `SUPER_ADMIN_EMAILS` must be set to clear the super-admin SKIP (mandatory at prod cutover).

## Material findings fixed during sweep

- **F1** `packages/api/tests/e2e/archives.e2e.test.ts` — unscoped `db.delete(userSettings)` tenant-scoped to `TENANT_ZERO_ID`.
- **F2** `packages/web/vite.config.ts` — `server.host: "127.0.0.1"` so the documented `<slug>.lvh.me:5173` dev flow works (lvh.me resolves to IPv4).

## Accepted / follow-ups

- Dedicated test DB for api e2e (settings/sources suites still mutate tenant-0 rows in whatever DB `DATABASE_URL` points at).
- 28 pre-existing legacy web-e2e failures (12 spec files targeting UI removed in Phases 10–12) — delete-or-repair decision; byte-identical with Phase-14 harness edits reverted.
- REQ-067 non-twitter rate buckets; REQ-123 load test.
- Pre-approved skips: single previous_slug hop, stale pending_setup reaping, billing, vanity domains, RLS, live Resend/Twitter in CI.
