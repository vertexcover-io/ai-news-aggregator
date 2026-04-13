# SPEC: Recap-Style Archive Page (VER-65)

**Source:** `docs/plans/2026-04-13-recap-archive-page-design.md`
**Generated:** 2026-04-13
**Linear:** VER-65

---

## Requirements

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|----------------------|----------|
| REQ-001 | Event-driven | When a run reaches `completed` status on the RunPage, the system shall display a "View Archive" button in the results section | A button with text "View Archive" is visible in the DOM when `runState.status === "completed"` | Must |
| REQ-002 | Event-driven | When the user clicks the "View Archive" button, the system shall navigate to `/archive/:runId` using client-side routing | URL changes to `/archive/<runId>` without a full page reload | Must |
| REQ-003 | Ubiquitous | The `/archive/:runId` route shall be registered in the React Router config | Navigating directly to `/archive/some-id` renders the ArchivePage component, not a 404 | Must |
| REQ-004 | Event-driven | When the ArchivePage mounts with a valid runId, the system shall fetch run state via `GET /api/runs/:runId` | A network request to `GET /api/runs/<runId>` is made within 100ms of mount | Must |
| REQ-005 | State-driven | While the ArchivePage is loading run data, the system shall display a loading indicator | A loading spinner or skeleton is visible before the API response arrives | Must |
| REQ-006 | Unwanted behavior | If `GET /api/runs/:runId` returns 404, then the system shall display the message "Run not found — it may have expired" | The exact string "Run not found — it may have expired" is present in the rendered output; no story cards are rendered | Must |
| REQ-007 | Unwanted behavior | If the fetched run has `status !== "completed"`, then the system shall display the message "Run is still in progress — check back soon" with a link to navigate back | The exact string "Run is still in progress — check back soon" is visible; a back-navigation link is present | Must |
| REQ-008 | Event-driven | When the ArchivePage renders a completed run, the system shall display an ArchivePageHeader showing the run date, total story count, and profile name | Header contains: formatted date (e.g. "April 13, 2026"), count (e.g. "10 stories"), and profile name (or "default" if null) | Must |
| REQ-009 | Event-driven | When the ArchivePage renders a completed run, the system shall render one ArchiveStoryCard per item in `rankedItems` in rank order | The number of rendered story cards equals `rankedItems.length`; cards appear in ascending rank order (rank 1 first) | Must |
| REQ-010 | Ubiquitous | Each ArchiveStoryCard shall display the item's rank number, source type badge, publication date, author (if present), engagement (points and comment count), title as a linked heading, rationale prefixed with "The Recap:", and a "Read more →" link to the item URL | Each of these elements is present in the card's DOM; title href equals item URL; "Read more →" href equals item URL | Must |
| REQ-011 | Ubiquitous | The `RankedItem` shared type shall include a `content` field typed as `string \| null` | `packages/shared/src/types/run.ts` exports `RankedItem` with `content: string \| null` field; TypeScript strict mode passes | Must |
| REQ-012 | Event-driven | When `hydrateRankedItems` builds a `RankedItem`, the system shall populate `content` from the `raw_items.content` column | The `content` column is selected in the DB query; the returned `RankedItem` objects carry the value (null if DB value is null) | Must |
| REQ-013 | Ubiquitous | The ArchivePage shall display a "← Back to Run" link that navigates to `/run` | A link with text "← Back to Run" is present; clicking it navigates to `/run` | Should |
| REQ-014 | Ubiquitous | The ArchivePageHeader shall use the run's `startedAt` timestamp (formatted as full date) as the edition date | The formatted date in the header matches `new Date(runState.startedAt)` formatted as month-day-year | Must |

---

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|-------------|
| EDGE-001 | User navigates directly to `/archive/:runId` via URL bar (no prior RunPage session) | ArchivePage fetches the run independently; renders correctly if found, shows not-found message if 404 | REQ-003, REQ-004, REQ-006 |
| EDGE-002 | `rankedItems` is an empty array (`[]`) on the completed run | ArchivePageHeader renders with "0 stories"; no story cards rendered; no crash | REQ-008, REQ-009 |
| EDGE-003 | A `RankedItem` has `author: null` | The author field is omitted from the card metadata row; no "null" text is rendered | REQ-010 |
| EDGE-004 | A `RankedItem` has `publishedAt: null` | The date field is omitted from the card metadata row; no "null" text is rendered | REQ-010 |
| EDGE-005 | A `RankedItem` has `engagement.points === 0` and `engagement.commentCount === 0` | Points and comment count still render as "0" (not hidden); card remains valid | REQ-010 |
| EDGE-006 | A `RankedItem` has `content: null` (HN title-only items) | `content` field is null in the API response; no crash in ArchiveStoryCard; card renders without a body excerpt | REQ-011, REQ-012 |
| EDGE-007 | The run's `profileName` is null or absent | Header shows "default" as the profile name | REQ-008 |
| EDGE-008 | The API request to `GET /api/runs/:runId` fails with a network error (not 404) | ArchivePage shows a generic error message; does not show story cards | REQ-004, REQ-006 |
| EDGE-009 | Run has `status === "failed"` (not running, not completed) | Same "Run is still in progress — check back soon" branch does NOT trigger; show a distinct "Run failed" message or treat as non-completed | REQ-007 |
| EDGE-010 | `runId` in the URL contains special characters | The runId is passed as-is to the API; no encoding bugs; 404 if not found | REQ-003, REQ-004 |

---

## Verification Matrix

| ID | Unit Test | Integration Test | Manual Test | Notes |
|----|-----------|-----------------|-------------|-------|
| REQ-001 | Yes | No | No | Render `<RunPage>` with mocked `runState.status === "completed"`, assert button present |
| REQ-002 | Yes | No | No | Click "View Archive" button, assert router navigate called with correct path |
| REQ-003 | Yes | No | No | Verify route is registered in App.tsx router config |
| REQ-004 | Yes | No | No | Mount `<ArchivePage>` with mocked fetch, assert API call made |
| REQ-005 | Yes | No | No | Assert loading indicator present before mock resolves |
| REQ-006 | Yes | No | No | Mock fetch returns 404; assert exact error string rendered |
| REQ-007 | Yes | No | No | Mock fetch returns run with `status: "running"`; assert exact message + back link |
| REQ-008 | Yes | No | No | Mock completed run; assert header shows date, count, profile |
| REQ-009 | Yes | No | No | Mock completed run with N items; assert N cards in DOM in rank order |
| REQ-010 | Yes | No | No | Render `<ArchiveStoryCard>` with full item; assert each field present |
| REQ-011 | Yes | No | No | TypeScript compile check — `RankedItem.content` field exists |
| REQ-012 | No | Yes | No | Requires live DB; or unit-test the hydration function with a DB mock |
| REQ-013 | Yes | No | No | Assert back link present with correct href |
| REQ-014 | Yes | No | No | Assert formatted date matches `startedAt` timestamp |
| EDGE-001 | No | No | Yes | Manual: open `/archive/<id>` directly in browser |
| EDGE-002 | Yes | No | No | Mock run with empty `rankedItems: []`; assert 0 cards, header shows "0 stories" |
| EDGE-003 | Yes | No | No | Render card with `author: null`; assert no "null" text in DOM |
| EDGE-004 | Yes | No | No | Render card with `publishedAt: null`; assert no "null" text in DOM |
| EDGE-005 | Yes | No | No | Render card with `points: 0, commentCount: 0`; assert "0" renders |
| EDGE-006 | Yes | No | No | Render card with `content: null`; assert no crash, no body excerpt shown |
| EDGE-007 | Yes | No | No | Mock run with `profileName: null`; assert "default" in header |
| EDGE-008 | Yes | No | No | Mock fetch throws network error; assert generic error message shown |
| EDGE-009 | Yes | No | No | Mock run with `status: "failed"`; assert appropriate non-"in progress" state |
| EDGE-010 | No | No | Yes | Manual: test URL with special chars in runId |

---

## Out of Scope

- Image URL / OG image scraping and display (no infrastructure exists; placeholder badges used instead)
- LLM-generated "Unpacked:" bullet points per story
- LLM-generated "Bottom line:" strategic takeaway per story
- Email delivery of the archive-format digest
- Public unauthenticated access to archive pages
- Pagination of items on the archive page (all ranked items shown)
- "Copy shareable link" button
- Related posts / "Keep reading" section (no cross-run linking)
- Any new API endpoints (reuses `GET /api/runs/:runId`)
- Any new pipeline stages or LLM calls
- Any DB schema changes (no migration needed)
