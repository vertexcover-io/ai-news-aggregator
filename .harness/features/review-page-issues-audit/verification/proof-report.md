# Proof Report — review-page-issues-audit

**Date:** 2026-06-06  
**Spec:** `.harness/features/review-page-issues-audit/spec.md`  
**Verdict:** <!-- VERDICT:PASS -->

---

## 1. Infrastructure

- API dev server: `:3000` — running (verified with `curl http://localhost:3000/health` → `{"status":"ok"}`)
- Web dev server: `:5173` — running (verified with `curl`, HTTP 200)
- PostgreSQL: `:5434` — running; six dedicated proof archives seeded via `psql` (`.harness/runtime/review-page-issues-audit/seed-proof.sql`), each with a DISTINCT source_type so their time-window pools never overlap
- Playwright MCP browser session: opened, drove every UI scenario, real `page.route()` / `page.addInitScript()` fetch interception used to stage error/loading states

### Seeded proof runs (all ids match `%-0000-4000-8000-%`, external_id prefix `proof20260606`)

| Run id | Purpose | Key attributes |
|--------|---------|----------------|
| `aaaa0001-0000-4000-8000-000000000001` | Rich reviewed run (filter / facets / dropdown / digest / promote / save) | reviewed, non-dry-run, started_at + source_types `[hn,reddit]`, 4 pool items, shortlist `[pool-1]` |
| `bbbb0002-0000-4000-8000-000000000002` | Unconstrained 0-total pool | reviewed, started_at + source_types `[github]`, every collected item ranked → pool empty |
| `cccc0003-0000-4000-8000-000000000003` | Legacy run | started_at NULL, source_types NULL |
| `dddd0004-0000-4000-8000-000000000004` | Dry-run | reviewed, is_dry_run, source_types `[blog]`, 1 pool item |
| `eeee0005-0000-4000-8000-000000000005` | Empty shortlist array | reviewed, shortlisted_item_ids `[]`, source_types `[newsletter]` |
| `ffff0006-0000-4000-8000-000000000006` | In-progress | status `running`, source_types `[twitter]` |

---

## 2. UI Claims — every `type:"ui"` claim proven in a live browser

Each row cites the canonical screenshot path plus the verbatim `browser_evaluate` / `browser_run_code_unsafe` assertion output captured during the run.

| Claim ID | Behavior | Browser evidence (assertion output) | Screenshot | Verdict |
|----------|----------|-------------------------------------|------------|---------|
| PHASE1-C1 | Filter active + 0-match pool → toolbar + "No items match…" remains | Run A, search="zzz-no-match-zzz": `{poolHeading:"ITEM POOL (0 ITEMS)", shortlistCheckboxVisible:true, sourceDropdownVisible:true, searchBoxVisible:true, noMatchMsgVisible:true}` | `verification/screenshots/VS1-PHASE1-C1-filtered-zero-match.png` | **PASS** |
| PHASE1-C2 | Unconstrained 0-total pool → section absent | Run B (all items ranked, started_at + source_types set): `{hasItemPool:false, hasPoolUnavailable:false, rankedHeadingPresent:true}` | `verification/screenshots/PHASE1-C2-unconstrained-zero-section-absent.png` | **PASS** |
| PHASE1-C3 | Pool error → "Failed to load pool items." + Retry alongside toolbar | Run A, pool endpoint forced 500 via `page.route`: `{hasFailedToLoadPool:true, hasRetryButton:true, toolbarCheckboxPresent:true, sourceDropdownPresent:true, alertPresent:true}` | `verification/screenshots/PHASE1-C3-C7-pool-error-retry.png` | **PASS** |
| PHASE1-C4 | Loading "…" replaces stale total during filter transition | Run A, pool fetch delayed 4 s via `page.addInitScript`: polled header → `{sawEllipsis:true, sample:"ITEM POOL (…)"}`; screenshot taken while in-flight (`headingAtScreenshot:"ITEM POOL (…)"`) | `verification/screenshots/PHASE1-C4-transient-loading-count.png` | **PASS** |
| PHASE1-C5 | Context-aware empty/filtered message | Run A, shortlisted-only active: `{poolHeading:"ITEM POOL (1 ITEMS)", filteredCount:"(1 ITEMS)"}`; combined with C1's "No items match the current filters." (constraint branch) | `verification/screenshots/PHASE1-C5-shortlist-filtered-context.png` | **PASS** |
| PHASE1-C6 | Clear filters clears search input + filter | Run A, shortlist filter + search="Pool" then Clear: `before {searchValue:"Pool", checkboxChecked:true}` → `after {searchValue:"", checkboxChecked:false, poolHeading:"ITEM POOL (4 ITEMS)", hasClearFilters:false}` | `verification/screenshots/PHASE1-C6-clear-filters-cleared.png` | **PASS** |
| PHASE1-C7 | Error branch renders even when total=0 and no filter | Run A, pool forced 500 on initial load (no filter applied): error card + Retry render with the toolbar still mounted — `{hasFailedToLoadPool:true, hasRetryButton:true, itemPoolHeading:true}` (error wins over empty) | `verification/screenshots/PHASE1-C3-C7-pool-error-retry.png` | **PASS** |
| PHASE1-C8 | Filter change resolves pool error (error clears) | Run A, after the 500 error: `unroute` + toggle shortlisted-only → `{errorGone:true, poolHeading:"ITEM POOL (1 ITEMS)", visibleItems:["Pool HN Story One"], alertPresent:false}` | `verification/screenshots/PHASE1-C8-filter-change-clears-error.png` | **PASS** |
| PHASE1-C9 | Legacy run (null startedAt) → "Pool unavailable" without toolbar | Run C (started_at NULL): `{hasPoolUnavailable:true, hasItemPoolHeading:false, hasToolbar:false, poolUnavailableText:"Pool unavailable for this run"}` | `verification/screenshots/PHASE1-C9-legacy-pool-unavailable.png` | **PASS** |
| PHASE1-C13 | End-to-end: save → archive navigation | Run A, clicked "Save & view archive": `{url:"…/archive/aaaa0001-…", onArchivePage:true, hasRankedStory:true}`; page title "Ranked Story Alpha" | `verification/screenshots/PHASE1-C13-save-to-archive-navigation.png` | **PASS** |
| PHASE2-C1 | Source-facets error → "Failed to load sources." + Retry in dropdown | Run A, source-facets forced 500 via `page.route`, dropdown opened: `{dropdownOpen:true, hasFailedToLoadSources:true, retryInDropdownVisible:true, alertVisible:true}` | `verification/screenshots/PHASE2-C1-facets-error-retry-dropdown.png` | **PASS** |
| PHASE2-C2 | Outside mousedown + Escape each close the Source dropdown | Run A, scoped to `input[placeholder="Filter sources..."]`: `{opened1:true, afterEscape:false, opened2:true, afterOutsideClick:false}` | `verification/screenshots/PHASE2-C2-source-dropdown-open.png` | **PASS** |
| PHASE2-C3 | shortlistedItemIds=[] → checkbox disabled + tooltip | Run E (shortlist `[]`): `browser_evaluate` → `{checkboxDisabled:true, wrapperTitle:"No shortlist data for this run", checkboxVisible:true}` | `verification/screenshots/PHASE2-C3-empty-shortlist-disabled.png` | **PASS** |
| PHASE3-C1 | Digest-meta field edit counts as unsaved change in SaveBar | Run D, edited Headline: `{initialCount:"0 unsaved changes", afterEditCount:"1 unsaved change", saveEnabled:true}` | `verification/screenshots/PHASE3-C1-digest-edit-unsaved-count.png` | **PASS** |
| PHASE3-C2 | Discard reverts digest-meta fields to hydrated values | Run D, after Headline edit → Discard → confirm: `{headlineValueAfterDiscard:"Proof Dry Headline D", afterCount:"0 unsaved changes"}` (reverted from "…— EDITED") | `verification/screenshots/PHASE3-C2-discard-reverts-digest.png` | **PASS** |
| PHASE3-C3 | Dry-run: Regenerate disabled with reason; Save enabled without regen gate | Run D (dry-run): `{regenDisabled:true, regenReasonPresent:true, saveEnabled:true}`; reason "Regeneration is unavailable for dry-run archives." | `verification/screenshots/VS3-PHASE3-C3-dry-run-regen-disabled.png` | **PASS** |
| PHASE3-C4 | Failed Regenerate unlocks Save + amber warning | Run A (non-dry-run), removed a ranked item → Save disabled (needsRegen), regenerate forced 500: `{saveEnabledAfterFailedRegen:true, hasAmberWarning:true, amberWarningText:"Digest copy may not match the story order — regeneration was skipped."}` | `verification/screenshots/PHASE3-C4-failed-regen-unlocks-save.png` | **PASS** |
| PHASE4-C1 | Non-404 → "Failed to load this run." + Retry; 404 → "not found" without Retry | 404: zero-UUID → `{hasNotFound:true, hasRetry:false}` (`PHASE4-C1-not-found-view.png`); non-404: Run A detail GET forced 500 → `{hasFailedToLoad:true, hasRetry:true, hasNotFound:false}` (`PHASE4-C1-load-error-retry.png`) | `verification/screenshots/PHASE4-C1-load-error-retry.png` | **PASS** |
| PHASE4-C2 | Removing promoted item returns it to pool | Run A: promote "Pool HN Story One" → pool 4→3; remove from ranked → `{poolHasOriginalBack:true, poolCount:4}` (item back in pool) | `verification/screenshots/PHASE4-C2-removed-promoted-returns-to-pool.png` | **PASS** |
| PHASE4-C3 | Non-terminal status → archive polls | Run F (status running), waited 12 s, `browser_network_requests` filtered to the run id → **7 repeated GET `/api/admin/archives/ffff0006-…`** (reqs 1119,1123,1124,1125,1126,1127,1128) | `verification/screenshots/PHASE4-C3-in-progress-polling.png` | **PASS** |
| PHASE4-C4 | Failed promote → failure card + Retry (regression pin) | Run A, promote endpoint forced 500: `{hasFailureIndicator:true, retryVisible:true, bodySnippet:["Recap generation failed","Retry"]}` | `verification/screenshots/PHASE4-C4-failed-promote-retry.png` | **PASS** |

### API/DB claims (covered by unit + exercised transitively in the browser flows above)

| Claim ID | Behavior | Proven By |
|----------|----------|-----------|
| PHASE1-C10 | total null before first confirmed response, null after filter change until new key resolves | `usePool.test.tsx::test_REQ_005_no_stale_total_during_transition`; observed live as "ITEM POOL (…)" in PHASE1-C4 |
| PHASE1-C11 | isError clears after filter change triggers successful re-fetch | `usePool.test.tsx::test_EDGE_002_filter_change_clears_error`; observed live in PHASE1-C8 |
| PHASE1-C12 | After rapid filter toggle, total reflects only final active key response | `usePool.test.tsx::test_EDGE_005_rapid_filter_toggle_last_key_wins` |

---

## 3. Spec Coverage Table

| REQ/EDGE ID | Verification | Verdict |
|-------------|--------------|---------|
| REQ-001 | PHASE1-C1 browser (zero-match keeps toolbar) | PASS |
| REQ-002 | PHASE1-C2 browser (Run B section absent) | PASS |
| REQ-003 | PHASE1-C3 browser (pool 500 → error + Retry + toolbar) | PASS |
| REQ-004 | PHASE2-C1 browser (facets 500 → error + Retry in dropdown) | PASS |
| REQ-005 | PHASE1-C4 browser ("…" during delayed fetch) | PASS |
| REQ-006 | PHASE1-C5 browser (context-aware message/count) | PASS |
| REQ-007 | PHASE3-C1 browser (digest edit → unsaved count; beforeunload observed) | PASS |
| REQ-008 | PHASE3-C2 browser (Discard reverts headline) | PASS |
| REQ-009 | PHASE3-C3 browser (dry-run Save enabled) | PASS |
| REQ-010 | PHASE3-C3 browser (dry-run Regenerate disabled + reason) | PASS |
| REQ-011 | PHASE3-C4 browser (failed regen unlocks Save + amber warning) | PASS |
| REQ-012 | PHASE4-C1 browser (404 no-Retry + non-404 Retry) | PASS |
| REQ-013 | PHASE4-C2 browser (removed promoted item returns to pool) | PASS |
| REQ-014 | PHASE2-C2 browser (Escape + outside click close dropdown) | PASS |
| REQ-015 | PHASE2-C3 browser (empty shortlist disables toggle + tooltip) | PASS |
| REQ-016 | PHASE4-C3 browser (running run polls, ≥7 fetches in 12 s) | PASS |
| REQ-017 | PHASE1-C6 browser (Clear filters clears search + filter) | PASS |
| EDGE-001 | PHASE1-C7 browser (error wins over empty, total=0 no filter) | PASS |
| EDGE-002 | PHASE1-C8 browser (filter change clears error) | PASS |
| EDGE-003 | PHASE1-C9 browser (legacy "Pool unavailable") | PASS |
| EDGE-004 | edit-after-review.spec.ts dry-run tests (6/6 green) + PHASE3-C3 browser | PASS |
| EDGE-005 | PHASE1-C12 unit (rapid toggle last-key-wins) | PASS (unit) |
| EDGE-006 | PHASE3-C4 browser (regen fail path) + `ReviewPage.test.tsx` (fail→success clears warning) | PASS |
| EDGE-007 | PHASE4-C4 browser (failed promote regression pin) | PASS |

---

## 4. Screenshots (all under 300 KB; canonical path `verification/screenshots/`)

| File | Covers |
|------|--------|
| `verification/screenshots/VS1-PHASE1-C1-C2-initial-state.png` | Initial review page — pool visible, toolbar, 2 ranked items |
| `verification/screenshots/VS1-PHASE1-C1-filtered-zero-match.png` | PHASE1-C1 — zero-match filter keeps toolbar + message |
| `verification/screenshots/PHASE1-C2-unconstrained-zero-section-absent.png` | PHASE1-C2 — unconstrained 0-pool → section absent |
| `verification/screenshots/PHASE1-C3-C7-pool-error-retry.png` | PHASE1-C3 / C7 — pool 500 → error card + Retry + toolbar |
| `verification/screenshots/PHASE1-C4-transient-loading-count.png` | PHASE1-C4 — header "ITEM POOL (…)" during in-flight fetch |
| `verification/screenshots/PHASE1-C5-shortlist-filtered-context.png` | PHASE1-C5 — shortlisted-only filtered view |
| `verification/screenshots/PHASE1-C6-clear-filters-cleared.png` | PHASE1-C6 — after Clear filters (search + filter cleared) |
| `verification/screenshots/PHASE1-C8-filter-change-clears-error.png` | PHASE1-C8 — filter change clears the pool error |
| `verification/screenshots/PHASE1-C9-legacy-pool-unavailable.png` | PHASE1-C9 — legacy run "Pool unavailable" |
| `verification/screenshots/PHASE1-C13-save-to-archive-navigation.png` | PHASE1-C13 — archive page after Save |
| `verification/screenshots/PHASE2-C1-facets-error-retry-dropdown.png` | PHASE2-C1 — facets 500 → "Failed to load sources." + Retry |
| `verification/screenshots/PHASE2-C2-source-dropdown-open.png` | PHASE2-C2 — Source dropdown open (closes on Escape/outside) |
| `verification/screenshots/PHASE2-C3-empty-shortlist-disabled.png` | PHASE2-C3 — disabled shortlist checkbox + tooltip |
| `verification/screenshots/PHASE3-C1-digest-edit-unsaved-count.png` | PHASE3-C1 — digest edit → "1 unsaved change" |
| `verification/screenshots/PHASE3-C2-discard-reverts-digest.png` | PHASE3-C2 — after Discard, headline reverted |
| `verification/screenshots/VS3-PHASE3-C3-dry-run-regen-disabled.png` | PHASE3-C3 — dry-run Regenerate disabled, Save enabled |
| `verification/screenshots/PHASE3-C4-failed-regen-unlocks-save.png` | PHASE3-C4 — failed regen unlocks Save + amber warning |
| `verification/screenshots/PHASE4-C1-not-found-view.png` | PHASE4-C1 — 404 "not found" (no Retry) |
| `verification/screenshots/PHASE4-C1-load-error-retry.png` | PHASE4-C1 — non-404 "Failed to load this run." + Retry |
| `verification/screenshots/PHASE4-C2-removed-promoted-returns-to-pool.png` | PHASE4-C2 — removed promoted item back in pool |
| `verification/screenshots/PHASE4-C3-in-progress-polling.png` | PHASE4-C3 — in-progress run view (polls while running) |
| `verification/screenshots/PHASE4-C4-failed-promote-retry.png` | PHASE4-C4 — failed promote → "Recap generation failed" + Retry |

---

## 5. Adversarial Pass

`verification/adversarial-findings.md` retained from the prior pass. 15 scenarios across boundary, sequence, broader-surface, status-accuracy, error-recovery, and permissions categories. **No DEFECT findings.** This re-verification surfaced no new defects; the staged error/loading/polling flows all behaved exactly as the spec requires.

---

## 6. Unit Test Run

```
pnpm --filter @newsletter/web test:unit
  Test Files: 119 passed
  Tests: 854 passed
```

Feature-specific files (ReviewPage, useReview, PoolSection, ReviewToolbar, usePool, DigestMetaPanel): all green.

---

## 7. Staging Techniques Used

- **Pool / facets / promote / regenerate / archive-detail 500s:** `page.route('**/…', route => route.fulfill({status:500}))`, scoped to the exact endpoint; `page.unroute()` to recover and prove the error clears.
- **Transient loading "…":** `page.addInitScript` installing a `window.fetch` wrapper that delays `/pool` responses 4 s, then polling the header for the ellipsis and screenshotting while in-flight.
- **Polling:** `browser_network_requests` filtered to the run id after a 12 s dwell on a `status:running` archive — counted ≥7 repeated detail GETs.
- **404 vs non-404:** distinct navigations (non-existent UUID vs. a real run whose bare detail GET was forced to 500).

---

## 8. Summary

All 21 `type:"ui"` claim IDs (PHASE1-C1..C9, PHASE1-C13, PHASE2-C1..C3, PHASE3-C1..C4, PHASE4-C1..C4) are **independently proven in a live Playwright MCP browser**, each with a `verification/screenshots/*.png` reference on its claim line and the verbatim assertion output. 0 claims downgraded to COVERED_BY_UNIT / COVERED_BY_E2E. 0 new defects.

**Verification verdict: PASS**
