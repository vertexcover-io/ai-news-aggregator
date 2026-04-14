# SPEC: Review & Curation (Phase 2)

**Source:** [`../2026-04-14-ui-overhaul-settings-review-design.md`](../2026-04-14-ui-overhaul-settings-review-design.md)
**Generated:** 2026-04-14
**Mockup:** [`review.png`](../2026-04-14-ui-overhaul-mockups/review.png)
**Depends on:** Phase 1 SPEC ([`../settings-scheduling-dashboard/SPEC.md`](../settings-scheduling-dashboard/SPEC.md)) — `user_settings`, dashboard, and `run_archives.reviewed` must exist.

This is Phase 2 of the UI overhaul. It introduces a Review page that lets the user curate a completed run — reorder, remove, and add posts by URL — before the archive renders it. The existing `/archive/:runId` UI is unchanged; only the underlying `rankedItems` that it reads may now be edited. Added posts are fetched through source-specific helpers (HN, Reddit, Web) and flow through the same recap-generation path as ranked items.

---

## Requirements

### Review page routing and data

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-100 | Ubiquitous | The system shall expose a Review page at `/review/:runId`. | Navigating to `/review/<existing-runId>` renders a page with the heading `Review · <date>`. | Must |
| REQ-101 | Event-driven | When the Review page mounts, the system shall fetch the run via `GET /api/archives/:runId` and render its `rankedItems` in order. | Each item in the response renders as one card; cards appear in the exact order returned by the API. | Must |
| REQ-102 | Unwanted | If `GET /api/archives/:runId` returns 404, then the system shall render an empty state with the exact text "This run was not found." and a link back to `/`. | DOM contains the exact string "This run was not found."; link's `href` is `/`. | Must |
| REQ-103 | Unwanted | If the run exists but its `status !== "completed"`, then the system shall render a message "This run is still in progress — check back once it finishes." and not enter edit mode. | No draggable list is rendered; no Save button is rendered. | Must |
| REQ-104 | State-driven | While the Review page is mounted and the user has `reviewed = true` already, the system shall still allow editing and saving again. | Saving re-renders with the latest edits; `reviewed` remains true; no errors. | Should |

### Dashboard routing to review

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-110 | Event-driven | When the dashboard renders a run with `reviewed = false` and `status = completed`, the system shall render its action as a "Review" button linking to `/review/:runId`. | `aria-label` or text "Review"; `href` is `/review/<runId>`. | Must |
| REQ-111 | Event-driven | When the dashboard renders a run with `reviewed = true`, the system shall render its action as "View archive" linking to `/archive/:runId`. | Text "View archive"; `href` is `/archive/<runId>`. | Must |

### Draggable list

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-120 | Ubiquitous | The system shall render each ranked item as a draggable card using `@dnd-kit/sortable`. | Each card has an `aria-roledescription="sortable"` handle; `dnd-kit` SortableContext wraps the list. | Must |
| REQ-121 | Event-driven | When the user drags a card and drops it in a new position, the system shall update local state so the card appears at the new index. | After drop event, the item's index in the rendered DOM order equals the drop index. | Must |
| REQ-122 | Ubiquitous | The draggable list shall be keyboard-operable: `Space` to pick up, `Arrow Up/Down` to move, `Space` to drop, `Escape` to cancel. | Cypress/Playwright keyboard-only test moves item 1 to position 3. | Must |
| REQ-123 | Event-driven | When the user clicks the delete button on a card, the system shall remove that card from the local list immediately. | After click, the item is no longer in the DOM; no network request is made until Save. | Must |
| REQ-124 | Ubiquitous | Each card shall display: drag handle, rank numeral (current position), thumbnail or placeholder, source chip, title, truncated rationale, score, delete button. | All eight elements are present in the card DOM; rank numeral updates when the card's index changes. | Must |
| REQ-125 | Ubiquitous | Cards that were added via the add-post flow in the current session shall have a distinct visual accent (left border or badge) and show "Added by you" in place of the score. | Added cards render with `data-added="true"`; score column shows the literal text "Added by you" or a manual-indicator. | Should |

### Add a post

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-130 | Ubiquitous | The Review page shall render an "Add a post" panel at the top with three source tabs (Hacker News, Reddit, Web), a URL input, and a "Fetch & add" button. | Three tab controls are present; one is selected by default; URL input is labeled "URL". | Must |
| REQ-131 | Event-driven | When the user submits a URL with a selected source type, the system shall call `POST /api/archives/:runId/add-post` with body `{ sourceType, url }`. | Request body matches; `Content-Type: application/json`; `sourceType` is one of `"hn"`, `"reddit"`, `"web"`. | Must |
| REQ-132 | State-driven | While `POST /api/archives/:runId/add-post` is pending, the system shall show a skeleton/pending card at the bottom of the list and keep the list interactive. | A DOM node with `data-pending="true"` appears; other cards remain draggable and deletable. | Must |
| REQ-133 | Event-driven | When the add-post request resolves with 200, the system shall replace the pending card with a full RankedItem card at the same position. | Pending node is removed; a new card with the returned `id` is rendered at that index. | Must |
| REQ-134 | Unwanted | If the add-post request fails (4xx or 5xx), then the system shall remove the pending card and render an inline error next to the add form with the response's error message. | Pending node is removed; an `role="alert"` element with the error text appears inside the add-post panel. | Must |
| REQ-135 | Unwanted | If the user submits a URL already present in the list (by `id` match on the server or by URL match on the client), then the system shall show an inline validation error without making the network request. | Error text is exactly "This post is already in the list."; no network request is made. | Must |

### Add-post backend

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-140 | Event-driven | When `POST /api/archives/:runId/add-post` is called with `sourceType: "hn"`, the system shall extract the HN item id from the URL (supporting `news.ycombinator.com/item?id=<n>` and Algolia URLs), fetch the item via HN API, run it through the recap-generation helper, upsert it into `raw_items`, and return a hydrated `RankedItem`. | Response status 200; body is a `RankedItem` with non-empty `title`, `url`, `recap`. `raw_items` has a matching row with `sourceType = "hn"`. | Must |
| REQ-141 | Event-driven | When `POST /api/archives/:runId/add-post` is called with `sourceType: "reddit"`, the system shall fetch `<url>.json` using the established Reddit User-Agent header, parse the post data and top comments, run the recap, upsert, and return the `RankedItem`. | Response status 200; body has the post's title and URL; `raw_items` row has `sourceType = "reddit"`. | Must |
| REQ-142 | Event-driven | When `POST /api/archives/:runId/add-post` is called with `sourceType: "web"`, the system shall fetch the URL as a single blog post (no listing-page discovery) via the existing Jina + LLM recap path, upsert, and return the `RankedItem`. | Response status 200; `raw_items` row has `sourceType = "web"` and `metadata.addedInReview = true`. | Must |
| REQ-143 | Ubiquitous | Each added item shall have `metadata.addedInReview = true` set on its `raw_items` row. | SQL query `SELECT metadata->>'addedInReview' FROM raw_items WHERE id = <addedId>` returns `'true'`. | Must |
| REQ-144 | Unwanted | If URL parsing fails for the given source type (e.g. HN URL without an item id), then the system shall return HTTP 400 with a message naming the source type and expected format. | Response status 400; body `{ error: string }` with a message containing the source type name. | Must |
| REQ-145 | Unwanted | If the upstream fetch (HN API, Reddit, or Jina) fails or times out, then the system shall return HTTP 502 with a message indicating the upstream failure. | Response status 502; body `{ error: string }` whose message references the source. | Must |
| REQ-146 | Unwanted | If the URL's extracted item id or `raw_items` row already exists for this run's `rankedItems`, then the system shall return HTTP 409. | Response status 409; body `{ error: "already in the list" }`. | Must |

### Save and exit

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-150 | Ubiquitous | The Review page shall render a sticky footer bar with an unsaved-changes summary, a "Discard" button, and a "Save & view archive" button. | Footer is visible without scrolling; summary text has the form "<N> unsaved changes". | Must |
| REQ-151 | Event-driven | When the user clicks "Save & view archive", the system shall call `PATCH /api/archives/:runId` with body `{ rankedItems: [{id, sourceType}, ...] }` in the current order, and on 200 navigate to `/archive/:runId`. | Request body length equals the current list length; items appear in the submitted order; on success, URL changes to `/archive/<runId>`. | Must |
| REQ-152 | Event-driven | When `PATCH /api/archives/:runId` returns 200, the system shall also set `reviewed = true` on the `run_archives` row. | SQL `SELECT reviewed FROM run_archives WHERE id = <runId>` returns `true` after save. | Must |
| REQ-153 | Event-driven | When the user clicks "Discard" with unsaved changes, the system shall show a confirmation dialog and, if confirmed, reset the list to the server's last-known state. | Dialog contains text "Discard all changes?"; on confirm, the list re-renders from the original server response. | Must |
| REQ-154 | State-driven | While the list has unsaved changes, the system shall intercept in-app navigation (react-router) with a confirmation prompt before leaving the page. | Using react-router's `useBlocker`, a prompt with message "You have unsaved changes..." appears when the user clicks any in-app link. | Must |
| REQ-155 | State-driven | While the list is empty (no items remaining), the system shall disable the "Save & view archive" button. | Button has `disabled` attribute and `aria-disabled="true"` when `rankedItems.length === 0`. | Must |
| REQ-156 | Unwanted | If `PATCH /api/archives/:runId` fails (4xx/5xx), then the system shall keep the user on the page, keep local state intact, and show an error toast containing the response error message. | Toast visible; URL unchanged; list retains local edits. | Must |

### PATCH endpoint

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-160 | Event-driven | When `PATCH /api/archives/:runId` is called with `{ rankedItems: Array<{id, sourceType}> }`, the system shall validate every `id` exists in `raw_items`, overwrite the archive's `rankedItems` column, set `reviewed = true` and `updatedAt = now()`. | Row in `run_archives` reflects the new order; `reviewed` flipped to true; `updatedAt` is within 5 seconds of the request. | Must |
| REQ-161 | Unwanted | If any `id` in the PATCH body does not exist in `raw_items`, then the system shall return HTTP 400 with a body listing the missing ids. | Response status 400; body `{ error: string, missingIds: string[] }`. | Must |
| REQ-162 | Unwanted | If the PATCH body contains zero items, then the system shall return HTTP 400. | Response status 400; body `{ error: "rankedItems cannot be empty" }`. | Must |
| REQ-163 | Unwanted | If `PATCH /api/archives/:runId` is called for a non-existent `runId`, then the system shall return HTTP 404. | Response status 404. | Must |
| REQ-164 | Ubiquitous | The `rankedItems` jsonb column in `run_archives` shall store items as an array of lite references `{id, sourceType}`, matching today's shape. | Column schema unchanged; archive hydration still works through the existing `raw_items` join. | Must |

---

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|--------------|
| EDGE-100 | User drags a card while an add-post fetch is pending. | The drag works on the existing list; when the fetch resolves, the new card appends at its originally-chosen slot (default: end). | REQ-121, REQ-133 |
| EDGE-101 | User deletes all items and then clicks Save. | Save button is disabled per REQ-155; if somehow posted (e.g. via devtools), the PATCH returns 400 per REQ-162. | REQ-155, REQ-162 |
| EDGE-102 | User adds the same URL twice in rapid succession (two pending cards). | The second add shows the inline validation error per REQ-135; only one network request goes out. | REQ-135 |
| EDGE-103 | User opens the Review page for a `run_archives` row whose `rankedItems` array has stale ids (deleted `raw_items` row). | Render only the ids that hydrate successfully; show a warning banner "Some items are no longer available and were skipped." | REQ-101 |
| EDGE-104 | HN item URL points to an Ask HN / Show HN / Poll. | Treated the same as a story; recap still generated. If the item type is `comment`, return 400 per REQ-144. | REQ-140, REQ-144 |
| EDGE-105 | Reddit URL is for a comment, not a post. | HTTP 400 with message "URL must point to a post, not a comment". | REQ-144 |
| EDGE-106 | Web URL is actually a listing page (e.g. `/blog`). | The recap is generated on whatever markdown Jina returns; if the LLM recap step fails, return 502. No special listing detection. | REQ-142, REQ-145 |
| EDGE-107 | Fetch takes longer than the per-item timeout (15s). | The request aborts via AbortController; endpoint returns 502 per REQ-145. | REQ-145 |
| EDGE-108 | User navigates back via the browser Back button with unsaved changes. | Browser's `beforeunload` handler prompts; react-router's in-app blocker handles in-app nav. | REQ-154 |
| EDGE-109 | User reorders, saves, reorders again, saves. | Each save is a full overwrite; the second PATCH produces the final order. `reviewed` stays `true` after the second save. | REQ-151, REQ-152, REQ-104 |
| EDGE-110 | PATCH body contains duplicate ids. | HTTP 400 with message about duplicate ids. | REQ-161 |
| EDGE-111 | Archive page loads immediately after save. | The archive renders the edited `rankedItems`; existing archive hydration path unchanged. | REQ-151, REQ-164 |
| EDGE-112 | User hits Save while an add-post fetch is still pending. | Save button is disabled while any pending add is in flight. | REQ-132, REQ-151 |
| EDGE-113 | Concurrent PATCH from two tabs. | Last write wins; the final row reflects whichever request hit the DB last. No locking. | REQ-160 |
| EDGE-114 | User attempts to review a run whose archive predates Phase 1 (`reviewed = true` from backfill). | Review page works per REQ-104; list loads from archive; user can re-curate. | REQ-104 |

---

## Verification Matrix

| REQ/EDGE ID | Unit Test | Integration Test | E2E Test | Manual Test | Notes |
|-------------|-----------|------------------|----------|-------------|-------|
| REQ-100 | Yes | No | Yes | No | |
| REQ-101 | Yes | Yes | Yes | No | |
| REQ-102 | Yes | No | No | No | Mock API 404 |
| REQ-103 | Yes | No | No | No | Mock API response with `status: "running"` |
| REQ-104 | No | Yes | No | No | Integration: save twice, assert both succeed |
| REQ-110 | Yes | No | No | No | |
| REQ-111 | Yes | No | No | No | |
| REQ-120 | Yes | No | No | No | Snapshot/DOM test |
| REQ-121 | Yes | No | Yes | No | dnd-kit testing utilities |
| REQ-122 | No | No | Yes | No | Playwright keyboard-only journey |
| REQ-123 | Yes | No | No | No | |
| REQ-124 | Yes | No | No | No | |
| REQ-125 | Yes | No | No | No | |
| REQ-130 | Yes | No | No | No | |
| REQ-131 | Yes | No | No | No | |
| REQ-132 | Yes | No | No | No | |
| REQ-133 | Yes | No | Yes | No | |
| REQ-134 | Yes | No | No | No | |
| REQ-135 | Yes | No | No | No | |
| REQ-140 | Yes | Yes | No | Yes | Integration hits a fake HN; manual with real URL |
| REQ-141 | Yes | Yes | No | Yes | Same as above for Reddit |
| REQ-142 | Yes | Yes | No | Yes | Same as above for web |
| REQ-143 | No | Yes | No | No | |
| REQ-144 | Yes | No | No | No | |
| REQ-145 | Yes | Yes | No | No | Injects a fetch that times out |
| REQ-146 | Yes | Yes | No | No | |
| REQ-150 | Yes | No | No | No | |
| REQ-151 | Yes | Yes | Yes | No | E2E: full review flow ending on `/archive/:runId` |
| REQ-152 | No | Yes | No | No | |
| REQ-153 | Yes | No | No | No | |
| REQ-154 | Yes | No | Yes | No | |
| REQ-155 | Yes | No | No | No | |
| REQ-156 | Yes | No | No | No | |
| REQ-160 | Yes | Yes | No | No | |
| REQ-161 | Yes | No | No | No | |
| REQ-162 | Yes | No | No | No | |
| REQ-163 | Yes | No | No | No | |
| REQ-164 | No | Yes | No | No | Hydration test after save |
| EDGE-100 | Yes | No | No | No | |
| EDGE-101 | Yes | No | No | No | |
| EDGE-102 | Yes | No | No | No | |
| EDGE-103 | No | Yes | No | No | Seed archive with a stale id |
| EDGE-104 | Yes | Yes | No | No | |
| EDGE-105 | Yes | No | No | No | |
| EDGE-106 | No | Yes | No | No | |
| EDGE-107 | Yes | No | No | No | Inject fetch with controllable delay |
| EDGE-108 | No | No | Yes | No | Playwright back-button |
| EDGE-109 | No | Yes | No | No | |
| EDGE-110 | Yes | No | No | No | |
| EDGE-111 | No | Yes | Yes | No | |
| EDGE-112 | Yes | No | No | No | |
| EDGE-113 | No | No | No | Yes | Documented behavior; manual only |
| EDGE-114 | No | Yes | No | No | Seed a `reviewed=true` archive, open review, save |

---

## Out of Scope

- **Settings, scheduling, and dashboard pages** — handled in the Phase 1 SPEC.
- **Archive page UI changes** — `/archive/:runId` renders identically; only the `rankedItems` data changes.
- **Revert-to-original / snapshot of AI ranking** — edits overwrite `rankedItems` permanently. No `original_ranked_items` column.
- **Collaborative editing** — single-user tool; no conflict resolution beyond last-write-wins.
- **Bulk operations on the list** — no "delete all", no multi-select, no bulk-reorder-to-rank-by-score.
- **Editing title, rationale, or recap of existing items** — items are included or excluded, not rewritten.
- **Re-running the ranker on the curated list** — the ordering from the user's drag is final; no re-ranking step.
- **Change history / audit log of edits** — no `review_events` table; only the final state is persisted.
- **Auto-save** — the spec chose explicit Save; autosave is not included.
- **Adding posts by pasting a title + URL manually** — add-post always fetches via the source-specific helper; no "manual entry" path.
- **Preview pane / side-by-side archive preview** — user must save and navigate to see the archive rendering.
- **Undo stack beyond Discard** — only a single Discard-to-server-state is supported; no per-action undo.
