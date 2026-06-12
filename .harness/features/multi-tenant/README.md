# Multi-Tenancy (VER-110)

**Final verification verdict:** ✅ **PASS** — functional verification passed with all 29 UI claims independently re-proven via Playwright MCP; quality gate green (typecheck, lint, and the full api/web/shared/pipeline/scripts/eslint-plugin suites). See [verification/proof-report.md](verification/proof-report.md).

> **PR:** https://github.com/vertexcover-io/ai-news-aggregator/pull/284

## What was built

Converts the single-admin newsletter engine into an isolated, self-serve **multi-tenant product**: public signup → per-tenant onboarding (branding, sources, prompts, schedule) → activation → run → review → publish to that tenant's own subscribers, channels, and verified email domain — with a super-admin console and audited impersonation. AGENTLOOP is migrated in as **tenant 0** with zero data loss and unchanged public/publishing behavior. Tenant isolation is enforced at a single repository seam (`tenant_id` scoped on every read **and** stamped on every write), guarded by an extended `enforce-repository-access` lint rule and proven by an adversarial cross-tenant isolation pass.

Delivered across **16 phases** (schema → backfill → auth → tenant-scoped repos → host resolution → super-admin → branding → sources → per-tenant pipeline → scheduling → onboarding wizard → credentials rework → Twitter OAuth2 → email-domain verification → super-admin console → notifications/flags), plus corrective fixes surfaced mid-build and by review.

## Reviewer index

| Artifact | What it is |
|----------|-----------|
| [design.md](design.md) | Full architectural design (brainstorm output) |
| [spec.md](spec.md) | EARS requirements, edge cases, verification matrix |
| [plan.md](plan.md) | 16-phase implementation plan + phase graph |
| [library-probe.md](library-probe.md) | External-dependency trust gate |
| [learnings.md](learnings.md) | Feature-specific isolation/security review digest + verify-breaks |
| [verification/proof-report.md](verification/proof-report.md) | Functional-verification verdict + UI-claim proof (29 UI claims, 16 screenshots) |
| [verification/adversarial-findings.md](verification/adversarial-findings.md) | Role-swap / break attempts (cross-tenant, broadcast gate, secrets, impersonation) |

## Library probe

**Verdict: PASS** — all libraries trusted (pinned + already in production use). **Tavily** `.search()` and **Resend Domains** API verified live; **Twitter OAuth2** confirmed against official docs. No new runtime dependencies. One **pre-launch ops constraint** (not a code blocker): the Resend plan's domain quota (1) vs one-domain-per-tenant — must be sized before onboarding real tenants.

## Migrations

`0040`–`0049` (additive nullable → backfill → enforce ordering; composite-PK re-key of `social_credentials`/`social_tokens` preserving AGENTLOOP ciphertext verbatim; tenant-scoped unique re-keys on `subscribers` and `raw_items`; AGENTLOOP sending-domain grandfather). Applied and verified against the dedicated `newsletter_mt` DB.

## Known follow-ups (non-blocking)

- **Resend domain quota** (ops): size the plan before launch (library-probe finding).
- **Adversarial minors** (from `adversarial-findings.md`): app-host-with-no-slug cross-tenant fallback (ADV-1), Canon flag gates nav but not page/API content (ADV-2 / EDGE-014 partial), double-activate returns a misleading 409 (ADV-3). None break isolation.
- The live-Resend `|network|` newsletter-send e2e is gated by the external Resend daily quota (environmental); it passes the broadcast gate (proven) and fails only on the account quota.
