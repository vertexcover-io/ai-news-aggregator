# Multi-Tenant Local Development

How to run, browse, and seed the multi-tenant stack locally. Deployment wiring
(Caddy, wildcard TLS) lives in [deploy.md](./deploy.md); the production cutover
is in [migration-runbook.md](./migration-runbook.md).

## Run it

```bash
pnpm install
pnpm infra:up                                   # Postgres :5433 + Redis (podman)
pnpm --filter @newsletter/shared db:migrate     # includes tenant migrations 0040-0042
pnpm dev                                        # api :3000, web :5173, pipeline workers
```

Minimal `.env` (repo root): `DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET`
(≥32 bytes). Everything else degrades gracefully — see the env reference below.

## Hosts in dev

Tenant resolution is Host-header based. `lvh.me` and every `*.lvh.me`
subdomain resolve to `127.0.0.1` via real public DNS, so no `/etc/hosts`
edits are needed. Defaults: `APP_ROOT_DOMAIN=lvh.me`, `APP_HOST=app.lvh.me`.

| URL | Surface |
|-----|---------|
| `http://app.lvh.me:5173` | App host: signup, login, `/admin`, `/onboarding`. No public tenant surface (public APIs 404 here by design). |
| `http://<slug>.lvh.me:5173` | That tenant's public site: branded home, archives, subscribe. Only `active` tenants resolve; renamed slugs 301 to the new host. |
| `http://localhost:5173` | Unknown host — admin/auth routes still work (session-based), public tenant routes 404. |

The Vite proxy forwards the browser's Host header unchanged
(`changeOrigin: false` in `packages/web/vite.config.ts`) — that is what makes
`<slug>.lvh.me:5173` resolve the tenant through the dev server.

### X-Tenant-Slug fallback (non-production only)

When `NODE_ENV !== "production"`, the API honors an `X-Tenant-Slug` header as
an override for the Host header — handy for curl and for hermetic Playwright
(which browses `127.0.0.1`):

```bash
curl -H "X-Tenant-Slug: acme" http://127.0.0.1:3000/api/public/tenant-config
```

In production the header is ignored; only real Hosts resolve.

## Signup → onboarding flow

1. `http://app.lvh.me:5173/signup` — creates a user + `pending_setup` tenant
   and a session; lands in the 8-step wizard at `/onboarding`.
2. Wizard steps: name → slug (debounced availability check; reserved words
   like `app`/`admin`/`api` rejected) → logo (optional) → homepage text →
   prompts (LLM generation needs `ANTHROPIC_API_KEY`, otherwise 503 — paste
   prompts manually) → channels (optional) → sources (≥1 required; discovery
   needs `TAVILY_API_KEY` + `ANTHROPIC_API_KEY`) → schedule.
3. **Activate** validates completeness (422 + clickable missing-steps list),
   flips the tenant to `active`, and registers its per-tenant schedulers.
4. The public site is then live at `http://<slug>.lvh.me:5173`.

## Seeding tenant 0 (AGENTLOOP) and super admins

Fresh DBs have no tenant 0 user. Seed with the idempotent migration script:

```bash
AGENTLOOP_ADMIN_EMAIL=you@vertexcover.io \
AGENTLOOP_ADMIN_PASSWORD='choose-a-password' \
SUPER_ADMIN_EMAILS=root@vertexcover.io \
SUPER_ADMIN_PASSWORD='choose-another' \
pnpm --filter @newsletter/api migrate:agentloop

pnpm --filter @newsletter/api verify:migration   # row parity + scoping checks
```

Super admins log in at `/login` like anyone else but land on `/admin/tenants`
and act on a tenant only via impersonation (banner + audited start/stop).

## Tests

```bash
pnpm --filter @newsletter/web test:unit     # vitest (jsdom)
pnpm --filter @newsletter/web test:bundle   # build + REQ-125 bundle secret scan
pnpm --filter @newsletter/web test:e2e      # hermetic Playwright: ephemeral PG/Redis,
                                            # real API; includes the VS-1/VS-3/VS-4
                                            # multi-tenant journeys
```

The e2e harness force-blanks `ANTHROPIC_API_KEY` / `TAVILY_API_KEY` /
`RESEND_API_KEY` / `SLACK_WEBHOOK_URL` so journeys are deterministic and never
send anything real.

## Environment variable reference

Required:

| Var | Used for |
|-----|----------|
| `DATABASE_URL` | Postgres (api, pipeline, scripts) |
| `REDIS_URL` | BullMQ queues, OAuth state, auth rate limiting |
| `SESSION_SECRET` | Session cookies, subscriber tokens, **HKDF KEK for encrypted credentials at rest — never rotate casually (EC10)** |

Multi-tenant host + auth wiring (new in the multi-tenancy build):

| Var | Default | Used for |
|-----|---------|----------|
| `APP_ROOT_DOMAIN` | `lvh.me` | Root domain; tenants live at `<slug>.<root>` |
| `APP_HOST` | `app.<APP_ROOT_DOMAIN>` | The admin/app host (no public tenant surface) |
| `TENANT0_CUSTOM_DOMAIN` | unset | Extra apex that resolves to tenant 0 (e.g. the legacy AGENTLOOP domain) |
| `TRUST_PROXY_HOPS` | `0` | How many reverse proxies to trust for `X-Forwarded-For` rate-limit keying. **Must be ≥1 behind Caddy, must stay 0 without a proxy** |
| `AGENTLOOP_ADMIN_EMAIL` / `AGENTLOOP_ADMIN_PASSWORD` | unset | `migrate:agentloop` — tenant-0 admin user |
| `SUPER_ADMIN_EMAILS` / `SUPER_ADMIN_PASSWORD` | unset | `migrate:agentloop` — comma-separated super-admin seed |

Pipeline scheduling (new):

| Var | Default | Used for |
|-----|---------|----------|
| `PIPELINE_RUN_CONCURRENCY` | `1` | Global cap on concurrent tenant pipeline runs (REQ-065) |
| `PIPELINE_START_JITTER_MS` | `180000` | Scheduled-run start jitter window so shared schedules don't stampede sources; `0` disables |
| `TWITTER_COLLECTOR_RATE_PER_SECOND` | provider default | Twitter collector throttle |

Email + broadcast:

| Var | Used for |
|-----|----------|
| `EMAIL_PROVIDER` | `resend` (default) or `ses` |
| `RESEND_API_KEY` | Resend sends; **full-access** key required for per-tenant sending-domain register/verify (503 when unset) |
| `AWS_REGION` / `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (/`AWS_SESSION_TOKEN`) | SES provider + SNS webhook verification |
| `FROM_MAIL`, `BROADCAST_FROM_LOCALPART`, `NEWSLETTER_REPLY_TO_EMAIL` | Sender identities; broadcasts use `<localpart>@<verified tenant domain>` |
| `EMAIL_SEND_RATE_PER_SECOND` | Send throttle |
| `NEWSLETTER_BASE_URL`, `BASE_URL`, `PUBLIC_BASE_URL` | Link bases for confirm/unsubscribe/archive URLs (per-tenant public URLs derive from `APP_ROOT_DOMAIN`) |

Integrations (each disabled/503 when unset):

| Var | Used for |
|-----|----------|
| `ANTHROPIC_API_KEY` | Ranking/shortlist LLM + onboarding prompt generation |
| `DEEPSEEK_API_KEY` | Web-collector LLM steps |
| `TAVILY_API_KEY` | Web search collector + onboarding source discovery |
| `RETTIWT_API_KEY` | Twitter collector fallback |
| `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` / `LINKEDIN_API_VERSION` | LinkedIn OAuth app (per-tenant connect) |
| `TWITTER_OAUTH_CLIENT_ID` / `TWITTER_OAUTH_CLIENT_SECRET` | Twitter/X OAuth app (per-tenant connect) |
| `TWITTER_API_KEY` / `TWITTER_API_SECRET` / `TWITTER_ACCESS_TOKEN` / `TWITTER_ACCESS_TOKEN_SECRET` | Legacy tenant-0 OAuth 1.0a posting fallback |
| `SLACK_WEBHOOK_URL` | Tenant-0 Slack notifications fallback (per-tenant webhooks live in settings) |
| `POSTHOG_PROJECT_TOKEN` or `POSTHOG_API_KEY`, `POSTHOG_HOST`, `POSTHOG_ENABLED` | Analytics + error tracking |
| `RANKING_MODEL`, `SHORTLIST_MODEL`, `WEB_CRAWLER_CONCURRENCY` | Pipeline tuning |

Credentials saved per tenant at `/admin/settings` are stored encrypted in the
DB and shadow these env vars (DB-first resolution per pipeline job).
