# Verification Proof Report — record-review-edits-as-signals

**Date:** 2026-05-28
**Verdict:** PASSED
**Scope:** Capture-only feature. No UI changes. Verification is API + DB only.

## Evidence

### Phase 1 — diffReview pure helper (REQ-002, EDGE-001/002/003/004/005/007/009/011)

```
$ pnpm --filter @newsletter/shared test:unit
 Test Files  33 passed (33)
      Tests  340 passed (340)
```

16 new tests in `packages/shared/src/review-edits/__tests__/diff.test.ts`:
- diffReview returns [] when snapshot and patch are identical (EDGE-007 / REQ-006)
- Reorder produces one row per moved item (EDGE-001)
- Item present in snapshot but absent in patch → remove row (EDGE-002)
- Item present in patch but absent in snapshot → add row (EDGE-003)
- Per-item recap field edit → text_edit row (EDGE-004)
- Digest meta edit → text_edit row with raw_item_id=null (EDGE-005)
- Item in snapshot.recap but not in rankedItemIds is treated as "not ranked" → add on PATCH (EDGE-009)

### Phase 2 — snapshot at rank-finalize (REQ-001, REQ-008, EDGE-006)

```
$ pnpm --filter @newsletter/pipeline test  # filtered to new tests
 build-pre-review-snapshot.test.ts        7 passed
 run-archives.e2e.test.ts                 4 passed (REQ-001 round-trip, REQ-008 COALESCE no-overwrite, EDGE-006 failed-status writes null, null-to-value semantics)
```

Migration applied against local Postgres: column `pre_review_snapshot jsonb` (nullable) exists on `run_archives`. ON CONFLICT DO UPDATE uses `COALESCE(run_archives.pre_review_snapshot, excluded.pre_review_snapshot)` so existing snapshots are never overwritten.

### Phase 3 — PATCH diff + admin GET (REQ-003, REQ-004, REQ-005, REQ-006, REQ-007, EDGE-008, EDGE-010)

```
$ pnpm --filter @newsletter/api test:e2e -- admin-archives-review-edits
 admin-archives-review-edits.e2e.test.ts  8 passed
```

All 7 scenarios from phase-3.md verified:
- REQ-003 happy path: 5-item archive PATCH with reorder + remove + add + bottomLine edit + digestHeadline edit → all expected `review_edits` rows present with correct fields.
- REQ-006 no-op PATCH → 0 rows in `review_edits`.
- REQ-007 pre-migration archive (`pre_review_snapshot=NULL`) → PATCH succeeds, 0 rows in `review_edits`.
- REQ-003 idempotency on re-PATCH → second PATCH replaces all prior rows (DELETE+INSERT in one tx).
- REQ-004 admin GET returns `preReviewSnapshot` and `reviewEdits[]`.
- REQ-005 public GET response is byte-identical to baseline (no leakage of new fields).
- EDGE-008 cascade delete: DELETE archive → `review_edits` rows for that run gone via FK CASCADE.

### Migration safety (EDGE-011)

Column is nullable with no default → metadata-only ALTER, safe against populated tables (per `.claude/rules/learnings/drizzle-not-null-add-column-existing-rows.md`).

### Typecheck

```
$ pnpm typecheck
 Tasks:    7 successful, 7 total
```

### Pre-existing test failures (NOT caused by this branch)

Baseline `main` has 13 failed test files; worktree has 4. The branch reduces failures, not introduces them. The 4 remaining failures (sns-webhook, sources.e2e, sources-coverage, admin-must-read SameSite) are unrelated to review-edits capture — they are environment/infra failures pre-dating this branch. None of them touch `run_archives`, `review_edits`, `patchArchive`, or the diff helper.

## Adversarial scenarios — covered in `adversarial-findings.md`

## Conclusion

Every REQ and EDGE from the spec verification matrix is covered by an executed test or an inspected guarantee. Public route does not leak admin-only fields. PATCH is transactional. Snapshot is immutable across re-upserts. Feature is capture-only with no UI surface — no Playwright proof required.
