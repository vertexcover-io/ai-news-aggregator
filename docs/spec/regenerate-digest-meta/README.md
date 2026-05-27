# Regenerate Digest Meta on Review Page

**Verification verdict:** ✅ PASS — see [verification/proof-report.md](verification/proof-report.md).
All Must requirements verified; all six observable `type:"ui"` claims independently re-proven via Playwright MCP
with committed screenshots; adversarial pass clean across 15 scenarios (0 defects); quality gate PASS.

**PR:** https://github.com/vertexcover-io/ai-news-aggregator/pull/216

## Summary

The four digest-level fields — `headline`, `summary`, `hook`, `twitterSummary` — were generated once during the
stage-2 rerank LLM call and never reflected manual curation. This feature adds a **DigestMetaPanel** directly
below the "Add a post" panel on `/admin/review/:runId`: four editable fields plus a **Regenerate** button that
synthesizes all four from the *current* curated ranked items (including unsaved reorders/edits) in one click,
always overwriting. The values are editable inline, persist with the review Save (`PATCH
/api/admin/archives/:runId`), and survive reload. Regenerating the headline/summary also recomputes the public
FTS `search_text`. Auto-review's rank-time generation + save is unchanged.

## What changed

- **Shared:** extracted `DIGEST_META_INSTRUCTIONS` + the `digestSchema`/`DigestMeta` type into
  `@newsletter/shared/constants` (single source of truth); `DEFAULT_RANKING_PROMPT` recomposes it byte-identically.
  Widened the `CostStage` union with `"digest"`.
- **Pipeline:** new `generateDigestMeta(items, options)` processor — a digest-only `generateObject` call with the
  same model/retry/cost-tracking as the reranker. `rank.ts` now imports the shared `digestSchema` (no behavior change).
- **API:** `POST /api/admin/archives/:runId/regenerate-digest-meta` (admin-gated; returns the blob, **no persist**;
  404/409/502/400 paths). `PATCH /api/admin/archives/:runId` now accepts the four optional digest fields
  (omit = preserve, null/`""` = write) and recomputes `search_text` from the effective post-patch headline/summary.
  Admin detail exposes `twitterSummary`; the public detail does not.
- **Web:** `DigestMetaPanel.tsx` below `AddPostPanel`; `regenerateDigestMeta` API client; review Save sends the four fields.

## Artifacts

| Document | Purpose |
|----------|---------|
| [design.md](design.md) | Approved design + user decisions + dependency/fallback chain |
| [spec.md](spec.md) | 21 EARS requirements + 9 edge cases + verification matrix |
| [plan.md](plan.md) | 4-phase implementation plan + DOT phase graph + codebase context |
| [library-probe.md](library-probe.md) | NOT_APPLICABLE — no new external deps (AI SDK digest call already proven by rerank) |
| [learnings.md](learnings.md) | Task-specific learnings |
| [verification/proof-report.md](verification/proof-report.md) | Functional-verify verdict + per-claim Playwright evidence |
| [verification/adversarial-findings.md](verification/adversarial-findings.md) | 15 break-it scenarios attempted (0 defects) |
| [verification/screenshots/](verification/screenshots/) | Playwright MCP screenshots per UI claim |

## Library-probe verdict

**NOT_APPLICABLE / PASS** — zero new external dependencies. The only external surface (`generateObject` against
the Anthropic API with `digestSchema`) is already exercised every pipeline run by the stage-2 reranker. No new
SDK surface, auth, or response shape was introduced.
