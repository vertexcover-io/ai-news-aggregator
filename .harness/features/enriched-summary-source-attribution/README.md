# enriched-summary-source-attribution

**Verification verdict:** ✅ PASSED ([proof-report.md](./verification/proof-report.md))
**Library probe:** NOT_APPLICABLE — no external dependencies ([library-probe.md](./library-probe.md))
**Code review:** APPROVE (2-pass; pass-1 fixed 2 Critical + 1 Important)

## Summary

For HN, Reddit, and Twitter items, the rerank LLM and recap LLM now prioritise the **enriched link's markdown** (the actual blog post body) over the native source text when generating story summaries. When the summary is sourced from an enriched link, the per-story source chip — rendered in both the public archive page and the newsletter email — shows the publication's hostname (e.g. `theverge.com`) instead of the platform label (`X / Twitter`), and the "Read source ↗" link retargets to the enriched URL. Native-sourced summaries (HN Ask, Reddit selftext, tweets without outgoing URLs) keep the existing platform label and link target. A launch-date gate (`ENRICHED_SUMMARY_LAUNCHED_AT`) prevents retroactive relabelling of archives created before this change.

## Artifacts

| Document | Purpose |
|---|---|
| [`design.md`](./design.md) | Problem framing, edge case enumeration, approach comparison |
| [`spec.md`](./spec.md) | EARS-format requirements (REQ-001 … REQ-027) and verification scenarios |
| [`plan.md`](./plan.md) | 5-phase implementation plan with phase DAG |
| [`library-probe.md`](./library-probe.md) | External dependency probe (NOT_APPLICABLE) |
| [`verification/proof-report.md`](./verification/proof-report.md) | Functional verification verdict + test coverage matrix |
| [`verification/adversarial-findings.md`](./verification/adversarial-findings.md) | Role-swap pass — 12 attack scenarios |

## PR

https://github.com/vertexcover-io/ai-news-aggregator/pull/205

## Files touched

| Package | Files |
|---|---|
| `@newsletter/shared` | `services/summary-source.ts` (NEW), `services/index.ts`, `constants/index.ts`, `types/run.ts` |
| `@newsletter/pipeline` | `services/candidate-loader.ts`, `services/add-post-helper.ts`, `workers/email-send.ts`, `lib/email-render.ts` |
| `@newsletter/api` | `services/rank-hydration.ts`, `services/review.ts`, `routes/archives.ts`, `routes/runs.ts`, `lib/email/templates/newsletter.tsx` |
| `@newsletter/web` | `components/ArchiveStoryCard.tsx` |

Plus comprehensive unit + RTL test coverage across all four packages (2458 tests passing).

## Notes for reviewers

- **Pass-1 code review caught a defect (C-1)** worth understanding: the live email path (`packages/pipeline/src/lib/email-render.ts`) was importing `NewsletterStory` from a deprecated mirror (`newsletter-send.ts`), so the new fields would have been silently dropped on the wire even though the api template was correctly updated. TypeScript's structural subset compatibility missed this. Pass-1 fixed by re-pointing the import. Pass-2 walked the live path end-to-end to verify.
- **The `NewsletterStory` interface is defined in two places** (`pipeline/workers/email-send.ts` and `api/lib/email/templates/newsletter.tsx`). They are currently structurally identical, but this dual-definition is a latent maintenance risk noted in `adversarial-findings.md::A7`. Consolidation into `@newsletter/shared` is recommended as a follow-up.
- **Cost impact monitoring:** rerank stage input tokens will grow for Twitter link-tweets (was using tweet text ≤280 chars; now using enriched markdown ≤100 KB). Expected first-run cost delta: +5–15%. Rollback condition: `cost_breakdown.stages.rank.totalCostUsd` > 2× baseline. Documented in `verification/proof-report.md::§4`.
