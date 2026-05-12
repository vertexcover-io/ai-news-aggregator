# SPEC: Admin "Sources" Button — All Raw Items per Run

**Source:** docs/spec/admin-source-button/design.md
**Generated:** 2026-05-12
**Library probe:** NOT_APPLICABLE (no new external dependencies)

## Requirements

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-001 | Ubiquitous | The `/admin` runs table shall render a "Sources" column between the "Items" column and the "Action" column. | Column header text equals `Sources`; column index is exactly one less than the "Action" column header's index in the DOM. | Must |
| REQ-002 | Ubiquitous | Every row in the `/admin` runs table shall render a `Sources` button in the new column. | Each `<tr>` in the table body contains exactly one button whose text content is `Sources`. | Must |
| REQ-003 | State-driven | While a run's derived status is `failed` or `cancelled` AND its `itemCount === 0`, the `Sources` button for that row shall be disabled. | The button element has `disabled` attribute set; clicking it does not open the modal. | Must |
| REQ-004 | Event-driven | When the user clicks an enabled `Sources` button, the system shall open a modal scoped to that run's `runId`. | After click, a Radix Dialog with `data-state="open"` is present in the DOM and references the row's `runId` in its data-fetch. | Must |
| REQ-005 | Event-driven | When the Sources modal opens, the system shall issue exactly one `GET /api/admin/runs/:runId/sources` request. | Network panel shows exactly one matching request; query key in react-query devtools is `['run-sources', runId]`. | Must |
| REQ-006 | Ubiquitous | The endpoint `GET /api/admin/runs/:runId/sources` shall require an authenticated admin session. | Without an `admin_session` cookie, the endpoint responds `401`. With a valid session, it responds `200`. | Must |
| REQ-007 | Event-driven | When the endpoint receives a valid admin request with a known `runId`, it shall respond `200` with `{ runId: string, items: RawItemSummary[] }`. | Response body parses against the `RunSourcesResponse` zod schema; `items` is an array. | Must |
| REQ-008 | Ubiquitous | Each returned `RawItemSummary` shall contain the fields `id`, `sourceType`, `title`, `url`, `author`, `imageUrl`, `publishedAt`, `collectedAt`, `engagement`. | Every item passes the `RawItemSummary` zod schema; the `content` field is never present. | Must |
| REQ-009 | Ubiquitous | The endpoint shall sort returned items by `sourceType` ascending, then by `COALESCE(publishedAt, collectedAt)` descending. | For any response containing ≥2 source types, items group contiguously by `sourceType`; within each group, timestamps are non-increasing. | Must |
| REQ-010 | Event-driven | When the run has an entry in `run_archives`, the repository shall resolve `startedAt` and `sourceTypes` from that row. | `listRawItemsForRun(runId)` returns items whose `collectedAt >= archive.startedAt` and `sourceType IN archive.sourceTypes` when an archive row exists. | Must |
| REQ-011 | Event-driven | When the run has no `run_archives` row but has a `run:{runId}` key in Redis, the repository shall resolve `startedAt` and source types from the Redis run state. | Mocked test: archive lookup returns null, Redis returns a run state, query is executed with values from Redis state. | Must |
| REQ-012 | Unwanted | If neither a `run_archives` row nor a `run:{runId}` Redis key exists for the requested `runId`, then the endpoint shall respond `404` with `{ error: "Run not found" }`. | Request to an unknown `runId` returns status `404` and body matches. | Must |
| REQ-013 | Ubiquitous | The Sources modal body shall render items grouped by source, with one group header per distinct `sourceType` present in the response. | The number of `<h*>` elements with class/role `source-group-header` equals the count of distinct `sourceType` values in the response. | Must |
| REQ-014 | Ubiquitous | Each source group header shall display the source label and the count of items in that group. | Header text contains the source's human label (e.g., "HN", "Reddit") and the literal item count (e.g., `48 items`). | Must |
| REQ-015 | Ubiquitous | Each item row in the modal shall render the title as an anchor whose `href` equals the item's `url` and which opens in a new tab. | Anchor has `href === item.url`, `target="_blank"`, and `rel` includes `noopener`. | Must |
| REQ-016 | Ubiquitous | Each item row shall display author, engagement.points, engagement.commentCount, and a relative timestamp derived from `publishedAt` (falling back to `collectedAt` when `publishedAt` is null). | All four values are present in the row's DOM text for any item where the underlying fields are non-null. | Must |
| REQ-017 | State-driven | While the `useRunSources` query is in `pending` state, the modal shall render skeleton placeholder rows in the body. | Body contains ≥1 element with `data-testid="source-skeleton"` and no rendered item rows. | Must |
| REQ-018 | Unwanted | If the `useRunSources` query fails, then the modal shall render an inline error message with a Retry button that re-invokes the query. | On simulated 500, body contains the error message text and a button labeled `Retry`; clicking Retry triggers a second `GET /api/admin/runs/:runId/sources` request. | Must |
| REQ-019 | Event-driven | When `useRunSources` resolves with an empty `items` array, the modal shall render the empty-state copy `No raw items collected for this run.` | Body contains exactly that string and renders no item rows and no group headers. | Should |
| REQ-020 | Event-driven | When the user dismisses the modal (X button, Esc key, or overlay click), `Dialog.onOpenChange(false)` shall fire and the modal shall unmount. | After dismiss, no element with `data-state="open"` is present. | Must |
| REQ-021 | Ubiquitous | The endpoint shall validate the `:runId` path parameter as a UUID; non-UUID values shall produce a `400` response. | Request to `/api/admin/runs/not-a-uuid/sources` returns `400`. | Must |
| REQ-022 | Ubiquitous | The endpoint shall omit the `content` field from every returned item, regardless of whether it is populated in the database. | Sum of `'content' in item` across all items in any response equals `0`. | Must |

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|--------------|
| EDGE-001 | A run row has `derived === "failed"` and `itemCount === 0`. | Sources button is rendered but disabled (REQ-003). Tooltip "No items collected" appears on hover. | REQ-002, REQ-003 |
| EDGE-002 | A run row has `derived === "running"` (mid-collection). | Sources button is enabled; clicking it fetches and shows whatever raw_items exist so far. | REQ-002, REQ-004 |
| EDGE-003 | An item has `imageUrl === null`. | Modal row renders a 40×40 placeholder element in the thumbnail slot; no broken image icon. | REQ-016 |
| EDGE-004 | An item has `publishedAt === null` but `collectedAt` present. | Relative timestamp is derived from `collectedAt`. | REQ-016 |
| EDGE-005 | An item has `author === null`. | Author field is omitted or rendered as `—`; no JS error. | REQ-016 |
| EDGE-006 | The response contains items from only one `sourceType`. | Exactly one group header is rendered. | REQ-013 |
| EDGE-007 | The response contains 0 items (`items: []`). | Empty-state copy renders (REQ-019); no group headers; no item rows. | REQ-019 |
| EDGE-008 | The endpoint is called with no `admin_session` cookie. | `401` response (REQ-006); no DB query is executed. | REQ-006 |
| EDGE-009 | The endpoint is called with `:runId` that exists in Redis but not yet in `run_archives`. | Redis fallback path runs; items returned for that live run. | REQ-011 |
| EDGE-010 | The endpoint is called with `:runId` that exists in neither. | `404` with `{ error: "Run not found" }`. | REQ-012 |
| EDGE-011 | The user closes the modal while the request is still pending. | Query is cancelled or its result is ignored; no console errors. | REQ-020 |
| EDGE-012 | An image URL is unreachable / 404. | `onError` on the `<img>` swaps to placeholder. No broken-image glyph remains visible. | REQ-016 |
| EDGE-013 | The response payload size exceeds 100 KB (busy run). | Renders correctly within the scrollable body. No layout overflow of the parent admin page. | REQ-013, REQ-020 |
| EDGE-014 | Two clicks on the Sources button in quick succession. | Only one modal instance opens; the second click is a no-op while the modal is open. | REQ-004 |
| EDGE-015 | `:runId` is a valid UUID but has zero raw_items collected (e.g., all sources failed before items written). | `200` with `items: []`; empty state renders. | REQ-007, REQ-019 |

## Verification Matrix

| ID | Unit Test | Integration Test | E2E Test | Manual Test | Notes |
|----|-----------|-----------------|----------|-------------|-------|
| REQ-001 | Yes | No | Yes | No | Component test for RunsTable; Playwright DOM assert |
| REQ-002 | Yes | No | Yes | No | Component test |
| REQ-003 | Yes | No | No | No | Component test with prop matrix |
| REQ-004 | Yes | No | Yes | No | Component test for click; Playwright for full open |
| REQ-005 | No | Yes | No | No | react-query test using MSW |
| REQ-006 | No | Yes | No | No | API integration test: with/without admin cookie |
| REQ-007 | No | Yes | No | No | API integration test, zod-parse the body |
| REQ-008 | No | Yes | No | No | Same as REQ-007 |
| REQ-009 | Yes | Yes | No | No | Unit: sort comparator; Integration: response order |
| REQ-010 | Yes | Yes | No | No | Repo unit test with mocked DB + integration with seeded archive |
| REQ-011 | Yes | No | No | No | Repo unit test with redis mock |
| REQ-012 | No | Yes | No | No | API integration test, unknown UUID |
| REQ-013 | Yes | No | No | No | Component test |
| REQ-014 | Yes | No | No | No | Component test |
| REQ-015 | Yes | No | Yes | No | Component test + Playwright link assertion |
| REQ-016 | Yes | No | No | No | Component test |
| REQ-017 | Yes | No | No | No | Component test with delayed mock |
| REQ-018 | Yes | No | No | No | Component test with error mock |
| REQ-019 | Yes | No | No | No | Component test |
| REQ-020 | Yes | No | Yes | No | Component test + Playwright dismiss |
| REQ-021 | No | Yes | No | No | API integration with non-UUID path |
| REQ-022 | No | Yes | No | No | API integration assert |
| EDGE-001 | Yes | No | No | No | Component test |
| EDGE-002 | Yes | No | No | No | Component test |
| EDGE-003 | Yes | No | No | No | Component test |
| EDGE-004 | Yes | No | No | No | Component test |
| EDGE-005 | Yes | No | No | No | Component test |
| EDGE-006 | Yes | No | No | No | Component test |
| EDGE-007 | Yes | No | No | No | Component test |
| EDGE-008 | No | Yes | No | No | API integration |
| EDGE-009 | Yes | Yes | No | No | Repo unit + API integration |
| EDGE-010 | No | Yes | No | No | API integration |
| EDGE-011 | Yes | No | No | No | Component test with abort |
| EDGE-012 | Yes | No | No | No | Component test with onError simulation |
| EDGE-013 | No | No | No | Yes | Manual smoke with seeded large run |
| EDGE-014 | Yes | No | No | No | Component test with rapid clicks |
| EDGE-015 | No | Yes | No | No | API integration test |

## Verification Scenarios

These map to live functional verification (`functional-verify`). Each scenario produces evidence at `docs/spec/admin-source-button/verification/`.

### VS-1: Modal opens with grouped items
**Setup:** Seed a `run_archives` row plus 6 raw_items across HN/Reddit/Blog.
**Steps:**
1. Authenticate to `/admin`.
2. Click `Sources` on the seeded run's row.
3. Assert modal opens, title contains `Sources —`, body lists 3 source group headers in the order HN → Reddit → Blog, with correct counts.
**Pass:** All three groups present with item rows; titles are anchors with `target="_blank"`.

### VS-2: Disabled button for failed runs with no items
**Setup:** Seed a `run_archives` row with `status='failed'` and zero raw_items.
**Steps:**
1. Authenticate to `/admin`.
2. Locate the failed run row.
**Pass:** Sources button is rendered with `disabled` attribute set.

### VS-3: API 404 for unknown run
**Setup:** Pick a UUID that does not exist in DB or Redis.
**Steps:**
1. `curl -b admin_session=… /api/admin/runs/<uuid>/sources`.
**Pass:** Response status `404`, body `{ "error": "Run not found" }`.

### VS-4: API 401 without admin session
**Setup:** Existing run.
**Steps:**
1. `curl /api/admin/runs/<existing-uuid>/sources` (no cookie).
**Pass:** Response status `401`.

### VS-5: Empty state for run with 0 items
**Setup:** Run exists in `run_archives`, no raw_items rows match its window.
**Steps:**
1. Open `Sources` modal for that run.
**Pass:** Body shows the literal text `No raw items collected for this run.` and no group headers.

## Out of Scope

- Filtering, search, or sort controls inside the modal.
- Promoting items from the modal to the ranked list (existing Review page handles this).
- Streaming or polling for live updates while a run is in progress.
- Pagination of the response.
- Showing dedup decisions or which raw_items were merged.
- Exporting the source list (CSV/JSON).
- Modifying the Sources column on the public `/archive/:runId` page — public archive remains unchanged.
- Modifying or extending the existing `/api/admin/archives/:runId/pool` endpoint.
- Including the full `content` field of raw_items in the response.
