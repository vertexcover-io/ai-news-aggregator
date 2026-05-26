# SPEC: Review Page Enhancements

**Source:** docs/spec/review-page-enhancements/design.md
**Generated:** 2026-05-26

Five operator-facing improvements to the admin review page (`/admin/review/:runId`) and
two supporting pipeline/persistence changes:

1. Filter by shortlisted items (requires persisting the stage-1 shortlist set).
2. Filter by a specific derived source (subreddit, X handle, hostname, owner/repo).
3. Inline, collapsible content preview on **pool** items (collapsed by default).
4. Hide already-covered links — removed during the pipeline dedup stage.
5. Show the real derived source identifier on every card (not just "blog"/"web_search").

## Requirements

### Pipeline & persistence (FR1 / FR4)

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|----------------------|----------|
| REQ-001 | Event-driven | When a run completes successfully, the pipeline shall persist the set of stage-1 shortlisted raw-item ids onto the archive. | `run_archives.shortlisted_item_ids` JSONB equals `shortlist.map(c => c.id)` after a successful run; column exists via migration 0033. | Must |
| REQ-002 | Ubiquitous | The pipeline shall expose a repository method returning the set of canonical URLs published in prior newsletters. | `getPublishedCanonicalUrls()` returns a `Set<string>` of `canonicalizeUrl(url)` drawn only from archives where `reviewed=true AND is_dry_run=false AND status='completed'`. | Must |
| REQ-003 | Event-driven | When the dedup stage runs, the pipeline shall drop every candidate whose canonical URL is in the published set before `dedupCandidates` selects survivors. | A candidate URL present in a prior published archive is absent from the deduped pool; the dropped count is recorded on the funnel. | Must |
| REQ-004 | Unwanted | If the published-URL query fails, then the pipeline shall proceed with an empty published set and log the error without failing the run. | Simulated query error → run completes; `funnel` covered-removed = 0; an error is logged. | Must |
| REQ-005 | State-driven | While a run is a dry run, the pipeline shall not treat its links as published. | A dry-run archive's links never appear in `getPublishedCanonicalUrls()`. | Must |

### API read surface (FR2 / FR3 / FR5)

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|----------------------|----------|
| REQ-006 | Ubiquitous | The admin archive detail response shall include, per ranked item, the derived `sourceIdentifier`. | Each `RankedItem.sourceIdentifier` equals `deriveRawItemIdentifier({sourceType,url,sourceUrl})`. | Must |
| REQ-007 | Ubiquitous | The pool response shall include, per pool item, the derived `sourceIdentifier`. | Each pool item's `sourceIdentifier` equals `deriveRawItemIdentifier(...)`. | Must |
| REQ-008 | Ubiquitous | The pool response shall include, per pool item, a `preview` payload built from stored data. | Pool item `preview.kind ∈ {"tweet","link","none"}`; tweet carries text/handle/photos/quoted; link carries title/byline/description/imageUrl/domain/markdownExcerpt/url. | Must |
| REQ-009 | Ubiquitous | The pool `preview.link.markdownExcerpt` shall be bounded in size. | Excerpt length ≤ 4096 chars regardless of stored markdown size. | Must |
| REQ-010 | Event-driven | When the admin archive detail is requested, the response shall include the run's `shortlistedItemIds`. | `shortlistedItemIds: number[] | null` present on the admin GET response; `null` for legacy runs. | Must |
| REQ-011 | Unwanted | If a route is public (non-admin), then `shortlistedItemIds` shall not be serialised. | Public archive routes never include `shortlistedItemIds`. | Must |
| REQ-012 | Unwanted | If an item's `enrichedLink.status` is not `"ok"`, then `preview.kind` shall be `"none"` (or tweet, if Twitter). | Skipped/failed enrichment → `preview.kind = "none"` for non-tweet items; never throws. | Should |

### Web UI (FR1 / FR2 / FR3 / FR5)

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|----------------------|----------|
| REQ-013 | Event-driven | When the operator enables "Shortlisted only", the review list and pool shall show only items whose id is in `shortlistedItemIds`. | Toggling on hides non-shortlisted items in both lists; toggling off restores them. | Must |
| REQ-014 | State-driven | While the run has no `shortlistedItemIds` (legacy), the "Shortlisted only" toggle shall be disabled. | Toggle is `disabled` with a tooltip; no error. | Must |
| REQ-015 | Event-driven | When the operator selects one or more sources in the Source dropdown, the review list and pool shall show only items whose `sourceIdentifier` matches a selected source. | Selecting `r/LocalLLaMA` hides all non-`r/LocalLLaMA` items; multiple selections OR together. | Must |
| REQ-016 | Ubiquitous | The Source dropdown shall list every distinct `(sourceType, sourceIdentifier)` present in the run, grouped by type, with a per-source count. | Each facet shows its exact count; facets keyed by `(sourceType, identifier)` (no cross-type merge). | Must |
| REQ-017 | Ubiquitous | The shortlist and source filters shall compose with logical AND. | An item shows only if it satisfies both the shortlist toggle and the source selection. | Must |
| REQ-018 | Ubiquitous | Each ranked card and pool card shall display its `sourceIdentifier` alongside the source-type badge. | `BLOG · openai.com`, `TWITTER · @karpathy`, etc., rendered on every card. | Must |
| REQ-019 | Event-driven | When the operator clicks a pool card's expand control, the card shall reveal an in-page preview built from `preview`. | Clicking expand shows the tweet/link preview; clicking again collapses it. | Must |
| REQ-020 | State-driven | While a pool card has not been expanded, its preview shall remain collapsed. | Pool cards render collapsed by default; ranked cards have no expand control. | Must |
| REQ-021 | Ubiquitous | The pool-item link preview shall render `markdownExcerpt` through a sanitized markdown renderer. | Markdown is rendered via react-markdown over a dompurify-sanitized string; no raw-HTML passthrough; no `<script>`/`onerror` survives. | Must |
| REQ-022 | Unwanted | If the web build pulls Node/DB modules into the browser bundle, the build shall be considered failed. | `pnpm --filter @newsletter/web build` succeeds; only `@newsletter/shared` subpath imports used in new code. | Must |

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|--------------|
| EDGE-001 | Legacy run with `shortlisted_item_ids = NULL` | Toggle disabled; all items render. | REQ-014 |
| EDGE-002 | Blog hostname equals a Twitter handle string | Facets keyed by `(sourceType, identifier)` so they never merge. | REQ-016 |
| EDGE-003 | Pool item with `enrichedLink.status="failed"` and not Twitter | `preview.kind="none"`; expand shows recap summary + "preview unavailable"; never blank. | REQ-012, REQ-019 |
| EDGE-004 | A covered link is also the highest-engagement duplicate | Covered link removed before `dedupCandidates`; dedup survivor selection runs only on non-covered items. | REQ-003 |
| EDGE-005 | First-ever run, no published history | `getPublishedCanonicalUrls()` returns empty set; nothing dropped. | REQ-002, REQ-003 |
| EDGE-006 | Previously-covered link re-added via add-post | Add-post is not blocked (covered-filter only applies to the auto-collected pool during dedup). | REQ-003 |
| EDGE-007 | `markdownExcerpt` from 100KB stored markdown | Excerpt truncated to ≤4096 chars; "open source ↗" links to full article. | REQ-009 |
| EDGE-008 | Hostile HTML inside enriched markdown | Sanitized away (dompurify) and escaped (react-markdown default); no script executes. | REQ-021 |
| EDGE-009 | Published-URL query throws | Empty set fallback; run completes; error logged. | REQ-004 |
| EDGE-010 | Shortlist filter on + a source selected, item satisfies only one | Item hidden (AND semantics). | REQ-017 |
| EDGE-011 | Tweet item in pool (preview.kind="tweet") with quoted tweet | Preview shows main text + photos + quoted-tweet block + "view on X". | REQ-008, REQ-019 |
| EDGE-012 | Source dropdown when run has 30+ distinct sources | Dropdown scrolls; filter-search box narrows the facet list. | REQ-016 |

## Verification Matrix

| ID | Unit | Integration | E2E | Manual | Notes |
|----|------|-------------|-----|--------|-------|
| REQ-001 | Yes | Yes (pipeline e2e) | No | No | finalize upsert writes shortlist ids |
| REQ-002 | Yes | Yes | No | No | repo query + canonicalization |
| REQ-003 | Yes | Yes (pipeline e2e) | No | No | dedup-stage filter ordering |
| REQ-004 | Yes | No | No | No | error-injection unit test |
| REQ-005 | Yes | Yes | No | No | dry-run exclusion |
| REQ-006 | Yes | Yes (api) | No | No | hydration sourceIdentifier |
| REQ-007 | Yes | Yes (api) | No | No | pool sourceIdentifier |
| REQ-008 | Yes | Yes (api) | No | No | preview payload shape |
| REQ-009 | Yes | No | No | No | excerpt bound |
| REQ-010 | Yes | Yes (api) | No | No | admin GET exposes ids |
| REQ-011 | Yes | Yes (api) | No | No | public route omits ids |
| REQ-012 | Yes | No | No | No | non-ok enrichment |
| REQ-013 | Yes | No | Yes | No | UI shortlist filter (Playwright) |
| REQ-014 | Yes | No | Yes | No | disabled toggle (Playwright) |
| REQ-015 | Yes | No | Yes | No | UI source filter (Playwright) |
| REQ-016 | Yes | No | Yes | No | facet list + counts (Playwright) |
| REQ-017 | Yes | No | Yes | No | AND composition |
| REQ-018 | Yes | No | Yes | No | identifier on cards (Playwright) |
| REQ-019 | Yes | No | Yes | No | pool expand (Playwright) |
| REQ-020 | Yes | No | Yes | No | collapsed default (Playwright) |
| REQ-021 | Yes | No | No | No | SafeMarkdown sanitize unit |
| REQ-022 | No | No | No | Yes | web build size check in verify |
| EDGE-001 | Yes | No | Yes | No | |
| EDGE-002 | Yes | No | No | No | |
| EDGE-003 | Yes | No | Yes | No | |
| EDGE-004 | Yes | Yes | No | No | |
| EDGE-005 | Yes | No | No | No | |
| EDGE-006 | Yes | No | No | No | |
| EDGE-007 | Yes | No | No | No | |
| EDGE-008 | Yes | No | No | No | |
| EDGE-009 | Yes | No | No | No | |
| EDGE-010 | Yes | No | Yes | No | |
| EDGE-011 | Yes | No | Yes | No | |
| EDGE-012 | Yes | No | No | No | |

## Verification Scenarios

### VS-0-markdown-render: Library probe — react-markdown + dompurify render/sanitize
**Type:** api
**Run:** bash .harness/review-page-enhancements/probes/markdown-render/probe-markdown-render.sh
**Expected:** exit 0; dompurify strips script/onerror/javascript:; react-markdown renders
heading/bold/link/list; raw HTML in markdown is escaped (not injected).

### VS-1: Shortlist filter (UI)
**Type:** ui
**Journey:** Open `/admin/review/:runId` for a run with shortlist data → toggle "Shortlisted only" → only shortlisted items remain in ranked list + pool → toggle off → all return.
**Infra:** API + web dev servers, seeded run with `shortlisted_item_ids`.

### VS-2: Source filter (UI)
**Type:** ui
**Journey:** Open review page → open "Source ▾" → select `r/LocalLLaMA` → only that subreddit's items remain → chip appears → remove chip → all return.

### VS-3: Pool inline expansion (UI)
**Type:** ui
**Journey:** Scroll to Pool → a pool card is collapsed by default → click expand → tweet/link preview renders in place → click collapse → preview hides. Ranked cards have no expand control.

### VS-4: Real source identifier (UI)
**Type:** ui
**Journey:** Open review page → a blog item shows `BLOG · <domain>`; a web_search item shows its domain; a Twitter item shows `@handle`.

### VS-5: Covered-link hidden (pipeline)
**Type:** api
**Journey:** Run with a candidate URL that exists in a prior published archive → that URL is absent from the resulting pool/ranked items; funnel records the drop.

## Out of Scope

- Backfilling `shortlisted_item_ids` for historical runs (forward-only).
- A UI toggle to *reveal* covered links — they are hard-hidden at dedup time.
- Inline expansion on **ranked** cards (they already show full recap content).
- Official third-party embed widgets (Twitter widgets.js) or iframing source pages.
- Rendering item comments (`metadata.comments`) in the preview.
- Server-side filtering of the ranked list (filters are client-side over loaded items).
- Changing the live collect → shortlist → rank output beyond persisting shortlist ids
  and dropping covered links at dedup.
- Editing/curation behavior changes (reorder, remove, add-post, inline-edit) — unchanged.
