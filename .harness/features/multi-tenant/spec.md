# SPEC: Multi-Tenancy (VER-110)

**Source:** `.harness/features/multi-tenant/design.md`
**Generated:** 2026-06-10

> Single combined spec for the whole epic. Each REQ carries its design F#/NF# in brackets for traceability; each EDGE carries its EC#. Priority: **Must** = required for v1 cutover, **Should** = important, **Could** = nice-to-have.

## Requirements

### Accounts & auth

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|----------------------|----------|
| REQ-001 | Event-driven | When a visitor submits signup with name, email, password, and matching confirm-password for an unregistered email, the system shall create a `tenant_admin` user + a tenant in `pending_setup`, set a session, and route to the wizard. [F1] | A user row + tenant row (status `pending_setup`) exist; response sets the session cookie and redirects to the wizard | Must |
| REQ-002 | Unwanted | If the confirm-password does not match the password, then the system shall reject signup and create no rows. [F2] | Response is a 4xx field error; no user/tenant row created | Must |
| REQ-003 | Unwanted | If the signup email is already registered, then the system shall reject signup with an "email already in use" error. [F3] | Response is a 4xx with that error; no second account created | Must |
| REQ-004 | Event-driven | When a user requests a password reset for a known email, the system shall send a single-use, short-lived reset link that lets them set a new password; unknown emails shall produce no enumeration difference. [F4] | Reset email sent for known email; identical response shape/timing for unknown email; token usable once, expires | Must |
| REQ-005 | Ubiquitous | The system shall authenticate requests via a stateless signed cookie whose payload encodes user id, tenant id, and role, signed with `SESSION_SECRET`. [F5] | Decoded cookie yields {userId, tenantId, role}; tampered signature rejected | Must |
| REQ-006 | Unwanted | If a request attempts to create a `super_admin` via the public signup path, then the system shall refuse to assign that role. [F6] | No signup input can produce a `super_admin` row | Must |
| REQ-007 | Unwanted | If the session cookie is absent, invalid, or expired, then the system shall return 401 for tenant/admin API routes. [F7] | Protected route returns 401 without a valid cookie | Must |

### Tenancy & isolation

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|----------------------|----------|
| REQ-010 | Ubiquitous | The system shall associate every tenant-owned row with a `tenant_id`. [F8] | Every tenant-owned table has a non-null `tenant_id` after migration | Must |
| REQ-011 | Event-driven | When a request is handled, the system shall resolve the active tenant from session (admin app) or request Host (public site) and scope data access to it. [F9] | Admin request scopes to session tenant; public request scopes to Host tenant | Must |
| REQ-012 | Ubiquitous | The system shall filter every repository read/write of tenant-owned data by the resolved `tenant_id`. [F10] | Repository queries include a tenant predicate; verified by isolation test | Must |
| REQ-013 | Unwanted | If a request references a resource id owned by another tenant, then the system shall respond as not-found. [F11] | Cross-tenant id returns 404, not the row | Must |
| REQ-014 | Ubiquitous | The build shall fail when a repository accesses a tenant-owned table without a tenant scope. [F12] | Lint rule errors on an unscoped tenant-table query in a fixture | Must |

### Host → tenant routing

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|----------------------|----------|
| REQ-020 | Event-driven | When a request arrives on the app host, the system shall treat it as the admin/signup surface with tenant derived from session. [F13] | App-host request never resolves tenant from Host | Must |
| REQ-021 | Event-driven | When a request arrives on `<slug>.<root>`, the system shall resolve the tenant by slug and serve its public site; an unknown slug serves not-found. [F14] | Known slug serves that tenant; unknown slug → not-found page | Must |
| REQ-022 | Event-driven | When a request arrives on AGENTLOOP's configured custom domain, the system shall resolve it to tenant 0 via a hardcoded domain→tenant map. [F15] | Configured domain resolves to tenant 0 | Must |
| REQ-023 | Event-driven | When a tenant's slug changes, the system shall 301-redirect the old slug host to the new slug. [F16] | Request to old slug returns 301 to new slug | Should |

### Onboarding wizard

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|----------------------|----------|
| REQ-030 | Ubiquitous | The system shall persist wizard progress per tenant so a returning tenant resumes at the furthest reached step. [F20] | Re-entering the wizard restores saved fields and step | Must |
| REQ-031 | State-driven | While a tenant is in `pending_setup`, the system shall keep the public site inactive and run no scheduled pipeline. [F21] | Public host returns inactive/not-found; no scheduler entry exists | Must |
| REQ-032 | Ubiquitous | The wizard shall accept name, slug, headline, topic strip, optional subtagline, optional logo, prompt-generation input, optional social/email, ≥1 source, and a schedule. [F22] | Each field persists to the tenant config | Must |
| REQ-033 | Event-driven | When a tenant types a slug, the system shall validate it (lowercase alphanumeric+hyphen, globally unique, not reserved) and report available/taken/invalid. [F23] | Valid+free → available; taken → taken; reserved/format-bad → invalid | Must |
| REQ-034 | Ubiquitous | The wizard shall render a live preview of the public home page (existing layout) applying the tenant's name, logo, headline, topic strip, and subtagline, with all other content as lorem-ipsum. [F24] | Preview reflects typed name/logo/headline/strip/subtagline; remaining content is placeholder | Must |
| REQ-035 | Event-driven | When the required steps (name, slug, headline, prompts, ≥1 source, schedule) are complete, the system shall enable Activate, set the tenant `active`, and begin scheduled runs. [F25] | Activate succeeds; tenant `active`; scheduler entry created | Must |
| REQ-036 | Event-driven | When a tenant submits a newsletter description, the system shall generate editable ranking and shortlist prompts derived from that description plus the default prompts. [F26] | Two non-empty prompts returned, editable, persisted | Must |
| REQ-037 | Ubiquitous | The wizard shall present LLM+Tavily source suggestions as click-to-add candidates and allow manual add/remove. [F27] | Suggestions render; clicking adds a source row; manual add/remove works | Must |
| REQ-038 | Unwanted | If required steps are incomplete, then the system shall block activation and indicate which steps remain. [F28] | Activate disabled/refused; missing steps listed | Must |
| REQ-039 | Unwanted | If an uploaded logo exceeds 512 KB or is not in {PNG, JPEG, SVG, WebP}, then the system shall reject it and leave any existing logo unchanged. [F29] | Oversized/wrong-type upload returns error; prior logo intact | Must |

### Branding & public site

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|----------------------|----------|
| REQ-040 | Ubiquitous | The public site shall render the tenant's name, logo, headline, topic strip, and subtagline from tenant branding, with no hardcoded brand. [F30] | No "AGENTLOOP" string for a non-zero tenant; tenant branding shown | Must |
| REQ-041 | Ubiquitous | The public homepage shall reuse the existing AGENTLOOP homepage layout unchanged (hero → today's issue → inline subscribe → recent issues → Elsewhere → footer), substituting only configured branding slots — not a bespoke redesign. [F31] | Section order/structure matches the existing homepage; only branding slots differ | Must |
| REQ-042 | Ubiquitous | The public nav shall show `Sources` always, `Must Read` only when Canon is on, and `How it's Built` only for tenant 0. [F32] | Nav reflects flags: non-canon tenant has no Must Read; non-zero tenant has no Built | Must |
| REQ-043 | Event-driven | When a logo is requested, the system shall serve the tenant's Postgres-stored bytes with correct content-type and long-lived cache headers (etag/version). [F33] | Response has image content-type + cache/etag headers | Must |
| REQ-044 | Unwanted | If a tenant-scoped archive/item is requested on a different tenant's host, then the system shall respond as not-found. [F34] | Cross-host archive id → not-found | Must |

### Subscribers & delivery

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|----------------------|----------|
| REQ-050 | Event-driven | When a visitor subscribes on a tenant's public site, the system shall create a `pending` subscriber for that tenant and send a double-opt-in confirmation from the shared platform sender. [F35] | Pending subscriber row (that tenant); confirmation email sent from shared sender | Must |
| REQ-051 | Event-driven | When a subscriber confirms, the system shall mark them `confirmed` for that tenant only. [F36] | Subscriber status `confirmed`, scoped to the tenant | Must |
| REQ-052 | Event-driven | When a tenant publishes a digest, the system shall send only to that tenant's `confirmed` subscribers. [F37] | No email to other tenants' or non-confirmed subscribers | Must |
| REQ-053 | State-driven | While a tenant has no verified sending domain, the system shall block its digest broadcast while still allowing transactional email from the shared platform sender. [F38] | Broadcast refused with message; confirmation/reset still send | Must |

### Per-tenant pipeline & scheduling

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|----------------------|----------|
| REQ-060 | Ubiquitous | The system shall include `tenant_id` in every pipeline job payload. [F40] | Enqueued job payload contains `tenantId` | Must |
| REQ-061 | Event-driven | When a pipeline job runs, the worker shall load the originating tenant's settings, sources, and prompts (not the legacy singleton). [F41] | Worker reads config scoped to `payload.tenantId` | Must |
| REQ-062 | Ubiquitous | The system shall maintain per-tenant schedule entries keyed per tenant. [F42] | Each active tenant has its own scheduler key/entry | Must |
| REQ-063 | Event-driven | When a tenant's settings change, the system shall reconcile only that tenant's schedulers. [F43] | Only the changed tenant's scheduler entries are updated | Must |
| REQ-064 | Ubiquitous | The system shall attribute a run's raw items, logs, review edits, archives, and publishes to the originating tenant. [F44] | All derived rows carry the run's `tenant_id` | Must |
| REQ-065 | State-driven | While globally-concurrent runs are at the cap, the system shall queue further runs rather than start them. [F45] | (N+1)th concurrent run waits until a slot frees | Must |
| REQ-066 | Event-driven | When multiple tenants share a nominal schedule time, the system shall apply start-time jitter so they do not all start simultaneously. [F46] | Observed starts are spread across the jitter window | Should |
| REQ-067 | Ubiquitous | The system shall apply global per-external-source rate limiting across concurrent tenant runs. [F47] | Concurrent runs do not exceed the configured per-source rate | Should |
| REQ-068 | Ubiquitous | The system shall globally throttle the shared Twitter collector across all tenants. [F48] | Collector calls across tenants stay under the global limit | Should |

### Sources

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|----------------------|----------|
| REQ-070 | Ubiquitous | The system shall store sources in a normalized per-tenant table (type, config, enabled, health). [F50] | A `sources` table with `tenant_id` and per-source rows exists | Must |
| REQ-071 | Event-driven | When a tenant requests source discovery, the system shall return LLM+Tavily candidates the tenant must explicitly choose to add. [F51] | Candidates returned; none added until chosen | Must |
| REQ-072 | Ubiquitous | The system shall support manual add and removal of sources of each supported type. [F52] | Add/remove of each type persists | Must |
| REQ-073 | Event-driven | When the pipeline collects, it shall use the tenant's enabled source rows. [F53] | Disabled/other-tenant sources are not collected | Must |
| REQ-074 | Ubiquitous | Source management (discovery, add/remove, enable/disable, health) shall live within the Settings page and the onboarding sources step, not a standalone admin page. [F54] | A Sources panel exists in Settings; no separate admin sources route | Should |

### Credentials, social, email domain

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|----------------------|----------|
| REQ-080 | Event-driven | When a tenant connects LinkedIn, the system shall run OAuth with the shared app client and store only that tenant's tokens. [F60] | Tenant LinkedIn tokens stored under that tenant; client secret not exposed | Must |
| REQ-081 | Event-driven | When a tenant connects Twitter for posting, the system shall run Twitter OAuth and store only that tenant's tokens (no manual API-key entry for tenants). [F61] | Tenant Twitter tokens stored via OAuth; no tenant key-entry UI | Must |
| REQ-082 | Ubiquitous | The system shall restrict app-level secrets (LinkedIn client, Twitter collector cookies) to super admins and never expose them to tenant admins. [F62] | Tenant-facing responses never contain app-level secrets | Must |
| REQ-083 | Ubiquitous | The system shall key social credentials/tokens by `(tenant_id, platform)` and encrypt them at rest. [F63] | Composite key in schema; stored values are ciphertext | Must |
| REQ-084 | Event-driven | When a tenant adds a sending domain, the system shall register it with Resend and surface the required DNS records. [F64] | Domain registered; DNS records returned to the tenant. (Probe-confirmed: needs a full-access Resend key; account domain quota must be ≥ active tenants — see design Risks) | Must |
| REQ-085 | Event-driven | When a tenant requests verification, the system shall query Resend and update the domain status (pending/verified/failed with reasons). [F65] | Status reflects Resend; failure reasons surfaced | Must |
| REQ-086 | Ubiquitous | The system shall use the shared Twitter collector for collection across tenants without exposing its cookies to tenant admins. [F66] | Collection works; collector cookies absent from tenant responses | Must |

### Notifications & feature flags

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|----------------------|----------|
| REQ-090 | Event-driven | When a run becomes ready for review, the system shall notify the tenant via its configured channels (email and/or Slack). [F70] | Configured channel(s) receive a review-ready notification | Must |
| REQ-091 | Event-driven | When a collector fails or a run crashes, the system shall send an error alert to the tenant's configured channels. [F71] | Configured channel(s) receive an error alert | Must |
| REQ-092 | Ubiquitous | The system shall let a tenant configure a notification email and an encrypted Slack incoming-webhook URL. [F72] | Both persist; webhook stored encrypted | Must |
| REQ-093 | Ubiquitous | The system shall provide independent per-tenant toggles for Deliverability, Canon, and Eval, each defaulting to off. [F73] | New tenant has all three off; each toggles independently | Must |
| REQ-094 | Ubiquitous | The system shall hide the shortlist-size control from the tenant dashboard and use an internal default. [F74] | No shortlist-size field in tenant UI; internal default applied | Must |

### Super admin

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|----------------------|----------|
| REQ-100 | Event-driven | When a super admin logs in, the system shall show the tenant list (not a tenant dashboard). [F80] | Super-admin landing is the tenant list | Must |
| REQ-101 | Event-driven | When a super admin opens a tenant, the system shall issue an impersonation context and render that tenant's dashboard as-is. [F81] | Tenant dashboard renders under impersonation | Must |
| REQ-102 | State-driven | While impersonating, the system shall display a persistent banner and provide a one-click exit that clears impersonation. [F82] | Banner shown; exit clears impersonation back to tenant list | Must |
| REQ-103 | Event-driven | When impersonation starts or stops, the system shall record an audit entry with acting super-admin and target tenant. [F83] | Audit rows for start and stop with both ids | Should |

### AGENTLOOP migration (zero data loss)

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|----------------------|----------|
| REQ-110 | Event-driven | When the migration runs, the system shall create the AGENTLOOP tenant (slug, branding, custom-domain map) + its tenant-admin account and seed super-admin account(s) separately. [F90] | AGENTLOOP tenant + admin exist; super-admin(s) seeded | Must |
| REQ-111 | Event-driven | When the migration runs, the system shall re-point every existing tenant-owned row to the AGENTLOOP tenant across all listed tables. [F91] | No tenant-owned row has NULL `tenant_id` post-migration | Must |
| REQ-112 | Event-driven | When the migration runs, the system shall move singleton settings (sources→rows, prompts, schedule, flags) and connected social creds/tokens into AGENTLOOP's per-tenant config. [F92] | AGENTLOOP config equals prior singleton; pipeline/publish unchanged | Must |
| REQ-113 | Event-driven | When the migration runs, the system shall enable AGENTLOOP-only features (Canon/Must Read, `/built`). [F93] | AGENTLOOP Canon on; `/built` available for tenant 0 | Must |
| REQ-114 | Ubiquitous | The migration shall be idempotent and re-runnable, and guarded/reversible. [F94] | Re-running produces no duplicate/locked-out state | Must |
| REQ-115 | Event-driven | When the migration completes, verification shall assert row counts match pre-migration, no NULL `tenant_id` remains, AGENTLOOP entities resolve under the tenant, and a dry-run pipeline succeeds. [F95] | Verification script passes all four checks | Must |

### Non-functional

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|----------------------|----------|
| REQ-120 | Ubiquitous | The system shall prevent any request path from returning another tenant's data, enforced by repository tenant-scoping + the lint guard. [NF1] | Isolation test suite finds zero cross-tenant reads | Must |
| REQ-121 | Ubiquitous | The system shall rate-limit signup/login/reset per IP and store passwords with a memory-hard hash (argon2id or bcrypt cost ≥12); reset tokens single-use and short-lived. [NF2] | Excess auth attempts throttled; stored hash is argon2id/bcrypt≥12; token one-use | Must |
| REQ-122 | Ubiquitous | The system shall keep legacy AGENTLOOP rows working via nullable new columns with fallbacks resolving to tenant 0. [NF3] | Legacy archives/runs render under tenant 0 with no error | Must |
| REQ-123 | State-driven | While N tenants share a schedule, the system shall keep total concurrent runs ≤ the global cap and not exceed upstream source limits. [NF4] | Load test: concurrent runs ≤ cap; no per-source overrun | Should |
| REQ-124 | Ubiquitous | The system shall keep per-tenant run telemetry, costs, and failures attributable to a tenant, and impersonation auditable. [NF5] | Telemetry/cost rows carry `tenant_id`; impersonation audited | Should |
| REQ-125 | Ubiquitous | The system shall never serialize app-level secrets into a tenant-facing API response or the client bundle. [NF6] | Grep of tenant responses + built bundle finds no app secret | Must |
| REQ-126 | Ubiquitous | The system shall plumb `tenant_id` through the repository-factory seam, not ad-hoc per query. [NF7] | New tenant-owned repos receive tenant context via the factory | Should |
| REQ-127 | Ubiquitous | The migration shall run in a transaction or idempotent batches, verifiable on a DB copy before production. [NF8] | Migration rehearsed on a copy; atomic/idempotent | Must |

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|--------------|
| EDGE-001 | Two tenants race for the same slug [EC1] | DB uniqueness wins; loser gets "taken" and must repick | REQ-033, REQ-070 |
| EDGE-002 | Slug changed while old links/emails are in flight [EC2] | Old slug 301-redirects; emails with old slug still resolve | REQ-023 |
| EDGE-003 | Reserved/profane slug attempted [EC3] | Rejected at validation | REQ-033 |
| EDGE-004 | Tenant abandons onboarding [EC4] | Stays `pending_setup`; never runs/serves; not counted active | REQ-031 |
| EDGE-005 | Subscribe-confirm / reset before domain verified [EC5] | Sent from shared platform sender | REQ-050, REQ-053 |
| EDGE-006 | Publish attempted with no verified domain [EC6] | Broadcast blocked with message; web/social publish allowed | REQ-053 |
| EDGE-007 | Logo too large / wrong type [EC7] | Rejected; existing logo unchanged | REQ-039 |
| EDGE-008 | Super admin acts destructively while impersonating [EC8] | Audited; no elevated destructive powers beyond tenant admin | REQ-101, REQ-103 |
| EDGE-009 | Global cap reached at a popular schedule time [EC9] | Excess runs queue; jitter spreads starts; runs complete | REQ-065, REQ-066 |
| EDGE-010 | `SESSION_SECRET` rotated [EC10] | All encrypted creds invalidated; documented re-connect path; migration must not rotate | REQ-083, REQ-127 |
| EDGE-011 | Shared Twitter collector rate-limited/banned [EC11] | Global throttle backs off; per-source degradation without failing the whole run | REQ-068, REQ-086 |
| EDGE-012 | Legacy rows with NULL `tenant_id` mid-migration [EC12] | Backfill completes before isolation enforcement turns on | REQ-111, REQ-115 |
| EDGE-013 | Unknown Host (typo subdomain / bare apex) [EC13] | Not-found page; no tenant data leak | REQ-021 |
| EDGE-014 | Tenant disables Canon with existing Must Read entries [EC14] | Page/nav hidden; data retained, not deleted | REQ-042, REQ-093 |

## Verification Matrix

| REQ/EDGE ID | Test Level | Test Name | Rationale for Level | Notes |
|-------------|-----------|-----------|---------------------|-------|
| REQ-001 | integration | test_REQ_001_signup_creates_user_tenant_session | crosses DB + cookie | |
| REQ-002 | unit | test_REQ_002_rejects_password_mismatch | pure validation | |
| REQ-003 | integration | test_REQ_003_rejects_duplicate_email | unique DB constraint | |
| REQ-004 | integration | test_REQ_004_password_reset_token_single_use | crosses DB + mail | assert no enumeration |
| REQ-005 | unit | test_REQ_005_session_cookie_encodes_user_tenant_role | pure sign/verify | |
| REQ-006 | unit | test_REQ_006_signup_cannot_set_super_admin | pure role logic | |
| REQ-007 | integration | test_REQ_007_protected_route_401_without_cookie | middleware + route | |
| REQ-010 | integration | test_REQ_010_all_tenant_tables_have_tenant_id | schema/DB introspection | |
| REQ-011 | integration | test_REQ_011_tenant_resolved_session_vs_host | middleware resolution | |
| REQ-012 | integration | test_REQ_012_repo_queries_scope_by_tenant | crosses DB | |
| REQ-013 | integration | test_REQ_013_cross_tenant_id_returns_404 | crosses DB + route | |
| REQ-014 | unit | test_REQ_014_lint_rule_flags_unscoped_query | lint rule over fixture | eslint-plugin test |
| REQ-020 | integration | test_REQ_020_app_host_uses_session_tenant | host middleware | |
| REQ-021 | integration | test_REQ_021_slug_host_resolves_tenant_unknown_notfound | host middleware + DB | |
| REQ-022 | integration | test_REQ_022_custom_domain_maps_tenant0 | host middleware + config | |
| REQ-023 | integration | test_REQ_023_old_slug_301_redirects | host middleware | |
| REQ-030 | integration | test_REQ_030_wizard_progress_resumes | crosses DB | |
| REQ-031 | integration | test_REQ_031_pending_setup_inactive_no_schedule | DB + scheduler | |
| REQ-032 | integration | test_REQ_032_wizard_fields_persist | crosses DB | |
| REQ-033 | unit | test_REQ_033_slug_validation_available_taken_invalid | pure validation (taken via stub) | |
| REQ-034 | e2e | test_REQ_034_live_preview_reflects_branding | UI render journey | Playwright |
| REQ-035 | integration | test_REQ_035_activate_when_required_complete | DB + scheduler | |
| REQ-036 | integration | test_REQ_036_generates_ranking_and_shortlist_prompts | crosses LLM boundary | LLM stubbed |
| REQ-037 | e2e | test_REQ_037_source_pills_add_and_manual | UI add/remove journey | Playwright |
| REQ-038 | integration | test_REQ_038_activation_blocked_lists_missing | DB + route | |
| REQ-039 | unit | test_REQ_039_logo_rejects_oversize_and_bad_type | pure validation | |
| REQ-040 | e2e | test_REQ_040_public_site_uses_tenant_branding | public render journey | Playwright |
| REQ-041 | integration | test_REQ_041_homepage_today_plus_archives | crosses DB | |
| REQ-042 | integration | test_REQ_042_nav_derived_from_flags_and_tenant0 | flag-driven nav | |
| REQ-043 | integration | test_REQ_043_logo_served_with_content_type_and_cache | route + DB bytes | |
| REQ-044 | integration | test_REQ_044_cross_host_archive_notfound | route + host scope | |
| REQ-050 | integration | test_REQ_050_subscribe_creates_pending_sends_confirm | DB + mail | |
| REQ-051 | integration | test_REQ_051_confirm_marks_confirmed_scoped | crosses DB | |
| REQ-052 | integration | test_REQ_052_broadcast_only_confirmed_of_tenant | DB + send | |
| REQ-053 | integration | test_REQ_053_broadcast_blocked_without_domain_transactional_ok | DB + send gate | |
| REQ-060 | unit | test_REQ_060_job_payload_includes_tenant_id | pure payload shape | |
| REQ-061 | integration | test_REQ_061_worker_loads_tenant_settings | crosses DB in worker | |
| REQ-062 | integration | test_REQ_062_per_tenant_scheduler_keys | scheduler/Redis | |
| REQ-063 | integration | test_REQ_063_settings_change_reconciles_only_that_tenant | scheduler | |
| REQ-064 | integration | test_REQ_064_run_derivatives_carry_tenant_id | crosses DB | |
| REQ-065 | integration | test_REQ_065_global_cap_queues_excess_runs | queue/worker | |
| REQ-066 | unit | test_REQ_066_jitter_spreads_start_times | pure jitter calc | |
| REQ-067 | integration | test_REQ_067_per_source_rate_limit_enforced | limiter + concurrency | |
| REQ-068 | integration | test_REQ_068_twitter_collector_globally_throttled | shared limiter | |
| REQ-070 | integration | test_REQ_070_sources_table_per_tenant_rows | schema/DB | |
| REQ-071 | integration | test_REQ_071_discovery_returns_candidates_not_added | crosses Tavily/LLM | stubbed |
| REQ-072 | integration | test_REQ_072_manual_source_add_remove | crosses DB | |
| REQ-073 | integration | test_REQ_073_pipeline_uses_enabled_tenant_sources | worker + DB | |
| REQ-074 | e2e | test_REQ_074_sources_panel_in_settings_no_standalone_route | UI placement | Playwright |
| REQ-080 | integration | test_REQ_080_linkedin_oauth_stores_tenant_tokens | OAuth + DB | mock provider |
| REQ-081 | integration | test_REQ_081_twitter_oauth_stores_tenant_tokens | OAuth + DB | mock provider |
| REQ-082 | integration | test_REQ_082_app_secrets_not_in_tenant_response | route serialization | |
| REQ-083 | integration | test_REQ_083_creds_keyed_tenant_platform_encrypted | schema + cipher | |
| REQ-084 | integration | test_REQ_084_add_domain_registers_returns_dns | crosses Resend | mock Resend |
| REQ-085 | integration | test_REQ_085_verify_updates_domain_status | crosses Resend | mock Resend |
| REQ-086 | integration | test_REQ_086_shared_collector_cookies_hidden | collector + serialization | |
| REQ-090 | integration | test_REQ_090_review_ready_notifies_channels | DB + notifier | fake channels |
| REQ-091 | integration | test_REQ_091_error_alert_to_channels | notifier | fake channels |
| REQ-092 | integration | test_REQ_092_notification_email_and_slack_persist_encrypted | DB + cipher | |
| REQ-093 | integration | test_REQ_093_feature_flags_default_off_independent | crosses DB | |
| REQ-094 | e2e | test_REQ_094_shortlist_size_hidden_in_dashboard | UI absence | Playwright |
| REQ-100 | e2e | test_REQ_100_superadmin_lands_on_tenant_list | super-admin journey | Playwright |
| REQ-101 | integration | test_REQ_101_impersonation_renders_tenant_dashboard | auth + route | |
| REQ-102 | e2e | test_REQ_102_impersonation_banner_and_exit | UI journey | Playwright |
| REQ-103 | integration | test_REQ_103_impersonation_audit_start_stop | crosses DB | |
| REQ-110 | integration | test_REQ_110_migration_creates_tenant_admin_superadmin | migration + DB | |
| REQ-111 | integration | test_REQ_111_migration_no_null_tenant_id | migration + DB | |
| REQ-112 | integration | test_REQ_112_singleton_settings_lifted_to_tenant | migration + DB | |
| REQ-113 | integration | test_REQ_113_agentloop_features_enabled | migration + DB | |
| REQ-114 | integration | test_REQ_114_migration_idempotent_rerun | migration + DB | run twice |
| REQ-115 | integration | test_REQ_115_post_migration_verification_passes | migration verify script | |
| REQ-120 | integration | test_REQ_120_isolation_suite_zero_cross_tenant | DB + routes | |
| REQ-121 | integration | test_REQ_121_auth_rate_limit_and_hash | middleware + hash | |
| REQ-122 | integration | test_REQ_122_legacy_rows_resolve_tenant0 | crosses DB | |
| REQ-123 | e2e | test_REQ_123_load_concurrency_within_cap | multi-run load journey | staging-style |
| REQ-124 | integration | test_REQ_124_telemetry_costs_carry_tenant_id | crosses DB | |
| REQ-125 | integration | test_REQ_125_no_app_secret_in_bundle_or_response | build + response scan | |
| REQ-126 | unit | test_REQ_126_repo_factory_requires_tenant_context | factory signature | |
| REQ-127 | integration | test_REQ_127_migration_atomic_on_copy | migration on copy | |
| EDGE-001 | integration | test_EDGE_001_slug_race_unique_loser_taken | DB unique race | |
| EDGE-002 | integration | test_EDGE_002_slug_change_old_links_resolve | host redirect | |
| EDGE-003 | unit | test_EDGE_003_reserved_slug_rejected | pure validation | |
| EDGE-004 | integration | test_EDGE_004_abandoned_setup_never_runs | DB + scheduler | |
| EDGE-005 | integration | test_EDGE_005_transactional_before_domain_uses_shared | send gate | |
| EDGE-006 | integration | test_EDGE_006_publish_without_domain_blocks_broadcast_allows_social | send gate | |
| EDGE-007 | unit | test_EDGE_007_bad_logo_keeps_existing | pure validation | |
| EDGE-008 | integration | test_EDGE_008_impersonation_destructive_audited_no_elevation | auth + audit | |
| EDGE-009 | integration | test_EDGE_009_cap_queues_jitter_completes | queue/worker | |
| EDGE-010 | unit | test_EDGE_010_secret_rotation_invalidates_creds | cipher behavior | |
| EDGE-011 | integration | test_EDGE_011_collector_ban_degrades_not_fails_run | collector + run | |
| EDGE-012 | integration | test_EDGE_012_enforcement_after_backfill | migration ordering | |
| EDGE-013 | integration | test_EDGE_013_unknown_host_notfound_no_leak | host middleware | |
| EDGE-014 | integration | test_EDGE_014_disable_canon_hides_keeps_data | flag + DB | |

## Verification Scenarios

> Visual reference for every surface below: the HTML mockups in `.harness/features/multi-tenant/mocks/` (`index.html`). VS-1 → `signup.html` + `onboarding.html`; VS-3 → `public-home.html`; VS-4 → `super-admin.html` + `impersonation.html`; VS-5 → `settings.html` (Sending domain panel).

### VS-1: Sign up → onboard → activate
1. Open `app.<root>` → **Sign up**; fill name, email, password, confirm-password → submit with valid, unused input → land in the wizard, signed in.
2. Submit a variant with mismatched password or an already-registered email → stay on the form with field guidance; no account created.
3. Step through the carousel → the right pane preview shows the typed name/logo/headline with lorem-ipsum elsewhere.
4. Type a slug → see available / taken / invalid feedback live.
5. Leave the wizard and return → resume at the furthest completed step with fields intact.
6. Complete required steps (name, slug, headline, prompts, ≥1 source, schedule) → **Activate** becomes enabled → activate → public site live at `<slug>.<root>`; scheduled runs begin; redirected to dashboard. (Activate is unavailable while any required step is incomplete.)

### VS-2: Daily review & publish
1. A scheduled run completes → tenant receives a review-ready notification on configured channel(s).
2. Open the tenant-scoped dashboard → reorder/curate items, edit digest copy, add a pool post.
3. Publish → confirmed subscribers of this tenant only receive the digest from the tenant's verified domain; connected LinkedIn/Twitter posts go out.
4. Induce a collector failure / run crash → an error alert arrives on configured channel(s).

### VS-3: End subscriber
1. Visit `<slug>.<root>` → branded homepage shows today's issue + older archives.
2. Enter an email → receive a double-opt-in confirmation from the shared platform sender.
3. Confirm → become a confirmed subscriber of that tenant only.
4. Receive the digest → can one-tap feedback and unsubscribe.

### VS-4: Super-admin impersonation
1. Log in on `app.<root>` as a seeded super admin → see the tenant list (not a dashboard).
2. Click a tenant → enter impersonation; the tenant dashboard renders as-is with a persistent "Viewing as <tenant> — Exit" banner.
3. Click Exit → return to the tenant list; impersonation cleared; start/stop audited.

### VS-5: Connect a sending domain
1. Enter a sending domain → DNS records shown; domain registered with Resend.
2. Add DNS, click Verify → status moves pending → verified (or failed with reasons).
3. Meanwhile publish to web/social and send transactional email; the subscriber broadcast unlocks once the domain verifies.

## Out of Scope

- Vanity custom domains for arbitrary tenants (CNAME + per-domain TLS/ACME + verification). *Exception:* AGENTLOOP's existing domain via a hardcoded tenant-0 mapping.
- Billing, plans, usage metering, and usage caps (open, uncapped signup).
- Multiple users / teams / invites per tenant (one user per tenant).
- Tenant self-serve suspend/delete, GDPR erasure, and data-retention automation.
- Per-tenant LLM model selection (ranking/shortlist model stays a global env var).
- Per-tenant arbitrary custom/static pages (AGENTLOOP's `/built` is hard-scoped to tenant 0).
- Email verification at signup and 2FA.
- Postgres Row-Level Security (app-level filtering chosen for v1; RLS is forward-compatible future hardening).
- Stale `pending_setup` account reaping (deferred; see design Open Questions).
