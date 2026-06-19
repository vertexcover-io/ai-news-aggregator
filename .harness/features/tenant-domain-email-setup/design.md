# Subdomain & Email Setup Experience (Fix #3) — Design + Spec

> Source requirements: `fixes-to-be-done.md` §3; `multi-tenant-req.md` §5.2/§6.5 (and §7 deferrals it consciously reverses). Research-backed (Vercel/Cloudflare/Netlify custom-domain flows; Ghost/Supabase/Cal.com/Sentry email patterns; Resend + Caddy docs) — see **References**.
> This is a follow-up sub-feature of the multi-tenant epic (VER-110). It does **not** restate epic-wide decisions; it builds on the shipped tenancy foundation, host→tenant resolver, onboarding wizard, and the §6.5 social/email credential rework.

## Problem Statement

A tenant's setup experience for **two distinct "domains" — their public site subdomain and their email sending identity — is opaque and partly non-functional.** The req's own questions capture it: *How do users bring their own email provider? How is delivery configured and verified? How do subdomains work? What DNS records are required? What activates a custom sending domain?*

Concretely, three gaps:

1. **The subdomain is built but its outcome is never made legible.** A tenant picks a slug; nothing in the flow plainly says "your site is live at `<slug>.vertexcover.io`."
2. **Onboarding's "Sending email" field is orphaned.** It is captured into the wizard draft and then **never applied** at activation — it does not seed a sender, a domain, or anything. Real sending-domain verification lives in a *separate* Settings panel the tenant must discover unaided.
3. **Email is hard-locked to Resend.** A tenant cannot bring their own provider. `EMAIL_PROVIDER` selects Resend-vs-SES **once at process startup, globally** — there is no per-tenant provider choice and no provider-agnostic path.

The fix is not raw new capability for its own sake — it is **closing the onboarding↔verification seam, making both "domains" legible, and removing the single-provider lock-in** using the standard SaaS patterns confirmed by research.

## Context — what exists today (verified against code this session)

**Subdomain (essentially complete):**
- Onboarding `SlugStep.tsx` → live availability via `GET /api/onboarding/slug-available` (300ms debounce), local format + reserved-word checks (`isValidTenantSlugFormat`, `isReservedTenantSlug`), previews `<slug>.<root>`.
- `tenants.slug` (unique index `tenants_slug_uq`) + `tenants.previousSlug` (for 301s). Reserved list + `TENANT_SLUG_PATTERN` in `packages/shared/src/constants/tenant.ts`.
- `resolve-tenant.ts` middleware: `<slug>.<root>` → `findBySlug` → serve; pending → 404; renamed slug → 301 (`findByPreviousSlug`). Dev via `X-Tenant-Slug` / `*.lvh.me`.

**Email (built but provider-locked, with an orphaned onboarding field):**
- `packages/pipeline/src/lib/email-provider.ts` + `packages/api/src/lib/email/resend-provider.ts`: a provider abstraction already exists (Resend default, SES alt) selected by `EMAIL_PROVIDER` at startup — **global, not per-tenant**.
- Shared `RESEND_API_KEY`; transactional sender `FROM_MAIL` (default `newsletter@news.vertexcover.io`).
- Per-tenant **sending domain** on the tenant row: `sendingDomainName/Id/Status/Records`. `SendingDomainPanel.tsx` + `services/sending-domain.ts` (`RESEND_FULL_ACCESS_API_KEY`): register → DNS records → verify; tri-state `pending|verified|failed`. **Broadcast gate (REQ-053): broadcast blocked unless `sendingDomainStatus === "verified"`** (fail-closed); transactional mail never gated.
- Resend plan caveat already noted in code: **1 verified domain per account**.
- Onboarding `SocialStep.tsx` "Sending email" → saved as `onboardingState.data.fromEmail` → **not applied at activation** (`services/onboarding.ts`).
- Subscribers are real and per-tenant (`subscribers` table, `listConfirmed()`), despite the stale CLAUDE.md "recipients hardcoded" note.

**Web custom domains (scaffold only):**
- `tenants.customDomain` column exists but is **not used for resolution**.
- Resolution uses a **static `CUSTOM_DOMAIN_MAP` env** (`host=slug` pairs) parsed in `config/domains.ts`; AGENTLOOP's domain is a hardcoded entry.
- Production: **Caddy 2.x** on a VPS (Docker Compose: api + pipeline + postgres + redis), static SPA served by Caddy, `/api/*` proxied to the API. Caddy is the ACME client (Let's Encrypt). HTTP-01 works for any single host pointed at the box; wildcard `*.<root>` needs DNS-01 (custom Caddy binary) and is currently disabled. Caddyfile is installed + reloaded by `deployment/deploy.sh`.

**Credential encryption:** `CredentialCipher` (HKDF from `SESSION_SECRET`), already used to store social/collector creds encrypted in the DB and resolve them DB-first per pipeline job — the reuse target for SMTP credentials.

## Goals & Non-Goals

**Goals**
- A tenant finishes onboarding with a **working email sender by default, zero configuration** (`<slug>@news.vertexcover.io` on our pre-verified shared Resend domain).
- The subdomain outcome (`<slug>.vertexcover.io`) is **plainly shown** in onboarding and Settings.
- A tenant can **bring their own email provider** (any ESP/SMTP) — email is no longer Resend-locked.
- A tenant can **bring their own sending domain** (managed-Resend path) with a clear DNS-records → verify flow.
- A tenant can **bring their own web domain** (`news.theircompany.com`) with **automatic per-domain TLS**, mirroring Vercel's add-domain flow.
- Email/domain "domains" are conceptually separated and documented so the req's five questions are answered in-flow.

**Non-Goals (deferred)**
- **Per-provider domain-provisioning APIs** (calling SES/SendGrid/Postmark `createDomain` to generate their DKIM records for the tenant). BYO email = bring an already-verified provider via SMTP; we relay and generate no DNS for them. Only the managed-Resend path verifies a domain. (Confirmed by research as where portability breaks — every ESP's records differ.)
- **Wildcard tenant subdomains over a custom apex**, vanity per-tenant TLS via DNS-01, multi-region Caddy clustering.
- Inbound email / reply handling, per-tenant bounce/complaint dashboards, suppression-list sync.
- Migrating AGENTLOOP's hardcoded custom-domain map entry (it keeps working via the new DB-driven path once seeded; no behavior change required).
- Billing/quota enforcement around the Resend 1-domain plan limit (surfaced as a documented operational caveat, not enforced in code).

---

## Design

Three independently shippable parts (A → B → C). Each maps to a phase in **Rollout**.

### Part A — Subdomain clarity + managed email default *(no infra change)*

**A1. Subdomain is informational only.** Keep the existing slug engine; add presentation:
- Onboarding: after the slug step, plainly show "Your site: `https://<slug>.vertexcover.io`."
- Settings (new/extended branding or a "Domains" card): show the live subdomain URL, with a link out and copy button. (Editing the slug already exists via activation/`changeTenantSlug`; surface it here read-with-edit.)

**A2. Managed email default — auto-assign, kill the orphan.** Replace the free-text `fromEmail` field with a **derived, read-only** default sender:
- On activation (and for any active tenant lacking explicit email config), the broadcast sender resolves to **`<slug>@news.vertexcover.io`**. Because `news.vertexcover.io` is already verified in our Resend account, this sends immediately with **no DNS** — confirmed by Resend's docs: any local-part on a verified domain is allowed.
- Onboarding shows it read-only: "You'll send from `inference@news.vertexcover.io`. Bring your own sending domain or provider later in Settings."
- Settings surfaces the current effective sender + its source (managed default vs custom domain vs custom SMTP).
- This **opens the broadcast gate for the managed default** without a per-tenant verification step (the shared domain is already verified), while custom domains/SMTP keep their own gates (Part B).

> Decision A-D1: the default broadcast sender is the slug-derived address on the shared verified domain, not a stored per-tenant value. Changing the slug changes the default sender automatically; email links/subscribers are unaffected (recipients are independent of sender). Custom config (B) overrides it.

### Part B — Provider-agnostic email *(no infra change)*

Adopt the research-confirmed **hybrid**: managed Resend default + a thin provider interface with **SMTP as the universal escape hatch**. SMTP reaches every ESP (SES, SendGrid, Postmark, Mailgun, Gmail) with one code path.

**B1. Formalize the `EmailProvider` interface.** Required core method `send(message) → { messageId }`. Refactor current Resend/SES usage behind named implementations (`ResendProvider`, `SesProvider`) — no behavior change. (Builds on the existing `email-provider.ts` abstraction.)

**B2. Add an `SmtpProvider`** (Nodemailer SMTP transport) implementing `send`. Fields collected: `host`, `port` (465 implicit-TLS / 587 STARTTLS), `username`, `password`, `secure/TLS mode`, `fromAddress`, `fromName`.

**B3. Per-tenant email config.** A tenant's effective sending path is one of:
- `managed` (default) — shared Resend, sender `<slug>@news.vertexcover.io`.
- `managed_domain` — shared Resend, but from the tenant's own **verified** sending domain (the existing `SendingDomainPanel` flow).
- `smtp` — the tenant's own provider via SMTP creds.

Stored per tenant; SMTP creds **encrypted via `CredentialCipher`** and resolved **DB-first per pipeline job**, exactly like social/collector creds. Default new tenants to `managed`.

**B4. Domain auth ownership.** For `smtp`, the tenant has already verified SPF/DKIM with *their* provider — **we generate no DNS and run no verification; we relay.** Only `managed_domain` verifies (existing Resend flow). DMARC guidance (a single portable `_dmarc` TXT) may be surfaced as optional help text.

**B5. Broadcast gate, generalized.** Broadcast is allowed when: `managed` (shared domain pre-verified) **OR** `managed_domain` with status `verified` **OR** `smtp` configured (a successful test send / connection check). Fail-closed otherwise. Transactional mail always uses the shared platform sender, never gated (unchanged, EDGE-005).

> Caveat B-C1 (Ghost's lesson, documented): raw mailbox SMTP at newsletter bulk volume risks blacklisting; BYO-SMTP tenants are told to point at a real ESP's SMTP relay (SES/SendGrid/Mailgun endpoints), not a personal mailbox.

### Part C — Bring-your-own web domain with automatic TLS *(one-time infra change)*

Replicate Vercel's "add a domain" flow with **Caddy on-demand TLS + a DB-backed authorization (`ask`) endpoint** — the self-hosted equivalent of Cloudflare-for-SaaS custom hostnames (confirmed by research + Caddy docs).

**C1. Add-domain flow (Settings → Domains):**
1. Tenant enters `news.theircompany.com` → stored on `tenants.customDomain` with a new status `pending` and `customDomainVerifiedAt` null.
2. We show the DNS record by type:
   - **Subdomain** → `CNAME news → ingress.vertexcover.io` (a stable host we control, A-record'd to the VPS).
   - **Apex** (`theircompany.com`) → `A → <VPS IP>` (apex cannot CNAME); recommend the `www` subdomain + apex→www redirect.
3. **Background DNS poll** (a job, with a manual "Re-check" button) resolves the record; when it points at us, status → `verified`.
4. First HTTPS request: **Caddy on-demand TLS** calls `GET /internal/tls-allow?domain=<host>` → API returns **200 only for `verified` custom domains** → Let's Encrypt cert minted just-in-time, cached. No Caddyfile reload per tenant.

**C2. DB-driven resolution.** Extend `resolve-tenant.ts` to resolve a custom host from the **DB** (`tenants.customDomain` where verified), cached, replacing the static `CUSTOM_DOMAIN_MAP` env lookup. The AGENTLOOP env entry is migrated to a seeded `customDomain` row (no behavior change).

**C3. One-time Caddyfile change** (shipped via existing `deploy.sh`): add `on_demand_tls { ask http://127.0.0.1:3000/internal/tls-allow }` and an on-demand catch-all site block (`tls { on_demand }`) that imports the same `newsletter_site` snippet. (Replaces today's per-domain static site blocks for tenant custom domains; the wildcard + app-host blocks stay as-is.)

**C4. Authorization endpoint is the abuse/rate-limit shield.** `/internal/tls-allow` is unauthenticated-but-bound-to-localhost, returns 200 only for known verified custom domains — without it, anyone pointing DNS at us could exhaust Let's Encrypt's **300 new-orders / 3h** account cap.

> Decision C-D1: HTTP-01 (default) — needs inbound :80/:443, which on-demand requires anyway. **No wildcard / DNS-01** for per-tenant custom domains (one cert per hostname). TXT ownership challenge only for contested domains (deferred unless needed). Cert storage must sit on a **persistent, backed-up volume**.

---

## Data Model Changes

| Table | Change | Why |
|-------|--------|-----|
| `tenants` | Add `customDomainStatus` (`text`, null/`pending`/`verified`/`failed`), `customDomainVerifiedAt` (`timestamptz`, null). (`customDomain` already exists.) | Part C verification state machine + DB-driven resolution |
| `tenants` (or new `tenant_email_settings`) | Add email config: `emailMode` (`managed`/`managed_domain`/`smtp`), and SMTP fields stored **encrypted** (`smtpHost`, `smtpPort`, `smtpSecure`, `smtpUsername`, `smtpPasswordEnc`, `smtpFromAddress`, `smtpFromName`). | Part B per-tenant provider |

Open question O-1: inline columns on `tenants` vs a dedicated `tenant_email_settings` table — lean to a small dedicated table to keep secrets + email concerns isolated and mirror `social_credentials` encryption ergonomics.

## API Surface (indicative)

- `GET /api/admin/email-settings` — effective sender + mode + (masked) SMTP config + managed-domain status.
- `PUT /api/admin/email-settings` — set mode; for `smtp`, validate + encrypt creds; trigger a connection/test-send check.
- (existing) `POST /api/settings/domain`, `POST /api/settings/domain/verify` — managed-Resend sending domain (Part B `managed_domain`).
- `POST /api/admin/web-domain` — register custom web domain → returns required DNS record(s).
- `POST /api/admin/web-domain/verify` (+ background poll job) — re-check DNS, flip status.
- `GET /internal/tls-allow?domain=` — Caddy on-demand authorization; 200 iff a verified custom domain (localhost-bound).

All request bodies validated with zod at the boundary (`src/lib/validate.ts`); all DB access via repository factories; web calls via typed `src/api/` clients (no raw `fetch`).

## Security Considerations

- SMTP passwords encrypted at rest (`CredentialCipher`), never returned in plaintext (masked on GET), resolved DB-first per job.
- `/internal/tls-allow` bound to loopback and strictly allowlists verified domains (abuse + LE rate-limit guard).
- Custom-domain input validated/normalized; reject our own root/app hosts and reserved patterns to prevent self-takeover.
- No secrets in logs; no real external sends in tests (assert intent via fakes/DB — project rule).

## Edge Cases

| ID | Case | Expected |
|----|------|----------|
| E1 | Tenant changes slug after activation | Managed default sender updates automatically to new `<slug>@news…`; old→new site 301 already handled |
| E2 | Custom web domain DNS not yet propagated | Status stays `pending`; "Re-check" available; no cert attempted (ask returns non-200) |
| E3 | Apex domain entered with a CNAME by the tenant | UX warns apex needs A/ALIAS; verification fails clearly |
| E4 | CAA record on tenant domain excludes `letsencrypt.org` | Surface explicit "CAA blocks issuance" error |
| E5 | SMTP creds invalid / connection fails | Mode not switched to active; broadcast gate stays closed; clear error |
| E6 | Managed-Resend custom domain unverified at publish | Broadcast blocked (existing REQ-053), default-managed sender NOT silently used if tenant chose `managed_domain` |
| E7 | Resend 1-domain plan limit hit on `managed_domain` register | Surface Resend's 403 as an actionable message; managed default still works |
| E8 | Custom web domain removed/unverified later | `ask` returns non-200; resolution falls back to subdomain; cached cert expires naturally |
| E9 | Two tenants claim the same custom domain | Uniqueness enforced; second gets "in use"; TXT ownership challenge deferred |

## Requirements (Spec)

EARS types; F-traceability omitted (single doc); priority Must/Should/Could. Fresh REQ-300+ band.

### Subdomain clarity (Part A)
| ID | Type | Requirement | Acceptance | Priority |
|----|------|-------------|------------|----------|
| REQ-300 | Ubiquitous | The onboarding flow and Settings shall display the tenant's live public URL as `https://<slug>.<root>`. | Both surfaces show the resolved URL with copy/link | Must |
| REQ-301 | Ubiquitous | Settings shall let the tenant view (and, where allowed, change) their subdomain, reusing the existing availability/redirect logic. | Slug shown; change path reuses `changeTenantSlug` + 301 | Should |

### Managed email default (Part A)
| ID | Type | Requirement | Acceptance | Priority |
|----|------|-------------|------------|----------|
| REQ-310 | Event-driven | When a tenant activates without explicit email config, the system shall set the effective broadcast sender to `<slug>@<shared-verified-domain>`. | Active tenant sends broadcast from slug-derived address; no DNS step | Must |
| REQ-311 | Ubiquitous | The system shall remove the free-text onboarding sending-email field and show the derived default read-only. | No orphaned free-text field; derived sender shown | Must |
| REQ-312 | Ubiquitous | Settings shall display the current effective sender and its source (managed / managed-domain / smtp). | Source + address visible | Must |

### Provider-agnostic email (Part B)
| ID | Type | Requirement | Acceptance | Priority |
|----|------|-------------|------------|----------|
| REQ-320 | Ubiquitous | The system shall send all email through an `EmailProvider` interface whose required operation is `send`. | Resend/SES/SMTP all behind one interface | Must |
| REQ-321 | Event-driven | When a tenant configures SMTP (host/port/secure/user/pass/from), the system shall send that tenant's email via SMTP. | Broadcast + transactional route via tenant SMTP | Must |
| REQ-322 | Ubiquitous | The system shall store SMTP credentials encrypted and resolve them DB-first per job, never returning plaintext. | Ciphertext at rest; masked on read | Must |
| REQ-323 | Unwanted | If SMTP credentials fail a connection/test check, then the system shall not activate SMTP mode and shall keep broadcast gated. | Invalid creds → mode stays previous; clear error | Must |
| REQ-324 | State-driven | While a tenant is in `managed` mode, the system shall require no per-tenant domain verification to broadcast. | Managed tenant broadcasts without verification | Must |
| REQ-325 | Ubiquitous | The system shall keep the existing managed-Resend sending-domain verification path as `managed_domain` mode. | `SendingDomainPanel` flow intact | Should |

### Custom web domain + TLS (Part C)
| ID | Type | Requirement | Acceptance | Priority |
|----|------|-------------|------------|----------|
| REQ-330 | Event-driven | When a tenant adds a custom web domain, the system shall store it `pending` and return the exact DNS record(s) for subdomain (CNAME) or apex (A). | Record shown by type; status `pending` | Must |
| REQ-331 | Event-driven | When the custom domain's DNS resolves to our ingress, the system shall mark it `verified`. | Poll/re-check flips to `verified` | Must |
| REQ-332 | Event-driven | When Caddy requests authorization for a hostname, the system shall return 200 iff it is a verified tenant custom domain. | Verified → 200; unknown → non-200 | Must |
| REQ-333 | Event-driven | When a request arrives on a verified custom domain, the system shall resolve the tenant via DB (not static env) and serve its public site over auto-issued TLS. | Custom host serves tenant w/ valid cert | Must |
| REQ-334 | Unwanted | If a custom domain is unverified or removed, then the system shall deny TLS authorization and fall back to subdomain resolution. | ask non-200; subdomain still serves | Must |
| REQ-335 | Unwanted | If a tenant submits a reserved/own-infrastructure host as a custom domain, then the system shall reject it. | Our root/app hosts rejected | Must |

## Rollout / Phasing

- **Phase A** (REQ-300/301/310/311/312): subdomain clarity + managed default. No infra, no schema for SMTP. Ships usable zero-config email + clear URLs. Quick.
- **Phase B** (REQ-320–325): `EmailProvider` formalization + SMTP adapter + per-tenant email config + reuse credential cipher. Schema: email settings. No infra.
- **Phase C** (REQ-330–335): custom web domain + Caddy on-demand TLS + DB-driven resolution. Schema: custom-domain status fields. **One-time Caddyfile change** via deploy. Includes seeding AGENTLOOP's domain into the DB path.

Each phase = its own brainstorm/plan → TDD build → manual verify → commit, per the epic's rhythm.

## Testing Strategy

- **Unit (api):** `EmailProvider` selection + SMTP adapter (fake transport, no real send); managed-default sender derivation; `/internal/tls-allow` allowlist logic; custom-domain input validation; DNS-verify state transitions (mock resolver).
- **Unit (web):** email-settings form (mode switch, masked creds), domains card (records by type, statuses, re-check), onboarding read-only sender.
- **e2e:** onboarding shows derived sender + live URL; Settings email mode switch to SMTP (intent only, no real send); add custom web domain → records shown → mocked verify → status verified. **No real external sends / no real cert issuance in tests.**
- **Manual (stack):** managed default broadcast on inference tenant; SMTP via a throwaway provider sandbox; custom web domain end-to-end on a real test domain against the Caddy box (the only step exercising live TLS).

## Out of Scope / Deferred

Per-provider domain-provisioning APIs (SES/SendGrid/Postmark DKIM generation); wildcard custom-apex subdomains + DNS-01; inbound/reply email; bounce/complaint dashboards; suppression-list sync; billing/quota on Resend domain limit; multi-region Caddy clustering; TXT ownership challenge for contested domains (until needed).

## Open Questions

- **O-1:** email config — inline `tenants` columns vs dedicated `tenant_email_settings` table (lean: dedicated table).
- **O-2:** ingress hostname for custom-domain CNAME target — confirm `ingress.vertexcover.io` (or reuse an existing A-record'd host) and its stable IP.
- **O-3:** SMTP "active" check — a real test-send to the tenant admin vs a connection-only verify (lean: connection verify + optional test send).
- **O-4:** do we expose `managed_domain` (own domain on our Resend) AND `smtp` as separate choices, or collapse "bring your own" into SMTP-only? (lean: keep both — `managed_domain` is lower-friction for tenants without an ESP.)

## References (research)

- **Resend** — verified-domain sending (any local-part), domains/DNS: resend.com/docs/dashboard/domains/introduction; 403 domain-mismatch KB.
- **Caddy** — on-demand TLS + `ask`/permission endpoint, automatic HTTPS: caddyserver.com/docs/automatic-https, /docs/caddyfile/options#on-demand-tls.
- **Vercel** — add-a-domain flow, apex A-record, TXT ownership: vercel.com/docs/domains/working-with-domains/add-a-domain.
- **Netlify / Cloudflare** — apex ALIAS/CNAME-flattening; Cloudflare-for-SaaS custom hostnames: docs.netlify.com/domains-https/custom-domains; developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas.
- **Let's Encrypt** — rate limits (300 new orders / 3h account cap): letsencrypt.org/docs/rate-limits.
- **Email patterns** — Ghost (managed bulk vs SMTP), Supabase custom SMTP, Cal.com SMTP env, Sentry SMTP-only, Listmonk multi-SMTP, Nodemailer transports (provider portability).
