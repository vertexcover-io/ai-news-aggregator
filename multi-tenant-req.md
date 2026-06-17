# VER-110: Add Support For Multi Tenancy

**Linear issue:** https://linear.app/vertexcover/issue/VER-110/add-support-for-multi-tenancy
**Team:** Vertexcover · **Project:** AI Newsletter · **Status:** Todo · **Priority:** No priority · **Labels:** Epic
**Created by:** Ritesh Kadmawala · **Created:** 2026-05-10 · **Updated:** 2026-06-10
**Git branch:** `aman/ver-110-add-support-for-multi-tenancy`

---

## 1. Overview

Convert the system from a single-admin internal tool (built for Vertexcover) into a **multi-tenant product** where external customers sign up and run their own AI newsletters. Each tenant gets an isolated newsletter — its own sources, prompts, schedule, branding, subscribers, and delivery — running on the same shared infrastructure.

Vertexcover continues to operate its own newsletter (AGENTLOOP) as a normal tenant ("tenant 0").

## 2. Roles

| Role | How created | Can do |
|------|-------------|--------|
| **Super admin** (Vertexcover) | Seeded via migration/script — **never** through public signup | Access any tenant account; list all tenants; open/impersonate any tenant's dashboard as-is; owns shared app-level secrets |
| **Tenant admin** | Public signup (name, email, password) | Owns one tenant; manages that tenant's newsletter end-to-end. **One user per tenant** (no teams/invites in v1) |
| **End subscriber** | Subscribes on a tenant's public site | Receives that tenant's newsletter; gives feedback; unsubscribes. Scoped to a single tenant |

## 3. Locked Decisions

| Area | Decision |
|------|----------|
| **Domains** | Public newsletter on `<slug>.ourdomain.com` (Substack-style, self-picked slug); admin + signup on a single `app.ourdomain.com` |
| **Signup** | Fully open, no usage caps in v1 |
| **Email delivery** | Per-tenant verified sending domain (SPF/DKIM via Resend/SES) |
| **Twitter** | OAuth posting (new flow) + a shared **internal** collector; collector cookies are never exposed to tenant admins; needs throttling |
| **Isolation** | App-level `tenant_id` filtering, enforced by an extended `enforce-repository-access` lint rule |
| **Schedule load** | Global concurrency cap + start-time jitter + per-source rate limits / shared collection caches |
| **Source discovery** | LLM + Tavily suggestions surfaced as click-to-add pills, plus manual add |
| **Custom domains** | Wildcard subdomains only in v1; vanity CNAME domains deferred |
| **Asset storage** | Logos stored in Postgres (`bytea`/base64), size-constrained |
| **Slack notifications** | Tenant pastes an Incoming Webhook URL (stored encrypted) |
| **Onboarding** | Resumable wizard; newsletter stays **inactive** until required steps complete |

## 4. Assumptions

1. **Two-tier credentials.** App-level secrets (LinkedIn client ID/secret, Rettiwt collector cookies) live at super-admin/env level, shared across tenants and invisible to tenant admins. A tenant only holds *its own* OAuth tokens (LinkedIn + Twitter posting) and its own sending-domain config.
2. **Tenant 0 backfill (zero data loss — high priority).** The existing AGENTLOOP newsletter is migrated wholesale into the multi-tenant system as the first tenant. We create the AGENTLOOP tenant + its tenant-admin account and re-point **every** existing row to it. No AGENTLOOP data is lost or orphaned; AGENTLOOP keeps running as a normal tenant throughout. See §6.1 for the migration deliverable.
3. **Auth completeness.** Signup collects **name, email, password, confirm password**. **No email verification** — the tenant is logged in immediately. **Forgot/reset password** is still in scope.
4. **Subdomain changeable early** with an old→new redirect (archive URLs and email links embed the slug), guarded by a reserved-word blocklist (`app`, `www`, `admin`, `api`, `mail`, …).

---

## 5. User Stories

### 5.1 Tenant admin — sign up

1. Lands on `app.ourdomain.com`, clicks **Sign up**.
2. Enters **name, email, password, confirm password**. Account is created and the tenant is logged in immediately and dropped into the **onboarding wizard** (no email verification step).
3. (Later, if needed) uses **Forgot password** to reset via emailed link.

### 5.2 Tenant admin — onboarding wizard (resumable carousel)

A multi-step carousel with a **live preview on the right**. The preview is a real rendering of the **public home / archive-listing page** with the tenant's branding applied as they type — **newsletter name, logo, and headline** populate their real slots, while **all other content (today's issue, archive list, dates, summaries) is shown as lorem-ipsum placeholders** so the tenant can see exactly how their landing page will look. Progress is persisted; the tenant can leave and resume. The newsletter cannot go live until the required steps are complete.

The branding fields that drive the live preview are:

1. **Newsletter name** — display name for the publication; shown in the preview masthead.
2. **Subdomain (Substack-style)** — types a slug; live availability + validation check (lowercase alphanumeric + hyphens, unique, not a reserved word). Resulting URL: `<slug>.ourdomain.com`.
3. **Logo** — upload with size constraints; stored in Postgres; shown in the preview masthead.
4. **Headline** — homepage headline/tagline; shown in the preview hero.
5. **Newsletter details → custom prompts** — the tenant writes a short description of what their newsletter is about. We take that blurb + our default ranking/shortlist prompts as a reference and **generate tailored ranking and shortlist prompts** for them (editable).
6. **Social & email settings** — connect LinkedIn (OAuth) and Twitter (OAuth) for posting; configure the sending email. (No raw LinkedIn client ID/secret or Twitter collector cookies are ever shown.)
7. **Sources** — auto-suggested per category as **click-to-add pills**, generated via LLM + Tavily from the newsletter description; the tenant clicks the ones to add and can also **add sources manually**; can remove any.
8. **Schedule** — pipeline time, publish/email times, timezone.

On completion the newsletter is **activated** and scheduled runs begin.

### 5.3 Tenant admin — daily use

1. Pipeline runs on the tenant's schedule (collect → dedup → shortlist → rank → recap), independently from every other tenant.
2. When a run is ready for review, the tenant is **notified** (email and/or Slack).
3. Opens their dashboard (`app.ourdomain.com`, scoped to their tenant — the current admin dashboard, now tenant-scoped) and reviews: reorder/curate items, edit digest copy, add posts from the pool.
4. Publishes → the digest emails go **only to that tenant's subscribers**, and posts to the tenant's connected LinkedIn/Twitter.
5. Manages settings any time: sources, prompts, schedule, branding, notifications. Optional features (**Deliverability, Canon, Eval**) are **off by default** and can be enabled. **Shortlist size is hidden from the tenant dashboard** — it stays an internal/default value the tenant cannot see or edit.
6. On errors (collector failures, run crashes) the tenant receives error alerts via their configured channels.

### 5.4 End subscriber

1. Visits the tenant's public site `<slug>.ourdomain.com` — a simple homepage showing **today's issue** and a **list of older archives**, branded with the tenant's logo/headline.
2. Subscribes with their email (double opt-in confirmation).
3. Receives the tenant's newsletter from the tenant's verified sending domain.
4. Can give one-tap feedback and unsubscribe.

### 5.5 Super admin (Vertexcover)

1. Logs in on `app.ourdomain.com` with a seeded super-admin account.
2. Sees a **list of all tenants**.
3. Clicks a tenant → **opens that tenant's admin dashboard as-is** (impersonation/act-as) for support/debugging.
4. Manages shared app-level secrets (LinkedIn client, Twitter collector) that tenants never see.

---

## 6. Implementation Breakdown (in build order)

Each piece below gets its own brainstorm → spec → plan → build cycle. Suggested order: **1 → (2 ∥ 3) → 4 → 5 → 6 → 7**. #1 unblocks everything; #2 and #3 are largely independent; #4 needs both.

### 6.1 Tenancy foundation *(the spine — everything depends on it)*
- `tenants` and `users` tables (role: `super_admin` / `tenant_admin`); per-user sessions replacing the shared `ADMIN_PASSWORD` gate.
- Signup (name, email, password, confirm password) / login / forgot-reset password. No email verification.
- `tenant_id` added to all root tables.
- **AGENTLOOP migration / seed (HIGH PRIORITY — zero data loss).** A repeatable, idempotent migration that stands up AGENTLOOP as the first tenant:
  - Create the **AGENTLOOP tenant** (slug, branding) and its **tenant-admin account** (so we can log in as that tenant on day one); seed the super-admin account(s) separately.
  - Re-point **every existing row** to the AGENTLOOP tenant_id — across `raw_items`, `run_archives`, `run_logs`, `review_edits`, `email_sends`, `subscribers`, `feedback_events`, `ses_events`, `eval_runs`, `must_read_entries`, the singleton `user_settings`, and `social_credentials` / `social_tokens`.
  - Migrate the current singleton `user_settings` (sources, prompts, schedule, feature flags) and connected social tokens/credentials into AGENTLOOP's per-tenant config so its pipeline and publishing keep working unchanged.
  - Enable AGENTLOOP-only features for that tenant (Canon/Must Read on, `/built` page).
  - Verify post-migration: counts match pre-migration, no NULL tenant_id remains, AGENTLOOP archives/subscribers/runs resolve under the tenant, and a dry-run pipeline succeeds. Run on a copy first; reversible/guarded.
- Repository factories carry tenant context; extend the `enforce-repository-access` lint rule to require tenant scoping.
- Host→tenant resolution middleware (`<slug>.ourdomain.com` → tenant_id); `app.*` vs `<slug>.*` split.
- Super-admin seed + impersonation / act-as.

### 6.2 Branding + public homepage redesign + logo storage
- De-hardcode AGENTLOOP branding (Masthead/Footer); pull logo/headline/name from tenant context.
- Redesigned simpler homepage: **today's news + list of older archives**.
- Logo upload + storage/serving from Postgres (size-constrained).
- **Per-tenant nav, not a fixed AGENTLOOP nav.** The public Masthead/Footer links are derived from what a tenant actually has enabled. Specifically:
  - **Must Read** (`/must-read`) is AGENTLOOP's Canon — it only appears for tenants with the **Canon** feature enabled (off by default; AGENTLOOP has it on).
  - **How it's Built** (`/built`) is a bespoke AGENTLOOP-only page — **scoped to tenant 0 only**, hidden from every other tenant's public site and nav.
- General per-tenant custom/static pages (so any tenant could add their own "Built"-style page) are **deferred** — see §7.

### 6.3 Per-tenant pipeline + scheduling robustness
- Thread `tenant_id` through BullMQ job payloads; workers load **tenant settings** instead of the singleton row.
- Per-tenant scheduler keys; reconcile schedules per tenant.
- **Robustness for shared schedules:** global concurrency cap (overflow waits), start-time jitter, global per-external-source rate limiters / shared collection caches.
- Throttle the shared Twitter collector to avoid bans across tenants.

### 6.4 Onboarding wizard
- Resumable carousel (§5.2) with persisted partial progress and an activation gate.
- LLM prompt generation from the newsletter blurb (ranking + shortlist).
- Source discovery: LLM + Tavily → click-to-add pills + manual add (likely a real `sources` table).
- Live homepage preview.

### 6.5 Credentials rework + Twitter OAuth posting + per-tenant email-domain verification
- Re-key `social_credentials` / `social_tokens` from platform-only to `(tenant_id, platform)`.
- Two-tier split: app-level (shared, super-admin) vs tenant-level (OAuth tokens).
- New **Twitter OAuth posting** flow (replacing manual API keys for tenants).
- Per-tenant sending-domain verification via Resend/SES.

### 6.6 Super-admin console
- Tenant list page → open/impersonate a tenant's dashboard as-is.

### 6.7 Per-tenant notifications + optional-feature flags
- Email + Slack (incoming webhook, encrypted) for **review-ready** and **error** alerts.
- Per-tenant toggles for **Deliverability**, **Canon**, **Eval** — all **off by default**. The **Canon** toggle also controls whether the public **Must Read** page and its nav link are shown for that tenant.

---

## 7. Open Questions / Deferred to later versions

- Vanity custom domains (CNAME + per-domain TLS/ACME + verification flow) — deferred past v1.
- Billing / plans / usage metering — out of scope for v1 (open signup, no caps).
- Per-tenant teams / multiple users per tenant — out of scope (single user per tenant).
- Tenant lifecycle: suspend / delete (GDPR) / data retention — to define.
- Per-tenant model selection (ranking/shortlist model is currently a global env var).
- General per-tenant custom/static pages (letting any tenant publish bespoke pages like AGENTLOOP's "How it's Built") — deferred; in v1 the "Built" page is hard-scoped to tenant 0.
