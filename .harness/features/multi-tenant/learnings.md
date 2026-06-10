# Learnings: Multi-Tenancy (VER-110)

## Auth router must be wired in app.ts (verify-break D-1)

The `createAuthRouter` (signup, login, password reset) in `packages/api/src/routes/auth.ts` was fully written and tested in Phase 3 but never imported or mounted in `app.ts` or `index.ts`. The `BuildAppDeps` interface has no `authRouter` field. All `/api/auth/*` routes return 404. The web frontend already calls `/api/auth/login` and `/api/auth/signup`. Fix requires three steps: add field to `BuildAppDeps`, import+instantiate in `index.ts`, mount in `app.ts`.

See global lesson: `.harness/knowledge/lessons/integration-issues/route-must-be-mounted-in-app-ts-20260610.md`

## Drizzle migrations with commented-out DROP CONSTRAINT must be completed before commit (verify-break D-2/D-3)

Migration `0043_dazzling_victor_mancha.sql` has commented-out `DROP CONSTRAINT` statements with placeholder `<constraint_name>`. Attempting to apply it causes `multiple primary keys for table "social_credentials" are not allowed`. This blocked migrations 0044 and 0045, leaving the DB missing 7 tenant columns. Fix: uncomment DROP lines with actual PK names, re-run drizzle-kit migrate.

See global lesson: `.harness/knowledge/lessons/gotchas/drizzle-migration-commented-drop-constraint-20260610.md`

## Quality gate findings (gate-blocked)

- **Typecheck:** 2 errors in pipeline (`TenantScope` missing `tenantId`, test type missing `confirmedAt`)
- **Lint:** 2 errors in shared (`per-tenant-notifier.test.ts` — unused import, async without await)
- **Test:** 1 timeout in shared (`per-tenant-notifier` — Slack webhook test)
- **E2E:** No e2e-report.json for a user-facing feature
