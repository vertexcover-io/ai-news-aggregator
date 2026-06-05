# SPEC: Review Page Robustness Fixes

**Source:** .harness/features/review-page-issues-audit/design.md
**Generated:** 2026-06-05

All changes are in `packages/web` only (NF1). Design F-IDs are noted per row for
traceability.

## Requirements

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-001 | Event-driven | When any source/shortlist filter or pool search is active and the filtered pool total is 0, the Item Pool section shall remain rendered with its header, filter toolbar, active chips, search input, and sort controls. (F1) | With an active filter and a 0-total pool response, the toolbar and "Clear filters" control are present in the DOM and the message "No items match the current filters." is shown | Must |
| REQ-002 | State-driven | While no filter or search constraint is active and the unconstrained pool total is 0 (not loading, no error), the Item Pool section shall not render. (F2) | Unconstrained 0-total response → section absent from DOM; legacy runs (null `startedAt`/`sourceTypes`) still render "Pool unavailable for this run" | Must |
| REQ-003 | Unwanted | If the pool query ends in an error state, then the Item Pool section shall render an error message with a Retry control that triggers a refetch, with the filter toolbar still rendered. (F3) | Pool fetch rejection → error text + Retry button rendered alongside the toolbar; clicking Retry issues a new pool request | Must |
| REQ-004 | Unwanted | If the source-facets query ends in an error state, then the Source dropdown shall render an error message with a Retry control instead of "No sources found". (F4) | Facets fetch rejection → dropdown shows error text + Retry; "No sources found" absent | Must |
| REQ-005 | Ubiquitous | The pool header count and "Show more" pagination shall derive only from a total belonging to the currently active filter key; during a filter transition a loading indicator replaces the count. (F5) | After changing a filter and before the new response resolves, the previous total is not displayed | Must |
| REQ-006 | State-driven | While the visible item list is empty with a non-zero unconstrained pool and no constraint active, the empty-state message shall read "All collected items are already ranked."; while a constraint is active it shall read "No items match the current filters." (F6) | Each state renders its exact message | Must |
| REQ-007 | Event-driven | When any digest-meta field (headline, summary, hook, LinkedIn post, Twitter summary) differs from its last hydrated/saved value, the page shall count it as an unsaved change in the SaveBar and activate the navigation blocker and beforeunload guard. (F7) | Editing only a digest field → unsaved count ≥ 1 and in-app navigation prompts for confirmation | Must |
| REQ-008 | Event-driven | When Discard is confirmed, the digest-meta fields shall revert to their last hydrated/saved values. (F7) | After editing digest fields and confirming Discard, inputs equal the hydrated values | Must |
| REQ-009 | State-driven | While the archive is a dry-run, the regenerate-before-save gate shall not block Save after ranked-list changes. (F8) | On a dry-run, reorder/remove → Save remains enabled (other `canSave` conditions held) | Must |
| REQ-010 | State-driven | While the archive is a dry-run, the Regenerate control shall be disabled with a reason stating regeneration is unavailable for dry-runs. (F8) | Regenerate button disabled with explanatory title/text on dry-run | Should |
| REQ-011 | Unwanted | If a Regenerate attempt fails after the ranked list changed, then Save shall become enabled and the SaveBar shall show a warning that the digest copy may not match the story order. (F9) | Failed regenerate → Save enabled + warning text visible; warning absent before failure | Must |
| REQ-012 | Unwanted | If the archive load fails with a non-404 error, then the page shall render "Failed to load this run." with a Retry control, distinct from the 404 "This run was not found." view. (F10) | Thrown fetch error → failure view + Retry triggering refetch; 404 → not-found view without Retry | Must |
| REQ-013 | Event-driven | When a ranked item that was promoted during the current session is removed from the ranked list, the item shall reappear in the pool list without a page reload. (F11) | Promote → remove → item visible in pool again | Must |
| REQ-014 | Event-driven | When the user clicks outside the open Source dropdown or presses Escape, the dropdown shall close. (F12) | Outside click and Escape each close the menu | Should |
| REQ-015 | State-driven | While `shortlistedItemIds` is null or an empty array, the "Shortlisted only" toggle shall be disabled with the "No shortlist data for this run" tooltip. (F13) | `[]` → checkbox disabled with tooltip (today only `null` disables it) | Should |
| REQ-016 | State-driven | While the loaded run status is non-terminal, the archive query shall refetch on a 5-second interval so the page transitions to the review view when the run completes. (F14) | In-progress view → archive request repeats at ~5 s; completed response swaps in the review view without manual reload | Should |
| REQ-017 | Event-driven | When "Clear filters" is activated, the pool search input and search query shall clear together with the filter selections. (F15) | Active search + filters → Clear filters → search input empty and unfiltered pool request issued | Must |

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|-------------|
| EDGE-001 | Pool query errors while the (stale or fresh) total is 0 | Error display wins over both empty states; toolbar still rendered | REQ-003 |
| EDGE-002 | User changes or clears a filter while the pool error is displayed | New query key fetch starts; error clears without clicking Retry | REQ-003 |
| EDGE-003 | Legacy run with null `startedAt`/`sourceTypes` | Unchanged "Pool unavailable for this run" branch; no toolbar, no error/empty taxonomy | REQ-002 |
| EDGE-004 | Dry-run archive with only digest-field edits | Save permitted and PATCH issued (API accepts dry-runs) | REQ-009, REQ-007 |
| EDGE-005 | Rapid successive filter toggles before responses resolve | Last filter key wins; no stale items or stale total rendered | REQ-005 |
| EDGE-006 | Regenerate fails → user reorders again → Regenerate succeeds | Warning clears and the gate re-engages for subsequent reorders | REQ-011 |
| EDGE-007 | A pool item whose promote failed (failure card shown) is retried | Existing retry path unchanged; pool-return-on-remove applies only to items present in the ranked list | REQ-013 |

## Verification Matrix

Each REQ/EDGE gets exactly ONE test at the LOWEST sufficient level. This matrix is the
test budget: the coder writes one test per row and writes no tests outside it unless an
extra row is added stating the unique bug that test would catch.

| REQ/EDGE ID | Test Level | Test Name | Rationale for Level | Notes |
|-------------|-----------|-----------|---------------------|-------|
| REQ-001 | unit | test_REQ_001_zero_match_filter_keeps_toolbar | component render logic (jsdom) | update existing `PoolSection.test.tsx` EDGE-002 pin deliberately |
| REQ-002 | unit | test_REQ_002_unconstrained_empty_pool_hides_section | component render logic | covers legacy-pin retention |
| REQ-003 | unit | test_REQ_003_pool_error_shows_retry_with_toolbar | mocked fetch rejection in jsdom | |
| REQ-004 | unit | test_REQ_004_facets_error_shows_retry_in_dropdown | mocked fetch rejection in jsdom | |
| REQ-005 | unit | test_REQ_005_no_stale_total_during_transition | hook + component state logic | usePool `{total,key}` behavior |
| REQ-006 | unit | test_REQ_006_empty_state_message_context_aware | pure render branching | |
| REQ-007 | unit | test_REQ_007_digest_edit_counts_unsaved_and_blocks | page-level state logic (jsdom) | extends `ReviewPage.test.tsx` |
| REQ-008 | unit | test_REQ_008_discard_reverts_digest_fields | page-level state logic | |
| REQ-009 | unit | test_REQ_009_dry_run_bypasses_regen_gate | page-level gate logic | |
| REQ-010 | unit | test_REQ_010_dry_run_disables_regenerate | component render logic | |
| REQ-011 | unit | test_REQ_011_regen_failure_unlocks_save_with_warning | page-level gate logic with mocked 502 | |
| REQ-012 | unit | test_REQ_012_load_error_distinct_from_not_found | mocked throw vs null in jsdom | |
| REQ-013 | unit | test_REQ_013_removed_promoted_item_returns_to_pool | page-level state logic | |
| REQ-014 | unit | test_REQ_014_dropdown_closes_outside_and_escape | DOM event handling in jsdom | |
| REQ-015 | unit | test_REQ_015_empty_shortlist_array_disables_toggle | component render logic | |
| REQ-016 | unit | test_REQ_016_non_terminal_status_polls_archive | hook config logic (jsdom + fake timers) | |
| REQ-017 | unit | test_REQ_017_clear_filters_clears_search | component + hook interplay | |
| EDGE-001 | unit | test_EDGE_001_error_wins_over_empty_states | render branching | |
| EDGE-002 | unit | test_EDGE_002_filter_change_clears_error | mocked sequential responses | |
| EDGE-003 | unit | test_EDGE_003_legacy_run_unavailable_branch_unchanged | render branching | likely already pinned; keep/extend |
| EDGE-004 | e2e | test_EDGE_004_dry_run_review_edit_saves | crosses web→API→DB (PATCH on dry-run) | extends `edit-after-review.spec.ts` surface; live services |
| EDGE-005 | unit | test_EDGE_005_rapid_filter_toggle_last_key_wins | hook state logic with deferred promises | |
| EDGE-006 | unit | test_EDGE_006_regen_fail_then_success_clears_warning | page-level gate sequence | |
| EDGE-007 | unit | test_EDGE_007_failed_promote_retry_path_unchanged | page-level state logic | regression pin |

## Verification Scenarios

### VS-1: Zero-match filter recovery (reported incident #1/#2)
1. Open `/admin/review/:runId` for a completed run with a non-empty pool.
2. Open the Source dropdown and select a source whose items are all ranked (0 pool matches) — or toggle "Shortlisted only" on a run where all shortlisted items are ranked.
3. **Expected:** brief loading indicator, then the Item Pool section remains visible with the filter toolbar, the active chip, and "No items match the current filters." — the section does NOT disappear.
4. Click "Clear filters".
5. **Expected:** the full pool list returns; search input is empty.

### VS-2: Pool/facets failure surfacing (reported incident #2)
1. Open the review page with the API forced to fail `/pool` requests (or network offline).
2. **Expected:** after retries settle, the pool area shows an error message and a Retry button — never a permanent "Loading..." or a silent wrong empty-state.
3. Restore the API and click Retry.
4. **Expected:** the pool list loads.

### VS-3: Dry-run review save (deadlock fix)
1. Open `/admin/review/:runId` for a reviewed dry-run archive.
2. Reorder two items.
3. **Expected:** Regenerate is disabled with a dry-run reason; Save stays enabled.
4. Click Save.
5. **Expected:** PATCH succeeds and the page navigates to the archive view.

## Out of Scope

- No API, shared-package, or pipeline changes; no DB migrations (the only candidate — PATCH dry-run acceptance — was verified already true).
- No consolidation of the filter/pool/review state architecture (rejected in design as YAGNI).
- No change to the happy-path regenerate gate (still required after ranked-list changes on non-dry runs while regeneration succeeds).
- No server-side `shortlistedOnly` semantics change (empty-ids filter drop stays; the client disables the toggle instead).
- No styling redesign of the review page; messages/controls use existing Tailwind patterns.
- No subscription/public-archive surfaces.
