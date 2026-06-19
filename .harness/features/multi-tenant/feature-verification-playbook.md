# Feature Verification Playbook — Multi-Tenant AI Newsletter Aggregator

> **Purpose.** A complete, role-segregated inventory of every feature in the product, each with a user story and concrete, runnable verification steps. An agent (or human) can follow each step to confirm the feature works. Failures found while executing this playbook are recorded — with root cause — under `verification-findings/` (see [Findings protocol](#findings-protocol)); **failures are not fixed as part of verification.**
>
> **Branch:** `feature/multi-tenant` · **Worktree:** `.worktrees/multi-tenant`

---

## Role model (how the three roles map to this codebase)

The authentication model has exactly **two authenticated roles**, plus an unauthenticated public surface. The requested Subscriber / Admin / SuperAdmin split maps as:

| Requested role | Real identity in code | Description |
|---|---|---|
| **Subscriber** | *Public / unauthenticated* (no login) | Newsletter readers. Act via public routes and token-gated links (subscribe, confirm, unsubscribe, feedback, browse archives/sources/must-read). There is **no logged-in subscriber account** — `subscribers` is a data table, not an auth role. |
| **Admin** | `tenant_admin` | Owns exactly one tenant (`tenantId` set). Full control over their tenant's runs, content, sources, settings, publishing, analytics. Cannot see other tenants. |
| **SuperAdmin** | `super_admin` | Platform operator (`tenantId = null`). Lists all tenants, impersonates tenants (audited), manages app-level OAuth credentials. Not bound to any tenant. |

- Role enum: `packages/shared/src/types/tenant.ts` → `UserRole = "super_admin" | "tenant_admin"`.
- Tenant resolution: session cookie for authenticated/admin routes; Host (subdomain / custom domain) for public routes. `packages/api/src/middleware/resolve-tenant.ts`.
- Web guards: `RequireAdmin` → `RequireOnboarding` → `RequireSuperAdmin` (`packages/web/src/layouts/`).
- Data isolation: every tenant-owned repo query is filtered by `tenantId` via a `TenantScope` (`packages/shared/src/types/tenant-context.ts`).

---

## Environment & how to run

| Thing | Value | Source |
|---|---|---|
| App DB | `postgresql://newsletter:newsletter@localhost:5434/newsletter_mt_a` (schema-isolated MT test DB) | `.env` |
| Prod-style DB | `localhost:5433/newsletter` (podman compose maps 5433) | `compose.yml` |
| Redis | `redis://localhost:6379/5` (db slot 5) | `.env` |
| API | `http://127.0.0.1:3001` (health: `GET /health` → `{"status":"ok"}`; note: **`/health`, not `/api/health`**) | `API_PORT=3001` |
| Web (Vite) | `http://localhost:5173` (Vite default; the configured `5174` hint is ignored. Proxies `/api` → `:3001`) | `vite.config.ts` |
| Pipeline | standalone worker, no port (consumes BullMQ queues in Redis db5) | `packages/pipeline/src/index.ts` |
| Super-admin emails | `super@vertexcover.io` | `SUPER_ADMIN_EMAILS` |
| Bootstrap admin password | `vertexcover@123` | `ADMIN_PASSWORD` |

**Startup sequence**
```bash
pnpm infra:up                                          # Postgres + Redis (idempotent)
pnpm migrate:up                                        # apply Drizzle migrations
pnpm --filter @newsletter/scripts seed:super-admins    # create super_admin, prints one-time reset link
pnpm --filter @newsletter/api dev                      # API on :3001
pnpm --filter @newsletter/pipeline dev                 # workers
pnpm --filter @newsletter/web dev                      # web on :5174
curl -sf http://127.0.0.1:3001/health                  # gate: expect {"status":"ok"}
```

**Bootstrap users**
- **tenant_admin:** `POST /api/auth/signup` `{name,email,password,confirmPassword}` → creates a tenant (`pending-XXXXXX` slug, `pending_setup`) + `tenant_admin` user + session cookie; response `{next:"onboarding", user}`.
- **super_admin:** only via `seed:super-admins` (reads `SUPER_ADMIN_EMAILS`), which prints a reset link → set password at `/reset-password?token=...`. Creates user with `tenantId=null, role=super_admin`.
- **Fresh-DB bootstrap admin:** if `users` is empty and `ADMIN_PASSWORD` set, API auto-seeds tenant "agentloop" + `tenant_admin` (`admin@agentloop.dev` / `ADMIN_PASSWORD`). `packages/api/src/services/admin-seed.ts`.
- Passwords: Node `scrypt` (`scrypt$N=16384,r=8,p=1$salt$hash`), `packages/api/src/services/password.ts`.
- Login: `POST /api/auth/login` `{email,password}` → sets cookie `admin_session_v3` (7d). Super-admin impersonation uses a second short-lived cookie.

**Verification toolbox**

| Method | Tool | Use for |
|---|---|---|
| UI flow | Playwright MCP (`browser_navigate`, `browser_click`, `browser_snapshot`, `browser_take_screenshot`, `browser_console_messages`) | Pages, forms, guards, redirects |
| API contract | `curl` (use a cookie jar `-c/-b cookies.txt` for auth) | Status codes, response shape, auth boundaries |
| Persistence | Postgres MCP (`mcp__postgres__query`) | Rows written/updated, `tenant_id` stamping, isolation |
| Jobs / queue | Redis MCP (`scan_keys`, `lrange`, `hgetall`, `zrange`) | BullMQ jobs enqueued, tokens, run state |

> **Cookie-jar pattern for curl:** `curl -c /tmp/admin.txt -X POST .../api/auth/login -d '{...}'` then reuse `-b /tmp/admin.txt` on subsequent calls. Keep separate jars per identity (`/tmp/super.txt`, `/tmp/tenantA.txt`, `/tmp/tenantB.txt`).

---

## Findings protocol

When a feature does **not** behave as the user story / expected result describes:
1. Do **not** fix it.
2. Create `verification-findings/<feature-id>-<slug>.md` with:
   - **Feature** (ID + name), **Role**
   - **Expected** (from this playbook) vs **Observed** (what actually happened)
   - **Evidence** (curl output / screenshot path / SQL result / Redis keys)
   - **Root cause** — the specific file/line/logic responsible, established by reading the code (not a guess). If root cause is unconfirmed, label it **Hypothesis** and say what would confirm it.
   - **Severity** (Blocker / Major / Minor) and **Suspected scope** (tenant isolation? auth? data loss?).
3. Add a one-line entry to `verification-findings/INDEX.md`.

A passing feature needs no findings file; it is recorded PASS in the final run report (`verification-findings/RESULTS.md`).

---

# Feature Inventory

Legend for each feature: **Story** = user story · **Verify** = ordered steps · **Expect** = pass criteria.

---

## 1. Subscriber / Public (unauthenticated)

### SUB-01 — Public homepage / latest issue + archive listing
- **Story:** As a reader, I visit a tenant's site and see today's issue plus recent past issues, so I can catch up on AI news.
- **Verify:**
  1. UI: `browser_navigate` to `http://localhost:5174/` → snapshot.
  2. API: `curl -s http://127.0.0.1:3001/api/home` (and `/api/archives`).
- **Expect:** Page renders with a hero/today section + recent issues list, no console errors. `/api/home` returns 200 with `todaysIssue`/`featured`/`recent` composite; `/api/archives` returns a list. No auth required.

### SUB-02 — Archive detail (past issue)
- **Story:** As a reader, I open a past issue and read its ranked items + recap.
- **Verify:** Pick a `runId` from `/api/archives`. UI: navigate `/archive/<runId>`. API: `curl -s http://127.0.0.1:3001/api/archives/<runId>`.
- **Expect:** 200; ranked items in saved order, recap fields present; legacy archives degrade gracefully (no crash on missing digest fields).

### SUB-03 — Archive search
- **Story:** As a reader, I search archives by keyword.
- **Verify:** `curl -s "http://127.0.0.1:3001/api/archives/search?q=ai"`.
- **Expect:** 200 with matching results array (possibly empty), correctly tenant-scoped to the host.

### SUB-04 — Sources facets page
- **Story:** As a reader, I see which sources stories came from over the last 7 days.
- **Verify:** UI `/sources`; API `curl -s http://127.0.0.1:3001/api/sources/summary`.
- **Expect:** 200, facet counts by source type. Public (no auth).

### SUB-05 — Must-read listing
- **Story:** As a reader, I browse the curated must-read collection.
- **Verify:** UI `/must-read`; API `curl -s http://127.0.0.1:3001/api/must-read`.
- **Expect:** 200; renders entries (or empty state) if `featureCanon` enabled for the tenant.

### SUB-06 — Tenant branding (name, logo, feature flags)
- **Story:** As a reader, the site shows the tenant's branding, not a generic shell.
- **Verify:** `curl -s http://127.0.0.1:3001/api/branding`; `curl -sI http://127.0.0.1:3001/api/branding/logo`.
- **Expect:** Branding JSON (name, headline, flags); logo endpoint returns image bytes with cache headers (or sensible 404/placeholder when no logo).

### SUB-07 — Subscribe to a newsletter
- **Story:** As a reader, I submit my email to subscribe; I get a confirmation email (double opt-in).
- **Verify:** `curl -s -X POST http://127.0.0.1:3001/api/subscribe -H 'content-type: application/json' -d '{"email":"reader+test@example.com"}'`. Then Postgres MCP: `select id, email, status, tenant_id from subscribers where email='reader+test@example.com';`
- **Expect:** 200/accepted; a `subscribers` row exists with `status` pending/unconfirmed and the correct `tenant_id` (resolved from host). (Email send may be a no-op without provider creds — note, don't fail on missing email delivery.)

### SUB-08 — Confirm subscription (token-gated)
- **Story:** As a reader, I click the confirm link in the email to activate my subscription.
- **Verify:** Obtain confirm token (from DB/Redis or the subscribe flow), `curl -s -X POST http://127.0.0.1:3001/api/confirm -d '{"token":"..."}'`. Postgres MCP: confirm `status` flips to confirmed/active.
- **Expect:** 200; subscriber status becomes confirmed. Invalid/expired token → 4xx with clear error.

### SUB-09 — Unsubscribe (token-gated)
- **Story:** As a reader, I click unsubscribe and stop receiving emails.
- **Verify:** `curl -s -X POST http://127.0.0.1:3001/api/unsubscribe -d '{"token":"..."}'`; Postgres MCP confirms `status` = unsubscribed.
- **Expect:** 200; status updated; idempotent on repeat.

### SUB-10 — Feedback rating (token-gated)
- **Story:** As a reader, I rate an issue from a link in the email.
- **Verify:** `curl -s -X POST http://127.0.0.1:3001/api/feedback -d '{"token":"...","rating":...}'`; Postgres MCP: `select * from feedback_events order by created_at desc limit 1;`
- **Expect:** 200; a `feedback_events` row with correct `tenant_id`.

### SUB-11 — Host-based tenant resolution (subdomain / custom domain)
- **Story:** As a reader on `acme.<base>` (or a custom domain), I see Acme's content only.
- **Verify:** With ≥2 active tenants having distinct slugs, `curl -s -H 'Host: <slugA>.localhost' http://127.0.0.1:3001/api/branding` vs `-H 'Host: <slugB>.localhost'`. Compare to `/api/home` per host.
- **Expect:** Branding + content differ per host; tenant A's host never returns tenant B's data. `resolve-tenant.ts` maps host → tenant.

### SUB-12 — Slug rename 301 redirect
- **Story:** As a reader hitting an old slug after a tenant renamed, I'm redirected to the new slug.
- **Verify:** Rename a tenant's slug (via onboarding/settings or SQL on `tenants.previous_slug`), then `curl -sI -H 'Host: <oldSlug>.localhost' http://127.0.0.1:3001/`.
- **Expect:** 301 to the new slug host. (EDGE-002.)

### SUB-13 — Static/legal pages + 404
- **Story:** As a reader, I can view privacy, terms, the "built" colophon, and get a clean 404 for unknown public paths.
- **Verify:** UI navigate `/privacy`, `/terms`, `/built`, `/this-does-not-exist`.
- **Expect:** Each legal/static page renders; unknown path renders the public 404 (not a blank screen / JS crash).

### SUB-14 — Public analytics config
- **Story:** As the frontend, I fetch PostHog config so client analytics can initialize.
- **Verify:** `curl -s http://127.0.0.1:3001/api/public/analytics-config`.
- **Expect:** 200 with config (token/host or `{enabled:false}` when PostHog unset). No secrets leaked (no server API key).

### SUB-15 — Inbound webhooks (SES/SNS) *(signature-gated; observe-only)*
- **Story:** As the email provider, I POST delivery/bounce events; the system records them against the right tenant.
- **Verify:** Inspect route + handler at `packages/api/src/routes` (webhooks) — confirm signature verification exists. Manual POST without a valid signature should be rejected. If a sample signed payload is available, POST it and check `ses_events`.
- **Expect:** Unsigned/invalid → rejected; valid → `ses_events` row with `tenant_id`. *(Likely UNTESTABLE without AWS signing — record as NOTE if so.)*

---

## 2. Admin (`tenant_admin`)

### ADM-01 — Signup creates tenant + tenant_admin
- **Story:** As a new operator, I sign up and get my own tenant in `pending_setup`, landing in onboarding.
- **Verify:** `curl -c /tmp/tenantA.txt -s -X POST http://127.0.0.1:3001/api/auth/signup -H 'content-type: application/json' -d '{"name":"Acme News","email":"acme-admin@example.com","password":"hunter2hunter2","confirmPassword":"hunter2hunter2"}'`. Postgres MCP: `select u.role, u.tenant_id, t.status, t.slug from users u join tenants t on t.id=u.tenant_id where u.email='acme-admin@example.com';`
- **Expect:** 201 `{next:"onboarding", user:{role:"tenant_admin"}}`; cookie set; user has `role=tenant_admin` + new `tenant_id`; tenant `status=pending_setup`, slug `pending-XXXXXX`. Duplicate email → 4xx. Mismatched confirmPassword → 400.

### ADM-02 — Login
- **Story:** As a returning admin, I log in with email + password.
- **Verify:** `curl -c /tmp/tenantA.txt -s -X POST http://127.0.0.1:3001/api/auth/login -d '{"email":"acme-admin@example.com","password":"hunter2hunter2"}'`. UI: `/admin/login` form → submit.
- **Expect:** 200 `{ok:true,user:{role:"tenant_admin",tenantId:<id>}}`; cookie set. Wrong password → 401 `{error:"invalid_credentials"}`.

### ADM-03 — Session introspection (`/api/auth/me`)
- **Story:** As the web shell, I fetch the current user + tenant to render the right chrome.
- **Verify:** `curl -b /tmp/tenantA.txt -s http://127.0.0.1:3001/api/auth/me`.
- **Expect:** 200 `{user, tenant:{slug,status,...}, impersonation:null}`. No cookie → 401/empty.

### ADM-04 — Logout
- **Story:** As an admin, I log out and my session is cleared.
- **Verify:** `curl -b /tmp/tenantA.txt -c /tmp/tenantA.txt -s -X POST http://127.0.0.1:3001/api/auth/logout`; then `GET /api/auth/me` with same jar.
- **Expect:** Logout 200; subsequent `/me` is unauthenticated.

### ADM-05 — Forgot / reset password
- **Story:** As an admin who forgot my password, I request a reset link and set a new password.
- **Verify:** `POST /api/auth/forgot {email}`; fetch reset token from Redis (`scan_keys auth:reset:*`); `POST /api/auth/reset {token,password,confirmPassword}` (confirmPassword is **required**); then login with the new password. (Paths are `/api/auth/forgot` and `/api/auth/reset`.)
- **Expect:** Forgot → 200 (always, no user enumeration); token stored in Redis; reset → 200 and one-time (second use fails); new password logs in.

### ADM-06 — Onboarding wizard + activate
- **Story:** As a new admin, I complete name → slug → headline → prompts → sources → schedule, then activate; my tenant goes `active` and the pipeline is scheduled.
- **Verify:**
  1. UI: log in as fresh signup → `RequireOnboarding` lands on `/admin/onboarding`. Step through the wizard, screenshotting each step.
  2. API: `GET /api/onboarding` (state), `PATCH /api/onboarding` (per-step), `POST /api/onboarding/activate`.
  3. Postgres MCP: tenant `status` → `active`; `user_settings` row created; `sources` rows created.
  4. Redis MCP: scan for repeatable/scheduled pipeline + collector jobs for this tenant.
- **Expect:** Wizard advances; activate validates all required steps (`name,slug,headline,prompts,sources,schedule`); tenant becomes `active`; settings/sources persisted with `tenant_id`; scheduled jobs present. Activating with a missing step → 4xx.

### ADM-07 — Slug availability check
- **Story:** As an admin choosing a slug, I get instant feedback if it's taken or reserved.
- **Verify:** `GET /api/onboarding/slug-available?slug=acme` (and a reserved word like `admin`, `www`, and an existing slug).
- **Expect:** Available → ok; reserved/taken → unavailable with reason; case-insensitive (citext); >63 chars rejected.

### ADM-08 — LLM-generated onboarding prompts
- **Story:** As an admin, I let the system draft my ranking/shortlist prompts from my newsletter description.
- **Verify:** `POST /api/onboarding/generate-prompts {description...}`.
- **Expect:** 200 with generated prompt text. *(Requires `ANTHROPIC_API_KEY`; if absent, record UNTESTABLE/NOTE.)*

### ADM-09 — Source discovery (LLM + Tavily)
- **Story:** As an admin, I get suggested sources for my topic instead of adding them all by hand.
- **Verify:** `POST /api/onboarding/discover-sources {topic...}`.
- **Expect:** 200 with suggested sources. *(Requires `TAVILY_API_KEY` + LLM; if absent, record UNTESTABLE/NOTE.)*

### ADM-10 — Logo upload
- **Story:** As an admin, I upload my logo and it shows on my public site.
- **Verify:** `POST /api/onboarding/logo` (multipart). Postgres MCP: `tenants.logo_bytes`/`logo_content_type` set. Then `curl -sI /api/branding/logo` on that tenant's host.
- **Expect:** Upload 200; bytes persisted; public logo endpoint serves them.

### ADM-11 — Dashboard / run list
- **Story:** As an admin, my dashboard shows my runs and their statuses.
- **Verify:** UI `/admin` (after onboarding) → snapshot. API `curl -b /tmp/tenantA.txt /api/runs`.
- **Expect:** 200; lists only this tenant's runs.

### ADM-12 — Trigger a pipeline run
- **Story:** As an admin, I click "Run Now" and a collection→rank pipeline starts for my tenant.
- **Verify:** `curl -b /tmp/tenantA.txt -s -X POST http://127.0.0.1:3001/api/runs -H 'content-type: application/json' -d '{"topN":5,"hn":{"sinceDays":2}}'`. Redis MCP: scan the BullMQ processing queue for the enqueued `run-process` job; confirm payload carries `tenantId`. Postgres MCP: a run row appears.
- **Expect:** 200 `{runId,status:"collecting",startedAt}`; job enqueued with correct `tenantId`; pipeline worker logs collection. Must specify ≥1 of hn/reddit/web else 400.

### ADM-13 — Run observability
- **Story:** As an admin, I watch a run progress through stages with per-stage telemetry.
- **Verify:** UI `/admin/runs/<runId>` → snapshot during/after run. API `GET /api/admin/runs/<runId>`.
- **Expect:** Stage timeline (collect/dedup/shortlist/rank/recap), counts, status transitions to `completed` (or shows failure detail). Tenant-scoped.

### ADM-14 — Cancel a run
- **Story:** As an admin, I cancel an in-flight run.
- **Verify:** Start a run, `POST /api/runs/<runId>/cancel`. Check status → `cancelled` (DB + UI).
- **Expect:** 200; status becomes `cancelled`; no further stages run.

### ADM-15 — Review / curation (reorder, remove, add, save)
- **Story:** As an admin, I reorder ranked items, remove some, optionally add one, and save — which archives the issue.
- **Verify:** UI `/admin/review/<completedRunId>`: drag-reorder, remove an item, save. API `PATCH /api/admin/archives/<runId>` with reordered ids. Postgres MCP: `run_archives.shortlisted_item_ids`/saved order updated; a `review_edits` row written.
- **Expect:** Save 200; order persisted; `review_edits` recorded with `tenant_id`; redirect to archive view.

### ADM-16 — Sources management (CRUD)
- **Story:** As an admin, I add, edit, enable/disable, and delete collection sources.
- **Verify:** `GET /api/sources` (auth) lists; `POST /api/sources {...}` add; `PATCH /api/sources/:id` edit; `DELETE /api/sources/:id`. Postgres MCP: rows have `tenant_id`.
- **Expect:** All require auth (no cookie → 401). CRUD persists; sources scoped to tenant.

### ADM-17 — Settings: schedule + ranking/shortlist prompts
- **Story:** As an admin, I set my daily send time/timezone and tune my ranking + shortlist prompts.
- **Verify:** `GET /api/settings`; `PUT /api/settings {schedule, prompts...}`. UI `/admin/settings`. Postgres MCP: `user_settings` updated; Redis: repeatable job reflects new schedule.
- **Expect:** 200; persisted to `user_settings` (one row per tenant); schedule change reschedules the cron job.

### ADM-18 — Settings: notifications (email alerts + Slack)
- **Story:** As an admin, I set an alert email + Slack webhook for run/pipeline notifications.
- **Verify:** `GET/PUT /api/settings/notifications`. Postgres MCP: `tenants.notify_email`/`slack_webhook`.
- **Expect:** 200; persisted. *(Do not POST to a real Slack webhook — verify the value is stored, not that an alert fires externally.)*

### ADM-19 — Settings: sending domain (DNS records)
- **Story:** As an admin, I configure my email sending domain and see the DNS records to add.
- **Verify:** `GET/PUT /api/settings/domain`. Postgres MCP: `tenants.sending_domain_name`.
- **Expect:** 200; returns DNS record set to configure; persists. *(Provider verification may be UNTESTABLE locally — NOTE.)*

### ADM-20 — Settings: feature flags
- **Story:** As an admin, I toggle canon (must-read), deliverability, and eval features for my tenant.
- **Verify:** `GET/PUT /api/settings/features {featureCanon,featureDeliverability,featureEval}`. Confirm `/admin/eval` and `/admin/must-read` appear/disappear accordingly.
- **Expect:** 200; flags persist per-tenant; UI surfaces gate on the flags.

### ADM-21 — Social credentials (LinkedIn / Twitter OAuth connect)
- **Story:** As an admin, I connect my LinkedIn/Twitter so issues can be auto-posted.
- **Verify:** `GET /api/admin/social-credentials` (status). Inspect OAuth start endpoints `/api/admin/social-credentials/{linkedin,twitter}/oauth`. Postgres MCP: `social_credentials` rows on connect (encrypted), `tenant_id` scoped.
- **Expect:** Status reflects connected/not; OAuth start returns a redirect URL; stored creds are encrypted + tenant-scoped. *(Full OAuth round-trip UNTESTABLE without app creds — NOTE; verify status + storage shape.)*

### ADM-22 — Publish channels on review-save (email / LinkedIn / X)
- **Story:** As an admin, saving a reviewed issue broadcasts it to my enabled channels.
- **Verify:** With a tenant that has channels enabled, save a review (ADM-15). Redis MCP: confirm `email-send`/`linkedin-post`/`twitter-post` jobs enqueued. Postgres MCP: `email_sends` rows / `*_posted_at` / `email_sent_at` timestamps after worker runs.
- **Expect:** Enabled channels enqueue publish jobs idempotently (re-save doesn't double-send). *(Actual external posting UNTESTABLE without creds — verify enqueue + idempotency markers, NOTE on external send.)*

### ADM-23 — Analytics / engagement dashboard
- **Story:** As an admin, I see opens/clicks/feedback engagement for my issues.
- **Verify:** UI `/admin/analytics`; API `GET /api/admin/analytics`.
- **Expect:** 200; metrics scoped to tenant; renders without error (empty state OK if no sends yet).

### ADM-24 — Eval (ranking) UI
- **Story:** As an admin, I create fixtures and grade ranking quality to tune the pipeline.
- **Verify:** With `featureEval` on: UI `/admin/eval`, `/admin/eval/runs`, `/admin/eval/fixtures/new`, `/admin/eval/grade/:id`. API `/api/admin/eval/*`.
- **Expect:** Pages load; fixture create + grade persist (tenant-scoped). Gated by `featureEval`.

### ADM-25 — Must-read management (CRUD)
- **Story:** As an admin, I curate must-read entries shown on my public `/must-read`.
- **Verify:** UI `/admin/must-read`, `/admin/must-read/new`, `/admin/must-read/:id`. API `/api/admin/must-read`. Postgres MCP: `must_read_entries` with `tenant_id`.
- **Expect:** CRUD persists, tenant-scoped; reflects on public must-read. Gated by `featureCanon`.

### ADM-26 — Collector health check
- **Story:** As an admin, I trigger a health check to see if my sources are reachable.
- **Verify:** `GET /api/admin/collector-health` (or its trigger). Redis/DB for results.
- **Expect:** 200; per-source health/status returned.

### ADM-27 — Tenant data isolation *(cross-cutting, critical)*
- **Story:** As admin of tenant A, I can never see or mutate tenant B's runs, sources, settings, subscribers, archives.
- **Verify:** Create tenants A and B (separate signups + cookie jars). As A, attempt to read B's resources: list runs/sources/archives and confirm B's never appear. Attempt `GET /api/admin/runs/<B-runId>` with A's cookie. Postgres MCP: confirm every tenant-owned table query filters by `tenant_id`.
- **Expect:** A sees only A's data; cross-tenant id access → 403/404 (never B's data). Any leak → **Blocker** finding.

---

## 3. SuperAdmin (`super_admin`)

### SUP-01 — Super-admin creation (seed)
- **Story:** As the platform owner, I provision a super-admin account out-of-band.
- **Verify:** `pnpm --filter @newsletter/scripts seed:super-admins`; capture the printed reset link; set password at `/reset-password?token=...`. Postgres MCP: `select role, tenant_id from users where email='super@vertexcover.io';`
- **Expect:** User created with `role=super_admin`, `tenant_id=null`; reset link works once; idempotent (re-run skips existing).

### SUP-02 — Super-admin login routes to platform console
- **Story:** As a super-admin, logging in takes me to the tenant list, not a tenant dashboard.
- **Verify:** Login as super_admin (cookie jar `/tmp/super.txt`). UI: navigate `/admin` → `RequireOnboarding` redirects an idle (non-impersonating) super-admin to `/admin/tenants`.
- **Expect:** `/api/auth/me` shows `role:super_admin, tenant:null`; UI lands on `/admin/tenants`.

### SUP-03 — Tenant list + stats
- **Story:** As a super-admin, I see all tenants and key stats.
- **Verify:** `curl -b /tmp/super.txt /api/super/tenants`. UI `/admin/tenants`.
- **Expect:** 200; lists all tenants (A, B, agentloop, etc.) with stats. A `tenant_admin` cookie on this endpoint → 403.

### SUP-04 — Impersonate a tenant (audited)
- **Story:** As a super-admin, I impersonate a tenant to debug their dashboard, and the action is audited.
- **Verify:** `curl -b /tmp/super.txt -c /tmp/super.txt -X POST /api/super/impersonate/<tenantId>`. Then `GET /api/auth/me` → shows `impersonation.tenant`. UI: `/admin` now renders that tenant's dashboard with an impersonation banner. Postgres MCP: `select * from audit_log order by created_at desc limit 1;`
- **Expect:** Impersonation cookie issued (1h); context tenant swaps to target while original super-admin identity is retained; `audit_log` row records actor + target + start.

### SUP-05 — Exit impersonation
- **Story:** As a super-admin, I stop impersonating and return to the platform console.
- **Verify:** `POST /api/super/impersonate/exit`; `GET /api/auth/me` → impersonation cleared. Postgres MCP: audit_log stop row.
- **Expect:** Impersonation cookie cleared; back to super-admin context; audit_log records the stop.

### SUP-06 — App-level OAuth credentials
- **Story:** As a super-admin, I configure the shared LinkedIn OAuth app, Twitter collector key, and Twitter OAuth client used across tenants.
- **Verify:** `GET /api/super/app-credentials` (status). `PUT /api/super/app-credentials/linkedin-client`, `.../twitter-collector`, `.../twitter-client` with sample values. `DELETE /api/super/app-credentials/:key`. Postgres MCP: `app_credentials` rows (no `tenant_id`), encrypted.
- **Expect:** 200; values stored encrypted at app scope; status reflects configured/empty; delete clears. `tenant_admin` → 403.

### SUP-07 — RequireSuperAdmin guard (negative)
- **Story:** As a tenant_admin, I cannot reach the platform console or super APIs.
- **Verify:** With `/tmp/tenantA.txt`: UI navigate `/admin/tenants` → redirected to `/admin`. API `curl -b /tmp/tenantA.txt /api/super/tenants` and a `PUT /api/super/app-credentials/...`.
- **Expect:** UI redirect to `/admin`; API endpoints → 403. No super data leaks to tenant_admin.

### SUP-08 — Impersonation audit trail
- **Story:** As a platform owner, I can see who impersonated whom and when.
- **Verify:** After SUP-04/05, Postgres MCP: `select actor_user_id, target_tenant_id, action, created_at from audit_log order by created_at desc;`
- **Expect:** Start + stop rows with correct actor (super-admin userId) and target tenant.

---

## Coverage matrix (feature → verification methods)

| Area | UI | curl | Postgres | Redis |
|---|:--:|:--:|:--:|:--:|
| Public read (SUB-01..06,13,14) | ✓ | ✓ | – | – |
| Subscribe lifecycle (SUB-07..10) | – | ✓ | ✓ | ✓ (tokens) |
| Host/slug resolution (SUB-11,12) | – | ✓ | ✓ | – |
| Auth (ADM-01..05, SUP-01,02) | ✓ | ✓ | ✓ | ✓ (reset tokens) |
| Onboarding (ADM-06..10) | ✓ | ✓ | ✓ | ✓ (scheduled jobs) |
| Runs & pipeline (ADM-11..14) | ✓ | ✓ | ✓ | ✓ (BullMQ) |
| Review & publish (ADM-15,22) | ✓ | ✓ | ✓ | ✓ (publish jobs) |
| Sources/settings (ADM-16..20,26) | ✓ | ✓ | ✓ | ✓ (reschedule) |
| Analytics/eval/must-read (ADM-23..25) | ✓ | ✓ | ✓ | – |
| Tenant isolation (ADM-27) | – | ✓ | ✓ | – |
| Super-admin (SUP-03..08) | ✓ | ✓ | ✓ | – |

---

## Known un-testable-locally items (record as NOTE, not FAIL)

These depend on external credentials/providers not guaranteed in local dev. If creds are absent, record **UNTESTABLE/NOTE** rather than FAIL, and verify the *internal* contract (enqueue, storage, status shape) instead:
- Real email delivery (Resend/SES) — verify `email_sends`/jobs, not inbox.
- LinkedIn / Twitter posting + OAuth round-trip — verify storage + enqueue + status.
- LLM prompt generation / Tavily source discovery — needs `ANTHROPIC_API_KEY` / `TAVILY_API_KEY`.
- SES/SNS inbound webhooks — needs valid AWS signatures.
- Slack alerts — verify stored config only; never POST to a real webhook.
