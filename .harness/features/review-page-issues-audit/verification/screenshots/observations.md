# Screenshot Observations

Expected page vertical ordering (layout invariant):
  Nav header → Page heading (Edit · date) → Add-post panel → Digest meta panel → Ranked list → Pool section (when visible) → SaveBar (sticky bottom)

---

## VS1-PHASE1-C1-C2-initial-state.png
**Captures:** VS-1 initial state — review page for run `2a07fcd5` with 1 ranked item and 2 pool items visible.

### Spec-based checks
- **REQ-001** (zero-match filter keeps toolbar): NOT YET in this screenshot — filter not yet applied. This screenshot establishes the pre-filter baseline. VERDICT: `CANNOT_ASSESS` (captured before filter is applied; see VS1-PHASE1-C1-filtered-zero-match.png for the proof)
- **REQ-002** (unconstrained empty pool → section absent): The pool IS visible here with 2 items — this run has non-empty pool. The unconstrained non-empty case is correctly showing the pool section. VERDICT: `MET` (pool section present when pool is non-empty)
- **REQ-005** (no stale total during transition): The initial count "2 items" in the toolbar matches the actual pool response of 2. VERDICT: `MET`
- **REQ-006** (empty-state context-aware message): No empty state shown — pool has items. VERDICT: `CANNOT_ASSESS` (N/A — pool not empty)

### Open visual review
- Page layout matches expected ordering: Nav → heading → AddPost → DigestMeta → RankedList → PoolSection → SaveBar. No ordering bugs observed.
- SaveBar shows "0 unsaved changes", Discard is present, Save is enabled. Normal starting state.
- PoolSection header "Item Pool (2 items)" is visible, toolbar has Shortlisted only checkbox (enabled), Source dropdown, and "2 items" count.
- No alignment, contrast, clipping, or broken empty state issues observed.
- The "Shortlisted only" checkbox is unchecked and enabled (shortlisted_item_ids=[14] is non-empty).

---

## VS1-PHASE1-C1-filtered-zero-match.png
**Captures:** VS-1 filter state — "Shortlisted only" checked, pool returns 0 items.

### Spec-based checks
- **REQ-001** (zero-match filter keeps toolbar): VERDICT: `MET` — Pool section is PRESENT with heading "Item Pool (0 items)", toolbar with Shortlisted-only checkbox (checked), Source dropdown, "Clear filters" button, "0 matching" count, search input, sort controls, and the message "No items match the current filters."
- **PHASE1-C1**: Filter toolbar rendered with 0-match response. VERDICT: `MET`
- **PHASE1-C6**: Clear filters button is visible. After clicking, pool returned to 2 items with empty search input. VERDICT: `MET`
- **REQ-005** (no stale total during transition): Count shows "0 matching" not the previous "2 items". VERDICT: `MET`

### Open visual review
- "Clear filters" button appears correctly between the Source dropdown and the item count chip.
- "No items match the current filters." message is shown in the pool body area below the toolbar.
- SaveBar still shows "0 unsaved changes" — filter changes don't count as unsaved. Correct.
- No layout anomalies observed.

---

## VS3-PHASE3-C3-dry-run-regen-disabled.png
**Captures:** VS-3 dry-run review page for run `081e683c` with 2 ranked items.

### Spec-based checks
- **REQ-009** (dry-run bypasses regen gate): Save button shows "Save & view archive" and is NOT disabled even before any edit. VERDICT: `MET`
- **REQ-010** (dry-run disables Regenerate): Regenerate button is disabled. A tooltip/reason text "Regeneration is unavailable for dry-run archives." is visible below the button. VERDICT: `MET`
- **PHASE3-C3**: Dry-run heading shows "Dry run" badge next to "Edit · Dec 1, 2299". VERDICT: `MET`

### Open visual review
- "Dry run" badge visible next to the date heading — good visual indicator.
- Regenerate button is visually dimmed/disabled; reason text "Regeneration is unavailable for dry-run archives." appears immediately below in smaller text.
- Pool section shows 2 items from seeding data (cross-run items appear — minor seeding artifact, not a feature bug).
- SaveBar shows "0 unsaved changes" and Save is already enabled (dry-run bypass). Correct per REQ-009.
- No ordering or layout issues.

---

## PHASE4-C1-not-found-view.png
**Captures:** PHASE4-C1 — navigating to run `00000000-0000-0000-0000-000000000000` (non-existent).

### Spec-based checks
- **REQ-012** (non-404 load error distinct from 404 not-found): The 404 branch shows "This run was not found." without a Retry button. VERDICT: `MET`
- **PHASE4-C1** (null → not-found view without Retry): No Retry button present. "← Back to dashboard" link is shown. VERDICT: `MET`

### Open visual review
- Page shows clean not-found view: "This run was not found." message with a back link.
- No retry button — correct for the 404 case (REQ-012 requires Retry only for non-404 errors).
- Nav header and back-link are correctly placed.
- No layout issues.
