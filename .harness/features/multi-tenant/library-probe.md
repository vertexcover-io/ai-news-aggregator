# Library Probe — Multi-Tenancy (VER-110)

> **Run at:** 2026-06-10
> **Verdict:** PASS — all libraries trusted (pinned + in production use); Tavily + Resend Domains verified live; Twitter OAuth2 confirmed against official docs. **One scaling constraint to resolve before launch: Resend plan domain quota (1) vs one-domain-per-tenant.**

## Summary

| Library | Version (pinned) | Health | In-repo use (proven) | New use-case for this feature | Live smoke |
|---|---|---|---|---|---|
| `resend` | 6.12.2 | trusted | email send (`resend-provider.ts`) | **Domains API** (`domains.create`/`list`/`get`) for per-tenant verification | **VERIFIED** (full-access key) — `domains.list` OK; `create` reaches API, blocked only by **plan quota = 1 domain** |
| `@ai-sdk/anthropic` | 2.0.74 | trusted | rank / shortlist / recap / digest-meta | prompt generation (same `generateText`) | Not run — same call shape already in production (low risk) |
| `@tavily/core` | 0.7.3 | trusted | web-search collector (`providers/tavily.ts`) | source discovery (same `.search()`) | **VERIFIED** (exit 0, returned candidate URLs) |
| `twitter-api-v2` | 1.29.0 | trusted | posting via OAuth1 (`social/twitter/*`), `oauth.ts` present | **OAuth2 3-legged** user authorize for per-tenant posting | CONFIRMED via official docs (3-legged can't be smoke-tested headlessly) |
| `rettiwt-api` | 7.0.3 | trusted | shared Twitter collector | unchanged (shared, internal) | n/a |
| LinkedIn OAuth | (custom + openid) | trusted | `routes/linkedin-oauth.ts` (working) | unchanged (shared app client; per-tenant tokens) | n/a — already in production |

## Live results (2026-06-10)

- **Tavily `.search()` → VERIFIED.** `probes/tavily/probe.log`: exit 0, returned 5 real candidate source URLs for an inference-newsletter topic. The source-discovery use-case works as designed.
- **Resend Domains API → VERIFIED (full-access key).** With the full-access key: `domains.list` → exit 0, returned the existing `news.vertexcover.io` (status=verified). `domains.create` reaches the API and is rejected only by the account **plan quota**: `403 validation_error "Your plan includes 1 domain. Upgrade to add more."` So the lib + auth + endpoint are correct end-to-end.
  - **CAPACITY CONSTRAINT (significant):** per-tenant verified domains means **one Resend domain identity per tenant**. The current plan caps at **1 domain**. Production must use a Resend plan whose domain quota scales with the tenant count, *or* reconsider the sending model at scale (SES has far higher identity limits; or shared-domain-with-per-tenant-subaddressing). This is the single biggest scaling risk surfaced by the probe.
  - Earlier run with the send-only key returned `401 restricted_api_key` — so the domains path also requires a **full-access** key, separate from the send-only delivery key.
- **Twitter OAuth2 posting → CONFIRMED (docs).** `twitter-api-v2` provides the full 3-legged user-context flow:
  - `generateOAuth2AuthLink(callbackUrl, { scope: ['tweet.read','tweet.write','users.read','offline.access'] })` → `{ url, codeVerifier, state }` (persist `codeVerifier` + `state` per tenant, e.g. Redis, like the existing LinkedIn CSRF state).
  - `loginWithOAuth2({ code, codeVerifier, redirectUri })` → `{ accessToken, refreshToken, expiresIn }` (store encrypted, keyed `(tenant_id, 'twitter')`).
  - `refreshOAuth2Token(refreshToken)` for the `offline.access` refresh (mirror the existing LinkedIn `FOR UPDATE` token-refresh pattern, D-109).
  - `loggedClient.v2.tweet(text)` to post. Requires an OAuth2 (not OAuth1) Twitter app with client id/secret + the callback registered.

## Health assessment

All five third-party libraries are **already pinned dependencies in active production use** in this monorepo, with working integration code for adjacent flows. None are "beliefs" — registry-health heuristics are moot because the repo is the evidence: they ship and run today. `.harness/runtime/multi-tenant/probes/health.json` records the snapshot.

**Risk concentrates in two genuinely-new API surfaces on already-trusted libraries:**
1. **Resend Domains API** — current code only calls `emails.send`; per-tenant sending-domain verification needs `domains.create` + `domains.get` (DNS-record + status semantics). New endpoint, same auth/key.
2. **Twitter OAuth2 3-legged posting** — current posting uses OAuth1 manual keys; per-tenant posting needs the OAuth2 user-context authorize/callback/refresh flow. `twitter-api-v2` supports it and `social/twitter/oauth.ts` already exists, but the 3-legged flow is new.

The other three new use-cases (Anthropic prompt-gen, Tavily discovery, LinkedIn OAuth) are the **same call shapes already running in production** — lowest risk.

## Probe scripts (retained for functional-verify re-runs)

Keys were sourced from the project `.env` (RESEND/TAVILY/ANTHROPIC present there). Scripts kept under `.harness/runtime/multi-tenant/probes/`:
- `resend/probe-domains.mjs` · `tavily/probe-search.mjs` · `twitter/probe-oauth2.mjs`

## Setup Needed (for production / full verification)

- **Resend full-access key** — done; `domains.list`/`create` now reach the API (full-access key in `.env`). Delivery path can keep a send-only key.
- **Resend plan with sufficient domain quota** — current plan = **1 domain**. Per-tenant verified domains need a plan whose domain limit ≥ expected active tenants (or a re-architected sending model). **Decision required before scale** — see design Risks/Open Questions.
- **Twitter OAuth2 app** — create an OAuth2 app (client id/secret) in the X developer portal with the per-tenant callback registered; needed to exercise the authorize/callback/refresh flow end-to-end.

## Pivot Log

None — no library failed. All declared libraries are present and trusted; no fallback was needed.

## Design/spec impact

- **Resend key scope (resolved):** per-tenant domain verification needs a *full-access* Resend key (done). Captured in design.md (External Dependencies → Resend).
- **Resend domain quota (new scaling risk, applied):** one Resend domain identity per tenant vs current plan limit of 1. Added to design.md Risks + Open Questions and noted on spec REQ-084/085.
- Fallback chains stay valid (Resend → SES → SMTP; Tavily → LLM-only → static catalog; per-channel skip for social).
- Twitter OAuth2 flow is now pinned to concrete `twitter-api-v2` calls (see Live results) — folded into the design's External Dependencies note for the planner.

<!-- LP:VERDICT:PASS -->
