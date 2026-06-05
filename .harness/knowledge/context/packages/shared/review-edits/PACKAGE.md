---
governs: packages/shared/src/review-edits/
last_verified_sha: ad0153a
key_files: [diff.ts, types.ts]
flow_fns: [diff.ts::diffReview]
decisions: []
status: active
---

# review-edits/ — review diff computation between pre-review snapshot and saved patch

## Purpose
Computes an edit audit trail when admin saves a review. diffReview compares the pre-review snapshot against the saved patch to produce ReviewEditRow entries for the review_edits table.

## Public surface
- diffReview(snapshot, patch) → ReviewEditRow[] — computes add/remove/reorder/text_edit rows
- PreReviewSnapshot, ReviewEditRow, EditType = "reorder" | "add" | "remove" | "text_edit"

## Depends on / used by
Uses: none (pure computation)
Used by: api (PATCH /api/admin/archives/:runId)

## Data flows
diffReview(snapshot, patch) → ReviewEditRow[]:
  1. Remove: ids in snapshot not in patch → { editType: "remove", positionBefore, positionAfter: null }
  2. Add: ids in patch not in snapshot → { editType: "add", positionBefore: null, positionAfter }
  3. Reorder: ids in both with position change → { editType: "reorder", field: "rank" }
  4. Text edits on item fields: compare title/summary/bullets/bottomLine → { editType: "text_edit" }
  5. Digest meta text edits: compare digestHeadline/digestSummary/hook/twitterSummary

## Gotchas / landmines
1. Bullets compared via JSON.stringify — correct for string arrays
2. Text edits only fire when field is explicitly provided in the patch (partial update semantics)
3. Added items have no recap to compare (not in snapshot)
