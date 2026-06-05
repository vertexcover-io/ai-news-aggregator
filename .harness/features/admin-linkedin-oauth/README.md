# Admin LinkedIn OAuth + Failed-Post Slack Alerting

**Verification verdict:** ✅ PASS — see [verification/proof-report.md](verification/proof-report.md)
**Quality gate:** ✅ PASS (9/9 checks)
**Library probe:** PASS — no new dependency; LinkedIn OAuth API (already in production use) verified reachable + pure-fn covered. See [library-probe.md](library-probe.md).
**PR:** https://github.com/vertexcover-io/ai-news-aggregator/pull/215

## Summary

On the 2026-05-27 daily run, email and X posted on schedule but LinkedIn silently did
not — its access token had expired with no refresh token stored, and the only way to
re-auth was a manual `tsx` script reading client secrets from env. This work adds a
server-side LinkedIn OAuth flow so an admin can connect/reconnect entirely from
`/admin/settings` (producing access **and** refresh tokens), stores those tokens
encrypted at rest in `social_tokens` (AES-256-GCM, consistent with `social_credentials`),
surfaces connection status in the UI, and wires the already-built-but-never-called
`notifyPublishFailed` into the LinkedIn/X workers so a failed auto-post is no longer silent
on Slack.

## Artifacts

| Doc | What |
|-----|------|
| [design.md](design.md) | Approved design — architecture, decisions, data flow |
| [spec.md](spec.md) | 14 EARS requirements, 8 edge cases, verification matrix |
| [plan.md](plan.md) | 4-phase implementation plan + phase graph |
| [library-probe.md](library-probe.md) | LinkedIn OAuth dependency verdict (VERIFIED) |
| [learnings.md](learnings.md) | Pipeline-friction + migration-defect learnings |
| [verification/proof-report.md](verification/proof-report.md) | Functional verification gate output (the verdict) |
| [verification/adversarial-findings.md](verification/adversarial-findings.md) | Role-swap break-it pass |
| [verification/screenshots/](verification/screenshots/) | 6 Playwright UI-claim screenshots (C1–C6) |

## Phases (all committed)

1. `feat(shared): encrypt social_tokens access/refresh tokens at rest` — migration 0034, cipher-aware repo
2. `fix(pipeline): alert Slack when LinkedIn/X auto-post fails` — wire `notifyPublishFailed`
3. `feat(api): admin LinkedIn OAuth start + callback routes` — state-gated callback, encrypted token write
4. `feat(web): LinkedIn connection status + Connect button in settings` — `/admin/settings` UI
   plus `fix(review): safe social_tokens migration + graceful decrypt-failure skip`

## Operator actions required after deploy

1. Register the redirect URI on the LinkedIn Developer app:
   `https://agentloop.vertexcover.io/api/admin/social-credentials/linkedin/oauth/callback`
2. Enable **Programmatic refresh tokens** on the LinkedIn app (Auth tab) so the OAuth flow
   returns a refresh token — otherwise the connection works but won't self-renew.
3. Migration 0034 **wipes the existing `social_tokens` rows** (the dead token can't be
   re-encrypted). After deploy, reconnect LinkedIn via `/admin/settings` and re-run
   `scripts/auth-twitter.ts` for Twitter.
4. _(Optional)_ Re-trigger today's failed run `1172e372` via
   `POST /api/runs/1172e372-e5f4-4a84-b65f-43c28ddf3948/post/linkedin` if today's LinkedIn
   post is still wanted.
