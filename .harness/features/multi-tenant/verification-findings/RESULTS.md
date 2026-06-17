# Verification Results

Run of `../feature-verification-playbook.md`, executed hands-on against a live local stack.

- **PASS** — works as the user story describes, with evidence.
- **FAIL** — does not work; a findings file exists with root cause (see `INDEX.md`).
- **PARTIAL** — core path works; some sub-behavior is bugged or untestable (see note).
- **UNTESTABLE** — depends on external creds/providers absent locally; internal contract checked where possible.

## Summary
- **50 features** exercised across Subscriber/Public, Admin (`tenant_admin`), SuperAdmin (`super_admin`).
- **2 failures found** (recorded with root cause; **not fixed**):
  1. **[Blocker]** HN `best` feed → Algolia 400 fails the whole run ([ADM-12-hn-best-feed-400.md](ADM-12-hn-best-feed-400.md)).
  2. **[Major]** Sign-out from the super-admin console hangs in a runaway `/api/auth/me` loop ([SUP-02-signout-loop.md](SUP-02-signout-loop.md)); related: tenant_admin logout invalidates the wrong query key.
- Tenant isolation verified (cross-tenant reads → 404), impersonation + audit verified, role guards (API 403 + UI redirects) verified.

## Environment (this run)
- **Test DB:** `postgresql://newsletter:newsletter@localhost:5434/newsletter_mt_verify` — fresh throwaway DB (podman `mt-verify-pg`), all 18 migrations applied; existing `newsletter_mt_a` untouched.
- **Redis:** `redis://localhost:6379/6` (isolated slot). **API:** `:3001` (health `GET /health`). **Web:** Vite `:5173` (needed `VITE_API_TARGET=http://127.0.0.1:3001` in process env — see note). **Pipeline:** worker on redis db6.
- **Identities:** super `super@vertexcover.io`; tenant_admin (active, tenant-zero) `admin@agentloop.dev`/`agentloop`; tenant_admin (pending) Acme + Globex.
- **Tenant resolution:** app host `localhost` (admin + tenant-zero public); slug host `<slug>.lvh.me` or dev header `X-Tenant-Slug`; only active tenants get a public site.
- **Doc corrections applied during run:** health is `/health` (not `/api/health`); web is `:5173`; auth reset/forgot are `/api/auth/reset` + `/api/auth/forgot` (reset needs `confirmPassword`); confirm/unsubscribe/feedback are GET; sources POST is `{type,value}`; logo upload is raw-bytes body.

## Subscriber / Public
| Feature | Status | Evidence |
|---|---|---|
| SUB-01 Home / archive listing | PASS | App host `/api/home`,`/api/archives` 200; UI homepage renders, no console errors. |
| SUB-02 Archive detail | PASS | After review-save, `/api/archives` shows 1, `/api/archives/:id` 200 in saved order (6,5,7). |
| SUB-03 Archive search | PASS | `/api/archives/search?q=ai` 200. |
| SUB-04 Sources facets | PASS | `/api/sources/summary` 200. |
| SUB-05 Must-read listing | PASS | `/api/must-read` 200. |
| SUB-06 Tenant branding | PASS | `/api/branding` 200 (`isTenantZero:true` for agentloop). |
| SUB-07 Subscribe | PASS | 200; `subscribers` row pending, tenant-stamped, confirm token set. |
| SUB-08 Confirm (token) | PASS | `GET /api/confirm` 302; status→confirmed. |
| SUB-09 Unsubscribe (token) | PASS | `GET /api/unsubscribe` (scope `unsub`) 302; status→unsubscribed; wrong-scope token rejected. |
| SUB-10 Feedback (token) | PASS | `GET /api/feedback?v=love` 302; `feedback_events` row, tenant-stamped. |
| SUB-11 Host-based resolution | PASS | active slug 200; pending 404; unknown 404 (no leak). |
| SUB-12 Slug rename 301 | PASS | `oldloop.lvh.me` → 301 → `agentloop.lvh.me`. |
| SUB-13 Static pages + 404 | PASS | `/privacy` renders; unknown path → graceful 404, no crash. |
| SUB-14 Analytics config | PASS | `/api/public/analytics-config` 200. |
| SUB-15 Webhooks (SES/SNS) | PARTIAL/UNTESTABLE | Signature gate verified (junk → 400 "Invalid SNS signature"); valid-event processing needs AWS signing. |

## SuperAdmin (super_admin)
| Feature | Status | Evidence |
|---|---|---|
| SUP-01 Seed | PASS | `seed:super-admins` created super (role super_admin, tenant null). |
| SUP-02 Login → console | PASS | API role/tenant correct; **UI login → `/admin/tenants`**. ⚠️ logout from console loops — see finding #2. |
| SUP-03 Tenant list + stats | PASS | super 200; tenant_admin 403; no-auth 401; UI console renders. |
| SUP-04 Impersonate (audited) | PASS | 200; `/me` shows `impersonation.tenant`; user stays super. |
| SUP-05 Exit impersonation | PASS | 200; `/me` impersonation null. |
| SUP-06 App-level OAuth creds | PASS | GET 200; `PUT twitter-collector` 200 configured:true. |
| SUP-07 RequireSuperAdmin guard | PASS | tenant_admin API 403; **UI `/admin/tenants` → bounced to `/admin`**. |
| SUP-08 Impersonation audit trail | PASS | `audit_log` start+stop, actor=super, target=agentloop. |

## Admin (tenant_admin)
| Feature | Status | Evidence |
|---|---|---|
| ADM-01 Signup → tenant + admin | PASS | 201 `{next:onboarding, role:tenant_admin}`, pending_setup + `pending-*` slug. |
| ADM-02 Login | PASS | API + UI login → `/admin` dashboard. |
| ADM-03 Session introspection | PASS | `/api/auth/me` 200 with user+tenant. |
| ADM-04 Logout | PASS | API 200 → `/me` 401; UI tenant logout → `/` (clean). |
| ADM-05 Forgot/reset password | PASS | `/api/auth/reset` flow set super's password; same path. |
| ADM-06 Onboarding wizard + activate | PASS | UI: pending tenant forced to `/admin/onboarding`, wizard renders (step 1 of 8). API state machine + activate-validation present. |
| ADM-07 Slug availability | PASS | available / reserved / taken classified. |
| ADM-08 LLM generate prompts | PASS | 200, real LLM ranking prompt. |
| ADM-09 Source discovery (Tavily) | PASS | 200, real candidates. |
| ADM-10 Logo upload | PASS | raw-bytes POST 200; `tenants.logo_bytes`+`logo_content_type` set. |
| ADM-11 Dashboard / run list | PASS | `/api/runs` 200 (tenant-scoped); UI dashboard renders. |
| ADM-12 Trigger run | PARTIAL | Enqueue + worker pickup work; **default config fails** (HN `best` feed → finding #1). `newest`-only run completes end-to-end (collect→rank→recap→archive). |
| ADM-13 Run observability | PASS | `/api/runs/:id` + `/api/admin/runs/:id/observability` 200; surfaces failed + completed with per-source detail. |
| ADM-14 Cancel run | PASS | cancel → `cancelling` → `cancelled`. |
| ADM-15 Review / curation | PASS | PATCH reorder+publish 200, reviewed:true, order persisted to public archive. |
| ADM-16 Sources CRUD | PASS | POST/GET/PATCH/DELETE work, tenant-stamped; auth-gated (no-auth 401). |
| ADM-17 Settings | PASS | GET 200; writes verified via features/notifications PUT (persisted). Raw full PUT validates strictly (large required schema). |
| ADM-18 Notifications | PASS | GET/PUT 200, persisted. |
| ADM-19 Sending domain | PASS | GET 200 `{domain:null}`. (Provider verify UNTESTABLE locally.) |
| ADM-20 Feature flags | PASS | GET/PUT 200, persisted (canon/deliverability/eval). |
| ADM-21 Social credentials | PASS | GET status 200. OAuth round-trip UNTESTABLE (no app creds). |
| ADM-22 Publish channels | PARTIAL | Review-save publishes the public archive; email/social external delivery UNTESTABLE (no confirmed subscribers / social creds). |
| ADM-23 Analytics dashboard | PASS | `/api/admin/analytics` 200, tenant-scoped (1 sub / 1 unsub). |
| ADM-24 Eval UI | PASS | `/api/admin/eval/runs`+`/fixtures` 200 (featureEval on). |
| ADM-25 Must-read management | PASS | POST 201, tenant-scoped; GET 200. |
| ADM-26 Collector health | PASS | GET 200; POST `/check` 202. |
| ADM-27 Tenant data isolation | PASS | Globex → 404 on agentloop's archive & run; 200 on own. No cross-tenant leak. |

## Environment note (not a product bug)
The Vite proxy reads `VITE_API_TARGET` from **`process.env`** (fallback `:3000`); it does not pick it up from `.env` for the config file. Since `API_PORT=3001`, the web UI 502s on every `/api` call unless `VITE_API_TARGET=http://127.0.0.1:3001` is exported into the process environment. Under `pnpm dev` (turbo) this is normally handled; it bit the per-package `pnpm --filter @newsletter/web dev` launch. Worth a dev-experience note but not a feature failure.
