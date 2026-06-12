# multi-tenant — task-specific learnings

Cross-cutting lessons from this work were promoted to global docs (see Related at the bottom). This file records the feature-specific findings and the verification-stage breaks.

## Verification-stage breaks (deferred minors — not blockers)

Found during functional-verify adversarial probing. None breaks tenant isolation; all are recorded for follow-up. Full repro in `verification/adversarial-findings.md`.

- **ADV-1 — App-host (no Host slug) serves cross-tenant merged public data (minor).** `GET /api/home` and `GET /api/archives/:id` on the bare app host (no `x-tenant-slug`) fall through to unscoped legacy mode (`packages/api/src/auth/tenant-scope.ts` `tenantScopeFromPublicHost` returns no tenant), so an arbitrary/merged tenant's rows are served. Data is public-per-tenant, so not a private leak, but it violates EDGE-013's "no leak" posture. Same finding pass-1 logged as Minor; the fix (a tenant-0 fallback like `branding.ts` does) was deliberately deferred. **Fix when picked up:** give the app host an explicit default-tenant fallback instead of unscoped legacy mode.

- **ADV-2 — Canon flag OFF hides only the nav, not the page/API (EDGE-014 partially unmet, minor).** With `feature_canon=false`, `GET /api/home` still returns `featuredCanon` and `GET /api/must-read` still returns 200 with entries — only the web masthead nav link is flag-gated. `packages/api/src/routes/home.ts` sets `featuredCanon` unconditionally from `mustReadRepo.findRandom()` and `packages/api/src/routes/must-read.ts` fences by tenant but never checks the flag (no `feature_canon` reference in either). EDGE-014 says "Page/nav hidden." The phase claim PHASE16-C2 only promised nav-hiding, so the impl matches the claim but not the broader spec. Content is public-by-design → minor. **Fix when picked up:** gate the home canon block + `/api/must-read` (and ideally the `/must-read` SPA route) on `feature_canon`.

- **ADV-3 — Double-activate of an already-active tenant returns a misleading 409 (trivial).** `POST /api/onboarding/activate` on an already-active tenant returns `409 {"error":"incomplete","missing":[…]}` instead of an idempotent success / "already active." No state mutated; cosmetic messaging only.

## This-feature isolation/security review fixes (already in code — context for reviewers)

The pass-1/pass-2 review hardening landed in commits `d044e2d` and `b670374`. Re-verified holding under adversarial probing during functional-verify:

- **Redis run-state must be tenant-fenced on EVERY read path, not just the obvious one.** `GET /api/runs/:id` + cancel were fenced first (d044e2d), but `GET /api/runs` (list), `/observability`, and `/sources/:key/items` also compose raw Redis state and leaked foreign live runs until b670374 neutralized foreign-stamped state → 404/absent. Lesson: when fencing a cross-cutting store, enumerate ALL read paths that touch it (grep the raw `redis`/`run:*` reads), not just the one the bug report named.
- **A dropped singleton index becomes an unscoped read.** Replacing the `user_settings` singleton unique with `unique(tenant_id)` meant `WHERE singleton = true LIMIT 1` now returns an arbitrary tenant's row once a second tenant exists. Bootstrap reconcile + PostHog config + the offline eval CLI all had to pin `defaultTenantScope`.
- **Tenant-supplied webhook = SSRF surface.** The tenant Slack webhook must be refined to `startsWith("https://hooks.slack.com/")` before storage, encrypted at the boundary (D-012), and never echoed back (responses carry only `slackWebhookSet`).
- **Rate-limiter must key on the proxy-appended LAST x-forwarded-for hop**, not the client-forgeable first hop, or rotating a forged prefix mints fresh buckets.
- **The eslint tenant-scope guard is lexical at enclosing-function granularity** (`packages/eslint-plugin/src/rules/enforce-repository-access.ts`) — a raw `db.execute(sql\`\`)` outside a repo factory is NOT covered; `sources` had to be added to `TENANT_OWNED_TABLES` by hand. The guard is a backstop, not a proof of isolation.

## Related global lessons (promoted from this spec)

- `.harness/knowledge/lessons/design-patterns/tenant-scoped-repos-stamp-on-insert-not-just-filter-select-20260612.md`
- `.harness/knowledge/lessons/architecture/fail-open-authorization-by-omission-20260612.md`
- `.harness/knowledge/lessons/gotchas/stale-db-false-green-per-purpose-postgres-20260612.md`
- `.harness/knowledge/lessons/gotchas/migration-rekeys-unique-breaks-on-conflict-in-tests-and-code-20260612.md`
- `.harness/knowledge/lessons/gotchas/hermetic-serial-playwright-e2e-authoring-traps-20260612.md`
