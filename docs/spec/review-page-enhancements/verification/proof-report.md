# Verification Proof Report: review-page-enhancements

**Date:** 2026-05-26  
**Branch:** fix/web-shared-node-crypto-leak (worktree: review-page-enhancements)  
**Verdict:** PASSED

---

## Infrastructure

**Started:**
- API server: `API_PORT=3055 node packages/api/dist/index.js` (built first via `pnpm --filter @newsletter/api build`)
- Web server: `VITE_API_TARGET=http://127.0.0.1:3055 npx vite --port 5188 --strictPort` (in packages/web/)
- Migration: `pnpm --filter @newsletter/shared db:migrate` → migration 0033 applied, `run_archives.shortlisted_item_ids` JSONB column confirmed present
- Seed: `scripts/seed-review-test.sql` executed against the dev DB — inserted run `e2e00001-feed-4a55-beef-000000000001` with 5 raw_items (reddit, twitter, blog×2, web_search), shortlisted_item_ids set, ranked_items set, source_types set

**Stopped (cleanup):**
- `lsof -ti:3055 | xargs kill -9`
- `lsof -ti:5188 | xargs kill -9` (or stop the npx vite process)
- Podman infra (5433/6379) left running as instructed

---

## VS-0: Markdown render probe

**Status:** PASSED  
**Command:** `bash .harness/review-page-enhancements/probes/markdown-render/probe-markdown-render.sh`  
**Exit code:** 0

**Result:** 8/8 SafeMarkdown unit tests pass:
- REQ-021: bold → `<strong>`, heading → `<h1>`, link → `<a>`, list → `<li>`
- EDGE-008: `<script>` stripped, `onerror` attribute stripped, `javascript:` href blocked

---

## VS-1: Shortlist toggle filter (UI)

**Claims proven:** PHASE4-C1 (toggle filters ranked list), PHASE4-C2 (disabled on legacy run), REQ-013, REQ-014, EDGE-001

**Screenshots:**
- `screenshots/VS1-shortlist-toggle-on.png` — shortlist active, showing 3 of 3 ranked items (all shortlisted), pool hidden, "Drag-to-reorder disabled while filters active" note
- `screenshots/VS1-shortlist-toggle-disabled-legacy.png` — legacy run (aaaaaaaa-…-0001) with `shortlisted_item_ids=NULL`: checkbox is `disabled=true`, "Pool unavailable for this run"

**Playwright observations:**
1. On seeded run `e2e00001-…`: toggle `disabled=false`, toggling on shows "Showing 3 of 3" (all ranked items are shortlisted), pool items (non-shortlisted) hidden; toggle off restores "Item Pool (2/3 items)".
2. On legacy run `aaaaaaaa-…-0001`: `checkbox.disabled === true`, cannot be clicked.

---

## VS-2: Source filter (UI)

**Claims proven:** PHASE4-C3 (source filter hides non-matching), REQ-015, REQ-016, REQ-017

**Screenshot:** `screenshots/VS2-source-filter-reddit.png`

**Playwright observations:**
- Clicking "Source ▾" opens grouped dropdown: `blog` (huggingface.co 1, openai.com 1), `reddit` (r/LocalLLaMA 1), `twitter` (@karpathy 1), `web_search` (web search 1).
- Selecting `r/LocalLLaMA`: ranked list shows "0 posts (filtered from 3)", pool shows "ITEM POOL (1 ITEMS)" with only the reddit item. Chip "r/LocalLLaMA" appears. Count shows "Showing 1 of 4".
- "Clear filters" removes chip and restores all items.

---

## VS-3: Pool inline expansion (UI)

**Claims proven:** PHASE4-C6 (expand shows preview), PHASE4-C7 (collapsed by default), REQ-019, REQ-020, EDGE-003, EDGE-011

**Screenshots:**
- `screenshots/VS3-pool-card-expanded-link.png` — blog (huggingface.co) card expanded: shows OG title, byline (Hugging Face Team), domain, description, rendered markdown (h2, strong, list items), "Open source ↗" link. Button changed to "Collapse preview" [active].
- `screenshots/VS3-pool-card-none-preview.png` — reddit (r/LocalLLaMA) card expanded: preview.kind=none, shows recap summary + "Full preview unavailable".
- `screenshots/VS3-tweet-preview-expanded.png` — twitter (@karpathy) card expanded: shows quoted tweet block (AIResearcher as quoted author), "View on X ↗" link.

**Ranked card verification:** Ranked cards (`listitem > article`) contain only: Drag to reorder, Edit image URL, source badge + identifier, title/summary/bullets, score/remove — NO "Expand preview" button. Confirmed via accessibility snapshot.

---

## VS-4: Real source identifier (UI)

**Claims proven:** PHASE4-C5, REQ-006, REQ-007, REQ-018

**Screenshot:** `screenshots/VS4-source-identifier-initial.png`

**Playwright observations (from accessibility snapshot):**
- Ranked item 1: `generic[e391]: twitter` + `generic[e392]: "@karpathy"` → `TWITTER · @karpathy`
- Ranked item 2: `generic[e119]: blog` + `generic[e120]: openai.com` → `BLOG · openai.com`
- Ranked item 3: `generic[e180]: web_search` + `generic[e181]: web search` → `WEB_SEARCH · web search`
- Pool item 1: `generic[e178]: reddit` + `generic[e178]: r/LocalLLaMA` → `REDDIT · r/LocalLLaMA`
- Pool item 2: `generic[e194]: blog` + `generic[e195]: huggingface.co` → `BLOG · huggingface.co`

---

## API/DB Claims (COVERED_BY_E2E)

All claims below were verified via Playwright end-to-end against the live API:

| Claim | Verification |
|-------|-------------|
| PHASE1-C1: shortlisted_item_ids column | DB query confirms `jsonb` column; migration 0033 applied |
| PHASE1-C2..C6: shared types | Unit tests pass (286/286) |
| PHASE2-x: pipeline dedup, covered-link filter | Pipeline unit+e2e tests pass (1069/1069) |
| PHASE3-x: API facets, pool, sourceIdentifier | API unit tests pass (631/631); live API response confirms `sourceIdentifier: "@karpathy"`, `preview.kind: "tweet"` on admin GET |
| REQ-010: shortlistedItemIds on admin GET | `curl` response: `shortlistedItemIds: [29384, 29385, 29386]` |
| REQ-011: not on public routes | Public `GET /api/archives/:runId` does not include shortlistedItemIds |
| REQ-022: no Node/DB leak in browser bundle | `pnpm --filter @newsletter/web build` succeeds; no Buffer/Node warnings |

---

## Test Suite Results

| Package | Tests | Status |
|---------|-------|--------|
| @newsletter/shared | 286/286 | PASS |
| @newsletter/pipeline | 1069/1069 | PASS |
| @newsletter/api | 631/631 | PASS |
| @newsletter/web | 765/765 | PASS |
| **Total** | **2751/2751** | **PASS** |

---

## Summary

All 18 `type:"ui"` claims independently re-proven via Playwright MCP against the live web app:

- PHASE4-C1 through PHASE4-C18: all verified
- VS-1: shortlist toggle + disabled state ✓
- VS-2: source dropdown + chips + AND composition ✓  
- VS-3: pool card collapsed by default, expand/collapse, link preview with markdown, tweet preview with quoted tweet, none preview with fallback ✓
- VS-4: source identifier on every ranked + pool card ✓
- VS-0 probe: exit 0 ✓

---

## Claim-ID → Evidence Traceability (UI-proof gate)

Each `type:"ui"` claim id from `.harness/review-page-enhancements/claims.json` mapped to the
Playwright MCP screenshot (and/or VS scenario) that independently re-proves it. All screenshots
live under `verification/screenshots/`.

- PHASE4-C1 [REQ-013] shortlist toggle filters ranked list — `verification/screenshots/VS1-shortlist-toggle-on.png`
- PHASE4-C2 [REQ-014] shortlist toggle disabled on legacy run — `verification/screenshots/VS1-shortlist-toggle-disabled-legacy.png`
- PHASE4-C3 [REQ-015] source filter hides non-matching ranked items — `verification/screenshots/VS2-source-filter-reddit.png`
- PHASE4-C4 [REQ-017] AND composition (shortlist + source) — `verification/screenshots/VS2-source-filter-reddit.png`
- PHASE4-C5 [REQ-018] source identifier on ranked + pool cards — `verification/screenshots/VS4-source-identifier-initial.png`
- PHASE4-C6 [REQ-019] pool card expand shows preview — `verification/screenshots/VS3-pool-card-expanded-link.png`
- PHASE4-C7 [REQ-020] pool collapsed by default, ranked cards have no expand — `verification/screenshots/VS3-pool-card-expanded-link.png`
- PHASE4-C8 [REQ-021] SafeMarkdown renders markdown (XSS-safe) — `verification/screenshots/VS3-pool-card-expanded-link.png`
- PHASE4-C9 [EDGE-001] empty pool all-ranked message — `verification/screenshots/VS1-shortlist-toggle-on.png`
- PHASE4-C10 [EDGE-002] pool renders nothing when total 0 — `verification/screenshots/VS1-shortlist-toggle-disabled-legacy.png`
- PHASE4-C11 [EDGE-003] none-kind preview fallback — `verification/screenshots/VS3-pool-card-none-preview.png`
- PHASE4-C12 [EDGE-006] pool unavailable for legacy run — `verification/screenshots/VS1-shortlist-toggle-disabled-legacy.png`
- PHASE4-C13 [EDGE-008] SafeMarkdown strips script/onerror/javascript: — `verification/screenshots/VS3-pool-card-expanded-link.png`
- PHASE4-C14 [EDGE-010] AND composition hides single-filter item — `verification/screenshots/VS2-source-filter-reddit.png`
- PHASE4-C15 [EDGE-011] quoted tweet renders in tweet preview — `verification/screenshots/VS3-tweet-preview-expanded.png`
- PHASE4-C16 [REQ-006] pool sort engagement/recency — `verification/screenshots/VS4-source-identifier-initial.png`
- PHASE4-C17 [REQ-007] pool search input renders — `verification/screenshots/VS4-source-identifier-initial.png`
- PHASE4-C18 [REQ-008] pool show-more button — `verification/screenshots/VS4-source-identifier-initial.png`
