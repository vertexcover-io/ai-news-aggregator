# SPEC: Per-Item Source Telemetry

**Source:** [`design.md`](./design.md)
**Visual reference:** [`mock.html`](./mock.html) (rendered `verification/screenshots/mock-render-v2.png`) — authoritative for the expanded-source UI.
**Generated:** 2026-05-27

## Requirements

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|----------------------|----------|
| REQ-001 | Event-driven | When the operator clicks a Source Telemetry row, the system shall expand that row inline (accordion) to reveal the source's per-item panel. | Clicking a collapsed row sets it expanded and renders the `SourceItemsPanel`; clicking again collapses it. Disclosure indicator reflects state. | Must |
| REQ-002 | Ubiquitous | A collapsed Source Telemetry row shall render the same columns as today (source name/type, status badge, items, retries, duration). | Collapsed-row DOM/visuals are unchanged vs the current `SourceTelemetryTable` (snapshot/visual parity). | Must |
| REQ-003 | Event-driven | When a source row is expanded, the system shall fetch that source's items lazily from `GET /api/admin/runs/:runId/sources/:sourceKey/items`. | The request fires only on first expand (not on page load), is admin-gated, and its result is cached per `(runId, sourceKey)`. | Must |
| REQ-004 | Ubiquitous | The expanded panel shall display an outcome-summary strip with counts for `ranked`, `shortlisted`, `deduped-survivors`, `dedup-dropped`, and `enrich-failed`. | Each pill shows the correct integer count for that source; pills with a zero count for ranked/shortlisted are omitted per the mock. | Must |
| REQ-005 | Ubiquitous | The expanded panel shall display the source's items as a flat list, each row showing title (linking to the original URL), an author/engagement/relative-time meta line, and a lifecycle trail of stage badges. | For each item, the title `href` equals the item's `url`; meta line and trail render from the item's data. No detail panel / link-preview / recap is rendered. | Must |
| REQ-006 | Ubiquitous | The system shall order the item list by furthest lifecycle stage: ranked (by rank ascending) first, then shortlisted, then deduped-survivors, then dropped/failed. | Given a mixed set, the rendered order matches the outcome ordering; ranked items appear in rank order. | Must |
| REQ-007 | Event-driven | When an item was dropped or failed at a stage, the system shall render a single inline one-line reason on that item's row. | Dropped/failed items show exactly one reason line (e.g. `dedup-dropped · duplicate URL, lost to "<winner>" (X vs Y pts)`); ranked/survived items show no reason line. | Must |
| REQ-008 | Ubiquitous | For each item the system shall compute a lifecycle classification covering fetched, enrichment (ok/skipped/failed + reason), dedup (survived/dropped + winner), shortlist (yes/no), and rank (rank# or no). | `classifyItemLifecycle` returns a `lifecycle` object whose per-stage fields match the item's persisted data; unit-tested over the edge-case matrix. | Must |
| REQ-009 | Ubiquitous | The system shall derive dedup survivors and dropped items by recomputing `dedupCandidates` over the run's item pool at read-time (no new pipeline drop-recording). | The read-time dedup uses the same `dedupCandidates` primitive; for each dropped item the canonical-URL winner is identified. No live pipeline code path changes. | Must |
| REQ-010 | Ubiquitous | The expanded panel shall display a per-source log strip containing that source's `run_logs` lines with timestamp, level (info/warn/error), event, and context. | Log lines shown are exactly those `run_logs` rows scoped to the source for the run, ordered by `id` ascending; levels are color-coded. | Must |
| REQ-011 | Event-driven | When a source failed and collected zero items, the system shall render only the per-source log strip (including the failure line) and no item list. | A failed/empty source's panel contains the log strip with the `source.failed` line and renders no item rows; no empty item-list crash. | Must |
| REQ-012 | Ubiquitous | The item list and the per-source log strip shall each be independently scrollable with a hidden scrollbar. | Both regions use the `scrollbar-none` utility; overflow scrolls; no visible scrollbar in the rendered page. | Must |
| REQ-013 | State-driven | While a run is live (non-terminal), the system shall render lifecycle stages not yet reached as `Pending`. | For a live run, shortlist/rank badges render as `Pending` (not "Not shortlisted"); fetched/enrich/dedup render from available data. | Should |
| REQ-014 | Ubiquitous | The per-item API payload shall be lean — excluding markdown bodies, recap content, and cost data. | The `RunSourceItem` shape contains no `markdown`, no `recap`, no cost fields; cost is never serialized on this route. | Must |
| REQ-015 | Ubiquitous | Web-package imports of the new shared types shall use a `@newsletter/shared` subpath, never the root barrel. | All new imports in `packages/web/` use `@newsletter/shared/types` (or another subpath); `pnpm --filter @newsletter/web build` succeeds without leaking Node built-ins. | Must |
| REQ-016 | Ubiquitous | The read-time dedup primitive shall be exposed to `@newsletter/api` via a `@newsletter/pipeline` subpath export. | `@newsletter/api` imports the dedup recompute helper through a registered pipeline subpath (e.g. `@newsletter/pipeline/eval` or a new subpath); the import resolves at build and typecheck. | Must |

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|--------------|
| EDGE-001 | Legacy run with `shortlisted_item_ids = null` | Lifecycle renders through dedup; shortlist/rank steps shown as unknown (shortlist badge omitted), NOT falsely "Not shortlisted". | REQ-008, REQ-013 |
| EDGE-002 | Legacy run with no `run_id`-stamped items | Item pool loads via the `collectedAt` time-window fallback (same as `loadDedupedPool`); list still populates. | REQ-009 |
| EDGE-003 | Item present in `rankedItems` but absent from the read-time deduped pool (tie / re-collection) | Item still renders from the stored `RankedItemRef` fields; list/order not broken. | REQ-006, REQ-008 |
| EDGE-004 | Item enrichment `skipped` (self-post / same-platform / non-html / cache-hit) | Trail shows `Enrich-skipped`; inline reason is the `skipReason`; treated as not-a-failure (not in `enrich-failed` count). | REQ-007, REQ-008 |
| EDGE-005 | Source has items but none ranked or shortlisted | Pills omit ranked/shortlisted; survivors/dropped/enrich-failed render; full item list still shown. | REQ-004, REQ-006 |
| EDGE-006 | `sourceKey` identifier with special chars (`r/AI_Agents`, `@karpathy`, web-search query string) | Route param encodes/decodes round-trip; correct source's items are returned. | REQ-003 |
| EDGE-007 | Run with zero items across all sources | Expanded panel shows log strip or empty-state note; no crash, no NaN counts. | REQ-011 |
| EDGE-008 | `run_logs.source` value does not map 1:1 to source-row identity | Logs fall back to source-type-scoped filtering; strip still renders (no empty crash). | REQ-010 |
| EDGE-009 | Two distinct raw inputs sharing one canonical URL (dedup winner attribution) | The higher-engagement item is `survived`; the other is `dedup-dropped` with the winner named; counts correct. | REQ-009 |
| EDGE-010 | Item dropped by the pre-dedup covered-link filter (already published prior run) | Represented as a dedup-class drop; if winner not cheaply derivable, reason notes the covered-link filter or falls through to survivor without crashing. | REQ-007, REQ-009 |

## Verification Matrix

| REQ ID | Unit Test | Integration Test | E2E Test | Manual Test | Notes |
|--------|-----------|------------------|----------|-------------|-------|
| REQ-001 | No | No | Yes | No | Playwright: click row → panel appears; click again → collapses. UI claim. |
| REQ-002 | Yes | No | Yes | No | Snapshot/visual parity of collapsed row. |
| REQ-003 | No | Yes | Yes | No | API integration: lazy fetch; admin-gated (401 without cookie). |
| REQ-004 | Yes | Yes | Yes | No | Count computation unit-tested; pills rendered (UI). |
| REQ-005 | Yes | No | Yes | No | Title href = url; trail render. UI claim. |
| REQ-006 | Yes | No | Yes | No | Ordering function unit-tested; rendered order (UI). |
| REQ-007 | Yes | No | Yes | No | Reason-line presence on dropped only. UI claim. |
| REQ-008 | Yes | Yes | No | No | `classifyItemLifecycle` exhaustive matrix; API composition integration. |
| REQ-009 | Yes | Yes | No | No | Read-time dedup parity with pipeline; winner attribution. |
| REQ-010 | Yes | Yes | Yes | No | Log filtering by source; strip rendered (UI). |
| REQ-011 | Yes | Yes | Yes | No | Failed-source: log strip only, no item list. UI claim. |
| REQ-012 | No | No | Yes | Yes | `scrollbar-none` applied; hidden scrollbar verified visually (UI). |
| REQ-013 | Yes | No | Yes | No | Live run → Pending badges. UI claim (live state). |
| REQ-014 | Yes | Yes | No | No | Payload shape excludes markdown/recap/cost. |
| REQ-015 | No | No | No | Yes | `pnpm --filter @newsletter/web build` succeeds; subpath imports only. |
| REQ-016 | No | Yes | No | No | API imports dedup helper via pipeline subpath; typecheck + build pass. |
| EDGE-001 | Yes | No | No | No | |
| EDGE-002 | Yes | Yes | No | No | |
| EDGE-003 | Yes | No | No | No | |
| EDGE-004 | Yes | No | Yes | No | UI shows Enrich-skipped + reason. |
| EDGE-005 | Yes | No | Yes | No | |
| EDGE-006 | Yes | Yes | No | No | sourceKey encode/decode round-trip. |
| EDGE-007 | Yes | No | Yes | No | Empty-state, no NaN. |
| EDGE-008 | Yes | Yes | No | No | Log mapping fallback. |
| EDGE-009 | Yes | No | No | No | Dedup winner attribution; multi-input matrix. |
| EDGE-010 | Yes | No | No | No | Covered-link drop classification. |

## Verification Scenarios

VS-0 (probe scenarios): **None** — pure-internal feature, library-probe `NOT_APPLICABLE`.

Functional verification (Playwright MCP, against a seeded run on the live admin app):
1. Navigate to `/admin/runs/:runId` for a completed run with a mix of outcomes; confirm collapsed rows match current page (REQ-002).
2. Click a healthy source row → panel expands with outcome pills + flat item list + per-source log strip (REQ-001, REQ-004, REQ-005, REQ-010); capture screenshot.
3. Confirm a ranked item shows `Ranked #N`, a dedup-dropped item shows the drop reason naming the winner, an enrich-failed item shows its reason (REQ-006, REQ-007, EDGE-004, EDGE-009); capture screenshot.
4. Click a failed source (zero items) → only the log strip with `source.failed` renders, no item list (REQ-011); capture screenshot.
5. Confirm the item list and log strip scroll with hidden scrollbars (REQ-012); capture screenshot.
6. Confirm the per-item route returns 401 without the admin cookie and 200 with it (REQ-003).

## Out of Scope

- **No new pipeline drop-recording / schema column for dedup** — dedup drops are recomputed at read-time; the live collect→dedup→shortlist→rank output is unchanged.
- **No per-item detail panel, link preview, or recap display** in the expanded list (explicitly removed per user direction; the title links to the original instead).
- **No drawer or dedicated sub-page** for items — inline accordion only.
- **No live polling of per-item state** beyond what already exists; live runs show `Pending` for unreached stages, not real-time per-item updates.
- **No changes to the public archive routes** — this is admin-only observability.
- **No rank-rationale / recap / cost surfaced** in this view (cost remains admin-only and is not on this route).
- **No editing** — read-only observability; no reorder/remove (that's the Review page).
- **Distinguishing covered-link-filter drops from ordinary URL-dedup drops** is best-effort only (EDGE-010); a precise label may be deferred.
