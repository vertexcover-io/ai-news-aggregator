# Adversarial Findings — record-review-edits-as-signals

**Date:** 2026-05-28
**Verdict:** No critical defects. Two accepted design trade-offs documented.

## Scenarios attempted

| # | Attack / Edge | Result |
|---|---------------|--------|
| 1 | Try to overwrite an existing snapshot via a second pipeline upsert (e.g. a retried run hitting the ON CONFLICT path) | **Defended** — `COALESCE(run_archives.pre_review_snapshot, excluded.pre_review_snapshot)` in the SET clause preserves the first snapshot. Verified by `run-archives.e2e.test.ts` REQ-008 case. |
| 2 | Leak `preReviewSnapshot`/`reviewEdits` to the public archive route | **Defended** — public route `createPublicArchivesRouter` (archives.ts:118) builds its response object manually and never reads `archive.preReviewSnapshot` or invokes `reviewEditsRepo.listForRun`. Tested in REQ-005 e2e. |
| 3 | Partial-write window between archive UPDATE and `review_edits` DELETE/INSERT | **Defended** — both run inside one `db.transaction(...)` via `runTransaction`. A failure rolls back both. |
| 4 | Pre-migration archive PATCH explodes because snapshot is NULL | **Defended** — `patchArchive` short-circuits the diff path when `archive.preReviewSnapshot` is null; UPDATE still runs. REQ-007 e2e. |
| 5 | Cascade orphan: DELETE archive leaves `review_edits` rows | **Defended** — FK has `ON DELETE CASCADE`. EDGE-008 e2e verifies. |
| 6 | Failed/cancelled run writes an orphan snapshot | **Defended** — only the success-path upsert in `run-process.ts:983` passes `preReviewSnapshot`. Cancellation (line 1070), all-collectors-failed (line 882), and write-failed (line 665) paths do not. EDGE-006 e2e verifies failed-status archives have NULL snapshot. |
| 7 | Diff helper crashes on missing `recap` entry for a ranked item (snapshot inconsistency) | **Defended** — `diffReview` treats `snapshot.recap[id]` absence as "no text to compare" → no text_edit rows for that item, but still emits structural reorder/remove rows. Tested in EDGE-009. |
| 8 | Multiple concurrent PATCHes on the same archive | **Mitigated** — single admin, single browser tab; no realistic concurrency. The DELETE-then-INSERT pattern inside a transaction is naturally serialised by PG row locks on `run_archives`. |

## Accepted trade-offs (non-blocking)

- **TOCTOU on findById before transaction entry:** `patchArchive` calls `findById` outside the transaction to validate raw_item ids exist, then enters the tx. A race where the archive is deleted between `findById` and the tx start would surface as an UPDATE-affected-0-rows situation — caught by the existing missing-archive error path in the repo. Same risk pre-exists in the original `patchArchive`; no new regression.
- **Backward-compat `createArchivesRouter` (test-only):** This legacy factory mounts admin and public routes without a gate. Production routing uses `createPublicArchivesRouter` + `createAdminArchivesRouter` separately with `requireAdmin` on the admin half. Not a security defect; flagged in pass-1 review for a future JSDoc note.

## Not attempted (out of scope)

- Performance under high write volume on `review_edits` — feature is admin-triggered, traffic is on the order of one PATCH per day, no realistic load concern.
- Encryption-at-rest for snapshot content — internal newsletter data, no PII, matches the existing `run_archives` security model.
- Multi-admin attribution — single shared password by design (`created_at` is the only audit field).

## Conclusion

No defects discovered during adversarial pass. All design promises hold under the attack matrix. Feature is safe to ship.
