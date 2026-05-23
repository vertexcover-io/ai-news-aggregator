# Eval ranker ranks the deduped collected pool, correlated by run_id

**Final verification verdict: PASS** — see [verification/proof-report.md](verification/proof-report.md).
**Quality gate: PASS** (`.harness/eval-ranker-shortlist-fix/quality-gate.md`, gitignored).

## Summary

Calendar-mode (Mode B) eval at `/admin/eval` now re-ranks the **deduplicated** set of
items collected during the selected run, attributed by a new nullable
`raw_items.run_id` column (stamped during collection; time-window fallback for
pre-migration archives). Previously the eval ranked an un-deduplicated, time-window
approximated pool and reported an inconsistent `itemCount`, which made it look like
only the already-ranked items were available — so a better prompt could not surface
items the original ranking buried. Now the ranker sees the full deduped candidate
pool the original run chose from, and the draft ranking can promote items the
original `rankedItems` never contained. `itemCount` is the deduped pool size and is
identical between the calendar list row and the loaded run detail.

## What changed
- `raw_items.run_id` (nullable uuid + index) — migration `0028_calm_rocket_racer.sql`.
- Collection stamps `run_id`; `upsertItems` updates it on conflict (add-post stays NULL).
- `eval-exports.ts::loadDedupedPool` — load by `run_id` → window fallback → `dedupCandidates`.
- `getCompletedRunDetail` + `listCompletedRunsByDate` both use it (consistent `itemCount`).

## Artifacts
| Doc | What |
|-----|------|
| [spec.md](spec.md) | EARS requirements (REQ-001..010), edge cases, verification scenarios |
| [plan.md](plan.md) | 5-phase implementation plan + phase graph |
| [learnings.md](learnings.md) | Pipeline friction: time-window approximation was the root smell |
| [verification/proof-report.md](verification/proof-report.md) | Functional-verify verdict (incl. Playwright UI proof PHASE4-C1/VS-6) |
| [verification/adversarial-findings.md](verification/adversarial-findings.md) | Role-swap break attempts |

(`design.md` and `library-probe.md` are produced during the pipeline but
gitignored per the project's `docs/spec/**` allowlist; their content is folded into
`spec.md` and this README.)

**Library-probe verdict:** NOT_APPLICABLE — uses only Drizzle, PostgreSQL, and the
in-repo `dedupCandidates` processor (all already in stack); no alternatives needed.

**PR:** Part of [#179](https://github.com/vertexcover-io/ai-news-aggregator/pull/179)
(feat/ranking-eval-pipeline) — commits `a37e392` (fix) + `c753a9f` (artifacts).
