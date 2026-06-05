# Record Review Edits as Signals

**Verification:** [PASSED](verification/proof-report.md)
**PR:** _(to be filled in after push)_

## Summary

Captures admin review edits (rank reordering, item add/remove, recap text edits, digest meta edits) as structured data so future eval/prompt-tuning has a clean signal of what admins actually change. Capture-only — no eval integration in this PR.

A new `pre_review_snapshot` JSONB column on `run_archives` records the LLM's rank output at rank-finalize time. A new `review_edits` table records the diff between snapshot and the admin's curated archive, computed transactionally on every `PATCH /api/admin/archives/:runId`.

## Artifacts

| Doc | Purpose |
|-----|---------|
| [design.md](design.md) | Problem, approaches considered, chosen approach + trade-offs |
| [spec.md](spec.md) | EARS-format requirements (8 REQs, 11 EDGEs), verification matrix |
| [plan.md](plan.md) | Three-phase plan with DOT phase graph |
| [library-probe.md](library-probe.md) | NOT_APPLICABLE — pure-internal feature, no external deps |
| [verification/proof-report.md](verification/proof-report.md) | Test evidence per REQ/EDGE |
| [verification/adversarial-findings.md](verification/adversarial-findings.md) | Attack-matrix pass results |

## What ships

- **Migration 0035** adds `run_archives.pre_review_snapshot` (nullable JSONB) and a new `review_edits` table with `ON DELETE CASCADE`.
- **`@newsletter/shared/review-edits`** new subpath: `diffReview(snapshot, patch) → ReviewEditRow[]` pure function.
- **Pipeline**: success-path rank-finalize upsert now writes the snapshot. `COALESCE` semantics ensure the snapshot is immutable across retries.
- **API**: `patchArchive` computes the diff and replaces `review_edits` rows in the same Drizzle transaction as the archive UPDATE. Admin `GET /api/admin/archives/:runId` returns `preReviewSnapshot` and `reviewEdits[]`; the public `GET /api/archives/:runId` is byte-identical to before.

## What's deferred (out of scope)

- Eval Mode C (scoring new prompt against human-edited order via NDCG/Kendall tau)
- LLM pattern-mining to suggest prompt amendments from edit history
- UI surfacing of edits in `/admin/review/:runId`
- Backfill of historical archives (pre-migration runs stay `snapshot=NULL`)

These are all unblocked by this capture layer and can ship as follow-up PRs.
