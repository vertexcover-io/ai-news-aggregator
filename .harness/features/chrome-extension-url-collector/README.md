# Chrome Extension — Add URL to Next-Day Newsletter

> **Verification verdict:** ✅ PASS — see [verification/proof-report.md](verification/proof-report.md)
> **PR:** https://github.com/vertexcover-io/ai-news-aggregator/pull/289

A Manifest V3 Chrome extension (`@newsletter/extension`) that lets a logged-in operator add
the current tab's URL so it becomes a ranked candidate in the next newsletter run. The
extension authenticates via a new bearer-token API path isolated from the admin cookie gate;
submissions are stored in `raw_items` as a new `manual` source type and picked up by the next
run's candidate query.

## Artifacts
- [design.md](design.md) — problem, decisions (bearer auth, raw_items ingestion, popup UI), architecture
- [spec.md](spec.md) — 15 REQs, 6 edge cases, verification matrix, VS scenarios
- [plan.md](plan.md) — 4-phase plan + phase graph
- [library-probe.md](library-probe.md) — dependency trust gate (verified)
- [verification/proof-report.md](verification/proof-report.md) — PASS verdict + test evidence
- [verification/adversarial-findings.md](verification/adversarial-findings.md) — break attempts (2 fixed)

## Library probe verdict
**Selected:** `@crxjs/vite-plugin` 2.6.1 (built a loadable MV3 dist — verified) + `@playwright/test`
1.59.1 (loaded the unpacked extension, derived the deterministic id — verified) + `hono/cors`.
Fallback chain `wxt → manual vite build` was declared but not needed (primary verified first try).
The 2025 crxjs maintenance concern is resolved (active, 332k weekly downloads).

## What was built
- `packages/extension/` — MV3 popup (login + add-current-tab), deterministic id `alnmmlkpbceggejnpiajajenakencoeb`.
- `packages/api` — `extension-token.ts` (`ext|` HMAC), `extension-middleware.ts` (`requireExtensionAuth`),
  `routes/extension.ts` (login + submissions + scoped CORS factory), `services/user-submissions.ts`.
- `packages/shared` — `"manual"` SourceType + labels; `manual` made an eligible candidate source.
- E2E suite loading the unpacked extension against hermetic PG+Redis+API (5/5 pass, real browser).

## How to load manually
`pnpm --filter @newsletter/extension build`, then chrome://extensions → Developer mode →
Load unpacked → `packages/extension/dist`.
