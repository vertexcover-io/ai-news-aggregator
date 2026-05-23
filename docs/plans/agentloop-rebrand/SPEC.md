# SPEC: AgentLoop Rebrand — Home / Must Read / Built

**Source:** `docs/plans/2026-05-23-agentloop-rebrand-design.md`
**Generated:** 2026-05-23

## Requirements

### Public Home Page (REQ-001 – REQ-010)

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|----------------------|----------|
| REQ-001 | Event-driven | When the public visitor sends `GET /`, the system shall render the masthead containing the literal text `AGENTLOOP`, the literal text `A Vertexcover Labs publication`, and the top-right links `MUST READ`, `BUILT`, `SUBSCRIBE →`. | Rendered HTML contains each of the four literal strings exactly once in the page header region. | Must |
| REQ-002 | Event-driven | When the public visitor sends `GET /`, the system shall render the hero block containing the literal headline `The daily read for people who ship with agents.`, the four pillar chips `AGENTIC CODING`, `HARNESS ENGINEERING`, `CONTEXT ENGINEERING`, `THE SOFTWARE FACTORY`, and the exclusion line `No model releases. No benchmarks. No discourse. Just the craft.`. | All seven literal strings appear in the rendered hero block. | Must |
| REQ-003 | Event-driven | When the public visitor sends `GET /` and at least one reviewed `run_archives` row exists with `completed_at` within the last 48 hours, the system shall render a "Today's Issue" block containing that archive's `digestHeadline`, `digestSummary`, run date, and a link to `/archive/<runId>`. | DOM node `[data-section="todays-issue"]` is present and contains the headline text and an `<a>` to the correct archive URL. | Must |
| REQ-004 | Event-driven | When the public visitor sends `GET /` and at least one `must_read_entries` row exists, the system shall render a "From the canon" block containing the entry's `title`, `author` (if non-null), `year` (if non-null), `annotation`, and a link to the entry's `url`. | DOM node `[data-section="from-the-canon"]` is present, contains the entry title and annotation, and the link `href` matches the entry's `url`. | Must |
| REQ-005 | Event-driven | When the public visitor sends `GET /`, the system shall render an inline subscribe card containing the headline `Read AgentLoop every morning.`, the sub-line `What we read so you don't have to. 7am daily, free.`, an email input, and a `SUBSCRIBE →` button that POSTs to `/api/subscribe`. | DOM node `[data-section="inline-subscribe"]` is present; the form's `action` resolves to `/api/subscribe` and `method="POST"`. | Must |
| REQ-006 | Event-driven | When the public visitor sends `GET /` and at least one reviewed archive exists, the system shall render a "Recent Issues" section with up to 10 entries ordered by `completed_at DESC`, excluding the row already shown as Today's Issue when present. | DOM node `[data-section="recent-issues"]` is present and contains ≤10 archive row elements; if Today's Issue is rendered, its `runId` is not duplicated in this section. | Must |
| REQ-007 | Event-driven | When the public visitor sends `GET /`, the system shall render an "Elsewhere" three-column strip containing a `MUST READ` column linking to `/must-read`, a `SOURCES` column linking to `/sources`, and a `TOOLS` column rendered as static muted text `COMING SOON →` with no link. | DOM node `[data-section="elsewhere"]` is present with three child columns; the Tools column has no `<a>` element. | Must |
| REQ-008 | Event-driven | When the public visitor sends `GET /`, the system shall render a colophon line containing the text `AgentLoop is built by agents — using the same harness engineering practices it covers. See how it's built →` with the rust accent link pointing to `/built`. | The colophon string appears once; the embedded link's `href` equals `/built`. | Must |
| REQ-009 | Ubiquitous | The system shall NOT render a full directory navigation row (`TODAY · ARCHIVE · MUST READ · SOURCES · TOOLS · BUILT`) on the `/` page. | No DOM node with `[data-section="directory-nav"]` is present on `/`. | Must |
| REQ-010 | Event-driven | When the public visitor sends `GET /api/home`, the system shall return HTTP 200 with a JSON body of shape `{ todaysIssue: ArchiveListItem \| null, featuredCanon: MustReadEntry \| null, recentIssues: ArchiveListItem[] }`. | Response status is 200; body parses to the documented shape; `recentIssues` array length is ≤10. | Must |

### Public Must Read Page (REQ-011 – REQ-016)

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|----------------------|----------|
| REQ-011 | Event-driven | When the public visitor sends `GET /must-read`, the system shall render the masthead (per REQ-001), the full directory nav row containing `TODAY · ARCHIVE · MUST READ · SOURCES · TOOLS · BUILT`, the headline `Must Read`, and the sub-deck `The seminal reading on agentic coding, harness engineering, and the software factory. Annotated and kept current.`. | All four literal strings present; directory nav contains all six items. | Must |
| REQ-012 | Event-driven | When the public visitor sends `GET /must-read`, the system shall render all `must_read_entries` rows in reverse-chronological order by `added_at`, with each entry showing: mono `ADDED: <DATE>` eyebrow, serif title, mono `Author · Year` byline (omitted fields when null), italic annotation, and a rust `→ source.host` link with `rel="noopener noreferrer" target="_blank"`. | Entries appear in `addedAt DESC` order; each entry's source link has both `rel` and `target` attributes set as specified. | Must |
| REQ-013 | Event-driven | When the public visitor sends `GET /must-read`, the system shall render two inline subscribe cards: one immediately after the page header/meta and one immediately before the colophon. | Exactly 2 DOM nodes matching `[data-section="inline-subscribe"]` are present on `/must-read`. | Must |
| REQ-014 | Event-driven | When the public visitor sends `GET /api/must-read`, the system shall return HTTP 200 with a JSON array of `PublicMustReadEntry` objects ordered by `addedAt DESC`. | Response status is 200; body is an array; each element omits the `updatedAt` field. | Must |
| REQ-015 | Event-driven | When the public visitor sends `GET /api/must-read` and zero `must_read_entries` rows exist, the system shall return HTTP 200 with body `[]`. | Response status is 200; body equals `[]`. | Must |
| REQ-016 | Event-driven | When the public visitor sends `GET /must-read` and zero entries exist, the system shall render the meta line containing `0 entries`, and both subscribe cards. | Page contains the literal string `0 entries`; exactly 2 subscribe cards present; no "no entries yet" placeholder is rendered. | Must |

### Public Built Page (REQ-017 – REQ-019)

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|----------------------|----------|
| REQ-017 | Event-driven | When the public visitor sends `GET /built`, the system shall render the masthead (per REQ-001), the full directory nav row, the headline `How AgentLoop is built`, and the sub-deck `This newsletter writes itself. Almost.`. | All four literal strings present. | Must |
| REQ-018 | Event-driven | When the public visitor sends `GET /built`, the system shall render: the `THE ARGUMENT` manifesto (four paragraphs verbatim from `/tmp/agentloop-previews/built.html`), the `THE PIPELINE` diagram with the seven stages `BRAINSTORM → SPEC → PLAN → TDD → REVIEW → VERIFY → SHIP`, the `THE SKILLS` table (9 rows), the `THE AGENTS` table (4 rows), the `THE ARTIFACTS` table (6 rows), the `THE GUARDRAILS` paragraph, and the `TRY IT YOURSELF` closing block. | Each section header is present once; pipeline contains all 7 stage labels; the three tables have 9 / 4 / 6 rows respectively. | Must |
| REQ-019 | Ubiquitous | The `BuiltPage.tsx` source file shall export a top-level `LAST_REVIEWED` constant whose value is an ISO-8601 date string. | Static grep of `packages/web/src/pages/BuiltPage.tsx` matches `^export const LAST_REVIEWED = "\d{4}-\d{2}-\d{2}";`. | Should |

### Admin Must Read API (REQ-020 – REQ-027)

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|----------------------|----------|
| REQ-020 | Event-driven | When the admin sends `POST /api/admin/must-read/preview` with body `{ url: string }` and the URL extraction succeeds, the system shall return HTTP 200 with body `{ status: "extracted", suggested: { title: string, author: string \| null, year: number \| null } }`. | Response status is 200; body matches the `extracted` variant; `title` is non-empty. | Must |
| REQ-021 | Unwanted | If the admin sends `POST /api/admin/must-read/preview` and the URL extraction fails (timeout, 4xx, 5xx, bot-block, parse error), then the system shall return HTTP 200 with body `{ status: "extraction_failed", error: string }`. | Response status is 200; body matches the `extraction_failed` variant with a non-empty error message. | Must |
| REQ-022 | Ubiquitous | The `POST /api/admin/must-read/preview` endpoint shall NOT persist any data. | After a successful preview call, `SELECT count(*) FROM must_read_entries` returns the same value as before the call. | Must |
| REQ-023 | Event-driven | When the admin sends `POST /api/admin/must-read` with a valid body and the URL is not already present, the system shall insert a new row with `addedAt = now()` and return HTTP 201 with the created `MustReadEntry`. | Response status is 201; body matches the inserted row; `SELECT count(*)` increased by 1. | Must |
| REQ-024 | Unwanted | If the admin sends `POST /api/admin/must-read` with a URL that already exists, then the system shall return HTTP 409 with body `{ error: "duplicate_url", existingId: <uuid> }` and NOT insert a new row. | Response status is 409; body matches the duplicate variant; `existingId` matches the pre-existing row's id; row count unchanged. | Must |
| REQ-025 | Event-driven | When the admin sends `GET /api/admin/must-read`, the system shall return HTTP 200 with a JSON array of full `MustReadEntry` rows (including `updatedAt`) ordered by `addedAt DESC`. | Response status is 200; each element has an `updatedAt` field. | Must |
| REQ-026 | Event-driven | When the admin sends `PATCH /api/admin/must-read/:id` with a valid partial body, the system shall update the named fields, set `updatedAt = now()`, leave `addedAt` unchanged, and return HTTP 200 with the updated row. | Response status is 200; row's `addedAt` equals pre-call value; row's `updatedAt` is later than pre-call value. | Must |
| REQ-027 | Event-driven | When the admin sends `DELETE /api/admin/must-read/:id` for an existing row, the system shall remove the row and return HTTP 204 with no body. | Response status is 204; `SELECT count(*) WHERE id = :id` returns 0. | Must |

### Admin Must Read UI (REQ-028 – REQ-031)

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|----------------------|----------|
| REQ-028 | Event-driven | When the admin loads `GET /admin/must-read`, the system shall render an "Add new" CTA and a table with one row per entry, each row showing title, author, year, `addedAt` date, and Edit/Delete buttons. | DOM contains an `[data-action="add-new"]` button; table row count equals the number of entries returned by the admin list endpoint. | Must |
| REQ-029 | Event-driven | When the admin loads the add-new form, pastes a URL, and submits, the system shall disable the Save button, show an "Extracting…" indicator, call `POST /api/admin/must-read/preview`, and on success prefill the title/author/year fields with the suggested values. | Save button has `disabled` attribute during the call; on success, the three fields contain the suggested values. | Must |
| REQ-030 | Unwanted | If the preview call returns `extraction_failed`, then the admin form shall display a banner with the literal prefix `Extraction failed: ` followed by the error message and leave the title/author/year fields empty. | Banner DOM node is present with the prefix; the three input fields have empty `value` attributes. | Must |
| REQ-031 | Event-driven | When the admin saves a new entry whose URL is already present (REQ-024), the system shall display a message containing `URL already exists` and a link to the existing entry's edit page. | Page contains the literal string `URL already exists`; an `<a>` to `/admin/must-read/<existingId>` is present. | Must |

### Subscribe Wiring (REQ-032)

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|----------------------|----------|
| REQ-032 | Ubiquitous | Every subscribe surface (top-right masthead link, every inline subscribe card, footer subscribe field) shall POST to `/api/subscribe`. | All `<form>` elements with `[data-purpose="subscribe"]` have `action="/api/subscribe"` and `method="POST"`. | Must |

### Non-functional (NF-001 – NF-008)

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|----------------------|----------|
| NF-001 | Ubiquitous | The `GET /api/home` p50 first-byte latency shall be within 100ms of the `GET /api/archives` baseline measured on the same instance. | `curl -w "%{time_starttransfer}\n" -o /dev/null -s` median over 10 sequential calls is ≤ baseline + 0.100s. | Should |
| NF-002 | Ubiquitous | The `POST /api/admin/must-read/preview` endpoint shall return within 15 seconds. | Request that does not return within 15s is aborted; the response is `{ status: "extraction_failed", error: "timeout" }`. | Must |
| NF-003 | Ubiquitous | The `featuredCanon` field returned by `GET /api/home` shall be selected uniformly at random across all `must_read_entries` rows on every request. | Over 100 sequential calls against a table of 10 distinct entries, each entry appears at least once. | Should |
| NF-004 | Ubiquitous | The `GET /api/must-read` response shall NOT include the `updatedAt` field for any entry. | For every element in the array, `Object.hasOwn(entry, "updatedAt")` is `false`. | Must |
| NF-005 | Ubiquitous | Every external link to a source URL on `/must-read` and on the home page Today's Issue block shall have `rel="noopener noreferrer"` and `target="_blank"`. | DOM query `a[href^="http"]:not([rel*="noopener"]):not([rel*="noreferrer"])` returns zero elements; `a[href^="http"]:not([target="_blank"])` returns zero elements within the entry sections. | Must |
| NF-006 | Ubiquitous | The `admin_session` cookie shall be set with `SameSite=Lax` or `SameSite=Strict`. | `Set-Cookie` header on `POST /api/admin/login` response contains `SameSite=Lax` or `SameSite=Strict`. | Must |
| NF-007 | Ubiquitous | The `isPrivateOrLoopbackHost` helper shall reject hosts in `10.0.0.0/8` and `172.16.0.0/12` in addition to the existing blocked ranges. | Unit test passes for inputs `10.0.0.1`, `10.255.255.254`, `172.16.0.1`, `172.31.255.254` — each returns `true`. | Must |
| NF-008 | Unwanted | If `POST /api/admin/must-read/preview` receives a URL whose resolved host is in any blocked range (NF-007), then the system shall return `{ status: "extraction_failed", error: "<message naming the SSRF rejection>" }` without performing the fetch. | Request body `{ url: "http://10.0.0.1/" }` returns the `extraction_failed` variant; no outbound HTTP request is made. | Must |

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|--------------|
| EDGE-001 | Zero reviewed `run_archives` rows exist (cold start). | `GET /api/home` returns `{ todaysIssue: null, featuredCanon: ?, recentIssues: [] }`. Home page hides Today's Issue and Recent Issues sections; renders masthead, hero, From-the-canon (if entries exist), subscribe, Elsewhere, colophon, footer. | REQ-003, REQ-006, REQ-010 |
| EDGE-002 | Zero `must_read_entries` rows exist (cold start). | `GET /api/home` returns `featuredCanon: null`; home page hides the From-the-canon section. `GET /must-read` renders the meta line `0 entries` and both subscribe cards. `GET /api/must-read` returns `[]`. | REQ-004, REQ-015, REQ-016 |
| EDGE-003 | URL extraction returns partial data (title only). | Admin form prefills the title field; author and year fields stay empty for manual entry; the form is still submittable. | REQ-020 |
| EDGE-004 | URL extraction fails entirely (timeout, 404, bot-blocked, paywall). | Admin form opens with all fields empty; banner with `Extraction failed: <reason>. Enter manually.` is displayed; Save button remains enabled. | REQ-021, REQ-030 |
| EDGE-005 | Admin deletes the only Must Read entry while a public visitor has the home page open. | Next page load (or `GET /api/home` call) returns `featuredCanon: null`; the rendered home hides the From-the-canon section. No real-time invalidation is required. | REQ-027, REQ-004 |
| EDGE-006 | Admin attempts to save an entry whose URL already exists. | API returns 409 with `existingId`; admin UI displays a message containing `URL already exists` and a link to the edit page; no new row is inserted. | REQ-024, REQ-031 |
| EDGE-007 | Featured canon selects an entry whose URL has gone dead since being added. | The entry renders as normal; the source link is intact; clicking it opens a new tab (`target="_blank"`) with whatever response the target now returns (e.g., a 404). System does not validate liveness. | REQ-004, NF-005 |
| EDGE-008 | Admin closes the browser tab during the 5–15s URL extraction. | Server-side extraction continues until completion or 15s timeout; no row is created; the next preview request from any admin is a fresh call (no state inherited). | REQ-022, NF-002 |
| EDGE-009 | Admin PATCHes a 6-month-old entry. | `addedAt` is unchanged (entry stays in its reverse-chron position); `updatedAt` is updated to `now()`; the updated row is returned in the response. | REQ-026 |
| EDGE-010 | Admin pastes a private/loopback/link-local URL (e.g. `http://localhost/`, `http://10.0.0.5/`, `http://169.254.169.254/`). | Preview endpoint returns `extraction_failed` with a message naming the SSRF rejection; no outbound HTTP request is made by the server. | NF-007, NF-008 |
| EDGE-011 | Today's Issue is the most recent reviewed archive but its `completed_at` is older than 48 hours. | `todaysIssue` is `null`; `recentIssues` includes that archive as its first element. | REQ-003, REQ-010 |
| EDGE-012 | An external link in a Must Read entry has the source's existing `rel` or `target` attribute set differently in the source data. | Rendered output always uses `rel="noopener noreferrer" target="_blank"` regardless of any value in stored data. | REQ-012, NF-005 |
| EDGE-013 | `must_read_entries` has only one row. | `GET /api/home` returns that single row as `featuredCanon` on every request. NF-003's uniformity test trivially passes (single bucket). | REQ-004, NF-003 |
| EDGE-014 | A public visitor sends `GET /api/home` while a migration to add the `must_read_entries` table is mid-deploy (pre-deploy state). | The endpoint either does not yet exist (404) or returns `featuredCanon: null` once the migration is live. Out of scope for handling at runtime; deploy ordering is the mitigation. | REQ-010 |
| EDGE-015 | `MustReadEntry` is rendered with `author = null, year = null`. | UI shows the title alone on its byline row; no stray `·` separator is rendered. | REQ-004, REQ-012 |

## Verification Matrix

| REQ ID | Unit Test | Integration Test | E2E Test | Manual Test | Notes |
|--------|-----------|------------------|----------|-------------|-------|
| REQ-001 | Yes | No | Yes | No | E2E asserts masthead literals on `/` |
| REQ-002 | Yes | No | Yes | No | Hero block rendering |
| REQ-003 | Yes | Yes | Yes | No | Component unit + API integration + E2E |
| REQ-004 | Yes | Yes | Yes | No | From-the-canon rendering + composite API |
| REQ-005 | Yes | No | Yes | No | Subscribe card form attributes |
| REQ-006 | Yes | Yes | Yes | No | Recent issues exclusion logic |
| REQ-007 | Yes | No | Yes | No | Elsewhere strip — Tools column has no `<a>` |
| REQ-008 | Yes | No | Yes | No | Colophon link target |
| REQ-009 | Yes | No | Yes | No | Negative assertion on `/` |
| REQ-010 | No | Yes | No | No | Composite API shape + status |
| REQ-011 | Yes | No | Yes | No | Must Read page literals |
| REQ-012 | Yes | Yes | Yes | No | Reverse-chron ordering + rel/target |
| REQ-013 | Yes | No | Yes | No | Exactly two subscribe cards |
| REQ-014 | No | Yes | No | No | Public list endpoint |
| REQ-015 | No | Yes | No | No | Empty list returns `[]` |
| REQ-016 | Yes | No | Yes | No | Empty Must Read renders meta + cards |
| REQ-017 | Yes | No | Yes | No | Built page literals |
| REQ-018 | Yes | No | Yes | No | Built page sections + table counts |
| REQ-019 | Yes | No | No | No | Grep/parse the source file |
| REQ-020 | No | Yes | No | No | Preview endpoint success path |
| REQ-021 | No | Yes | No | No | Preview endpoint failure path |
| REQ-022 | No | Yes | No | No | Persistence assertion via DB count |
| REQ-023 | No | Yes | No | No | Create endpoint success |
| REQ-024 | No | Yes | No | No | Duplicate URL 409 |
| REQ-025 | No | Yes | No | No | Admin list endpoint |
| REQ-026 | No | Yes | No | No | PATCH preserves addedAt |
| REQ-027 | No | Yes | No | No | DELETE removes row |
| REQ-028 | Yes | No | Yes | No | Admin list UI |
| REQ-029 | Yes | Yes | Yes | No | Two-step form flow |
| REQ-030 | Yes | No | Yes | No | Extraction failure banner |
| REQ-031 | Yes | No | Yes | No | Duplicate-URL admin UX |
| REQ-032 | Yes | No | Yes | No | All subscribe forms target `/api/subscribe` |
| NF-001 | No | No | No | Yes | Manual benchmark with `curl -w` |
| NF-002 | No | Yes | No | No | Mock slow URL; assert 15s abort |
| NF-003 | No | Yes | No | No | Statistical check over 100 calls |
| NF-004 | No | Yes | No | No | Assert no `updatedAt` key in response |
| NF-005 | Yes | No | Yes | No | DOM attribute assertions |
| NF-006 | No | Yes | No | No | Assert Set-Cookie header on login response |
| NF-007 | Yes | No | No | No | Pure function unit test |
| NF-008 | No | Yes | No | No | Mocked outbound fetch counter |
| EDGE-001 | Yes | Yes | Yes | No | Cold-start home rendering |
| EDGE-002 | Yes | Yes | Yes | No | Cold-start must-read rendering |
| EDGE-003 | Yes | Yes | No | No | Partial extraction prefill |
| EDGE-004 | Yes | Yes | No | No | Full extraction failure UX |
| EDGE-005 | No | Yes | No | No | Delete-then-fetch sequence |
| EDGE-006 | No | Yes | Yes | No | Duplicate save round-trip |
| EDGE-007 | No | No | No | Yes | Editorial check; no automated assertion |
| EDGE-008 | No | Yes | No | No | Mid-extraction abandonment |
| EDGE-009 | No | Yes | No | No | PATCH on stale row |
| EDGE-010 | No | Yes | No | No | SSRF rejection on preview |
| EDGE-011 | No | Yes | No | No | 48h freshness window |
| EDGE-012 | Yes | No | No | No | Component override of stored attrs |
| EDGE-013 | No | Yes | No | No | Single-row uniformity |
| EDGE-014 | No | No | No | Yes | Deploy-time concern |
| EDGE-015 | Yes | No | No | No | Null author/year rendering |

## Out of Scope

- The pipeline, scheduler, BullMQ workers, collector code, and ranking/recap logic are unchanged.
- The `/admin` dashboard, `/admin/review/:runId`, and `/admin/settings` pages are unchanged.
- The `/api/subscribe` endpoint and double-opt-in confirmation flow are unchanged; this spec only wires new surfaces to the existing endpoint.
- No themes, tags, categories, cornerstone flags, sort controls, search, pagination, view counters, or RSS feed for Must Read.
- No images, OG previews, or thumbnails on Must Read entries.
- No admin UI for editing `/built` page copy; copy is code-edited in TSX.
- No HTTP caching headers, CDN integration, or static site generation. All pages are server-rendered per request.
- No `/tools` route or page; the Elsewhere strip's Tools column is static muted text only.
- No real-time invalidation when Must Read entries are deleted (next page load is sufficient).
- No URL liveness validation on Must Read entries (editorial responsibility).
- No DNS rebinding protection beyond hostname-string matching in `isPrivateOrLoopbackHost` (the helper does string-level rejection; resolved-IP rejection is deferred until needed).
- No analytics events on the new pages beyond what `PublicLayout` already wires.
- No migration of existing `ArchiveListingPage` data or behaviors; the route at `/` simply renders a different component.
