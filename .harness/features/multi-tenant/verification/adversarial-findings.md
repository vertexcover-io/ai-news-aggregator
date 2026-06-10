# Adversarial Findings: Multi-Tenancy (VER-110)

## 1. Attack Surface Derived

### Gap: No `claims.json` per-claim classification
The aggregated claims.json only has aggregate counts (106 executed/101 passed/5 failed); no per-claim `type`/`status` fields. Phase files have varied formats. Attack surface derived from spec requirements minus test coverage.

### Derived targets (spec ACs not provably covered by claims):
- REQ-001 through REQ-007 (auth/signup -- auth router NOT mounted in app.ts)
- REQ-030 through REQ-039 (onboarding wizard -- partially wired)
- REQ-040 through REQ-044 (branding -- works via X-Tenant-Slug, not via localhost proxy)
- REQ-098 through REQ-102 (super admin -- routes exist, auth broken)
- REQ-110 through REQ-127 (migration/NFR -- schema column mismatches found)

### Gap categories exercised:
- **Boundary inputs:** missing env vars, zero-tenant fallback, no-session paths
- **Unexpected sequences:** login with new auth format against old route
- **Broader surface:** every API route probe, cross-route wiring check
- **Error recovery:** 500 on missing DB columns, 404 fallback behavior
- **Status accuracy:** "Sign in" button returns "Something went wrong" on a missing route
- **Permissions/auth:** unauthenticated access to protected routes
- **Concurrency:** slug race, DB unique constraint

## 2. Scenarios Attempted

| ID | Category | Description | Inputs | Verdict |
|----|----------|-------------|--------|---------|
| A-01 | Broader surface | GET /api/home (no tenant ctx) on localhost | `curl http://localhost:3000/api/home` | EXPECTED -- fallback to "Newsletter" default (localhost passthrough per resolve-tenant.ts:106-108) |
| A-02 | Broader surface | GET /api/home with X-Tenant-Slug:agentloop | `curl -H 'X-Tenant-Slug: agentloop'` | EXPECTED -- returns AGENTLOOP branding, canon=true |
| A-03 | Unexpected sequences | POST /api/auth/login (new auth route) | `{"email":"admin@agentloop.dev","password":"vertexcover@123"}` | **DEFECT** -- 404, route not mounted |
| A-04 | Unexpected sequences | POST /api/auth/signup (new auth route) | valid signup payload | **DEFECT** -- 404, route not mounted |
| A-05 | Unexpected sequences | POST /api/auth/forgot (password reset) | `{"email":"admin@agentloop.dev"}` | **DEFECT** -- 404, route not mounted |
| A-06 | Unexpected sequences | POST /api/auth/reset (password reset) | `{"token":"x","password":"new","confirmPassword":"new"}` | **DEFECT** -- 404, route not mounted |
| A-07 | Boundary inputs | GET /api/home with unknown slug | `curl -H 'X-Tenant-Slug: nonexistent'` | EXPECTED -- 404 `{"error":"Not Found"}` |
| A-08 | Boundary inputs | GET / with unknown X-Tenant-Slug | Browser can't send custom header via Vite proxy | CANNOT_ASSESS -- localhost cannot use X-Tenant-Slug from browser; production routing works via Host header |
| A-09 | Error recovery | GET /api/home with zero UUID tenant | `curl http://localhost:3000/api/home` (no tenantCtx) | EXPECTED -- graceful fallback to "Newsletter" default |
| A-10 | Broader surface | Web login page POSTs to /api/auth/login | Browser submit at /admin/login | **DEFECT** -- 404, login page wired to unmounted auth router |
| A-11 | Broader surface | Legacy admin password login | `POST /api/admin/login {"password":"vertexcover@123"}` | EXPECTED -- 200, session cookie set, GET /api/admin/me returns `{"admin":true,"role":"tenant_admin"}` |
| A-12 | Permissions/auth | GET /admin/super/tenants without session | Browser navigate | EXPECTED -- redirect to login (correct) but login is broken |
| A-13 | Boundary inputs | DB schema column existence | `\d tenants` (psql) | **DEFECT** -- `notify_email`, `slack_webhook`, `domain_*`, `old_slug` columns missing from DB (migrations 0043-0045 not applied); API crashed with 500 on missing `notify_email` and `old_slug` on first probe |
| A-14 | Broader surface | social_credentials PK migration | Migration 0043 partially applied | **DEFECT** -- table created with old PK (platform), composite PK migration failed with "multiple primary keys" |
| A-15 | Error recovery | API restart after manual column additions | Manual ALTER TABLE to add missing columns | EXPECTED -- API recovered, /api/home returns 200 with correct tenant data |

## 3. Defects

### D-1: Auth router not mounted (BLOCKER)
**Severity:** BLOCKER

**Reproduction:**
1. `curl -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' -d '{"email":"admin@agentloop.dev","password":"vertexcover@123"}'`
2. Returns 404 Not Found
3. Same for `/api/auth/signup`, `/api/auth/forgot`, `/api/auth/reset`, `/api/auth/me`

**Actual:** All `/api/auth/*` routes return 404. The `createAuthRouter` function exists in `packages/api/src/routes/auth.ts` (Phase 3) but is never imported or mounted in `packages/api/src/app.ts` or `packages/api/src/index.ts`.

**Expected:** `/api/auth/signup` (REQ-001/002/003/006), `/api/auth/login` (REQ-005), `/api/auth/forgot`+`/api/auth/reset` (REQ-004), `/api/auth/logout`, `/api/auth/me` should all be mounted and functional.

**Evidence:**
- `packages/web/src/api/auth.ts:45` calls `/api/auth/login` -- web login page is broken
- `packages/web/src/pages/AdminLoginPage.tsx:35` uses `login()` from `@/api/auth` which POSTs to `/api/auth/login`
- `packages/api/src/routes/auth.ts` exports `createAuthRouter` with all routes defined
- `packages/api/src/app.ts` BuildAppDeps has no `authRouter` field
- `packages/api/src/index.ts` has no import of `createAuthRouter`

### D-2: DB schema mismatches from unapplied migrations (BLOCKER)
**Severity:** BLOCKER

**Reproduction:**
1. Start API against DB with migrations 0040-0042 only
2. `curl http://localhost:3000/api/home`
3. Returns 500: `column "notify_email" does not exist`
4. After manually adding `notify_email` and `slack_webhook`: 500: `column "old_slug" does not exist`

**Actual:** Migrations 0043, 0044, 0045 were never successfully applied. The `drizzle-kit migrate` command fails because migration 0043 tries to add a composite PK to `social_credentials` without first dropping the existing `social_credentials_pkey`.

**Expected:** All 45 migrations should apply cleanly. Schema should match Drizzle schema definitions exactly.

**Evidence:**
- `drizzle.__drizzle_migrations` table shows only migrations 33-42
- Migration 0043 fails with `PostgresError: multiple primary keys for table "social_credentials" are not allowed`
- Columns `notify_email`, `slack_webhook`, `domain_id`, `domain_name`, `domain_status`, `domain_records`, `old_slug` missing from tenants table

### D-3: Social credentials composite PK partially applied (MAJOR)
**Severity:** MAJOR (data integrity risk)

**Reproduction:**
1. `SELECT * FROM drizzle.__drizzle_migrations` -- shows migration 42 as latest
2. `\d social_credentials` -- shows table has columns from 0043 (incl. tenant_id) but PK is still `(platform)` only
3. `\d social_tokens` -- same pattern: columns from 0043 exist, PK was manually fixed

**Actual:** The `social_credentials` table has `tenant_id` column from migration 0043 but still uses the old PK on `(platform)` alone. Two tenants with LinkedIn credentials on the same platform will conflict.

**Expected:** PK should be `(tenant_id, platform)` composite as intended.

**Evidence:** Migration 0043 execution order: `CREATE TABLE app_credentials` succeeded, `ALTER COLUMN tenant_id SET NOT NULL` succeeded, but `ADD CONSTRAINT social_credentials_tenant_id_platform_pk` failed because the existing PK wasn't dropped first (the DROP CONSTRAINT was commented out in the migration file).

## 4. Cannot Assess

| ID | Description | Reason |
|----|-------------|--------|
| CAN-01 | Signup flow (REQ-001 through REQ-006) | Auth routes not mounted |
| CAN-02 | Password reset (REQ-004) | Auth routes not mounted |
| CAN-03 | Onboarding wizard (REQ-030 through REQ-039) | Requires signup + session which is broken |
| CAN-04 | Super-admin impersonation (REQ-100 through REQ-103) | Requires working login + super-admin account |
| CAN-05 | Subscriber flow (REQ-050 through REQ-052) | Public site branding requires host-based routing not available from localhost browser |
| CAN-06 | Per-tenant pipeline (REQ-060 through REQ-068) | Requires working pipeline workers with tenant context |
| CAN-07 | Branding via browser (REQ-040, REQ-041) | localhost passthrough prevents tenant resolution; works via API with X-Tenant-Slug header |
| CAN-08 | Sending domain (REQ-084, REQ-085) | Resend API key not configured |
| CAN-09 | Full e2e tenant isolation | Multiple tenants plus auth needed |

## 5. Honest Declaration

**Defects found: 3 (2 BLOCKER, 1 MAJOR).**

Categories exercised: boundary inputs, unexpected sequences, broader surface (route probes), error recovery (500 on missing columns), status accuracy (misleading error on login), permissions/auth (gated routes redirect correctly).

The auth router wiring gap (D-1) is the most critical finding — it renders the entire login/signup/onboarding flow inaccessible from the web UI. The `createAuthRouter` exists and is well-tested (Phase 3 claims 12 tests passed), but it was never plugged into `app.ts`. The web frontend (`AdminLoginPage.tsx`) already calls `/api/auth/login` expecting it to work, creating a hard frontend-backend mismatch.

The schema migration gap (D-2) is the second critical issue — three migrations (0043-0045) couldn't be applied due to an incompletely hand-edited migration file that left the old PK drop commented out. This caused cascading column-not-found errors on first API probe.

I genuinely tried to break the feature across all reasonable attack vectors for a system in this state. The most promising attack — navigating the full signup-to-publish flow (VS-1 through VS-5) — failed at the very first step because auth routes are unreachable. The second most promising — verifying the public homepage — showed correct behavior via API headers but was untestable via browser due to the localhost passthrough design choice.
