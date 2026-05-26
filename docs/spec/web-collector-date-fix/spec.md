# SPEC: Web Collector Date Extraction & Relative-Date Resolution

**Source:** docs/spec/web-collector-date-fix/design.md
**Generated:** 2026-05-26

## Requirements

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|----------------------|----------|
| REQ-001 | Event-driven | When converting fetched HTML in either mode, the system shall extract a publish date from structured signals on the original DOM (before Readability mutation) | `extractPublishedAt(doc)` returns a `Date` for the therundown.ai fixture (`2026-05-25`) and the llm-stats.com fixture; returns the JSON-LD `datePublished` date, not the body-text date | Must |
| REQ-002 | Ubiquitous | The structured extractor shall try signals in precedence order: JSON-LD `datePublished` → `<meta>` published-time variants → `<time datetime>`, returning the first that parses to a valid `Date` | Unit tests assert each tier is used when higher tiers are absent, and the higher tier wins when multiple are present | Must |
| REQ-003 | Ubiquitous | The JSON-LD reader shall handle a single object, an array of nodes, and an `@graph` array, selecting the first node carrying `datePublished` among `Article`/`NewsArticle`/`BlogPosting` | Unit tests cover object, array, and `@graph` shapes; first article-typed node with `datePublished` wins | Must |
| REQ-004 | Ubiquitous | `ConvertResult` shall carry a `publishedAt: Date | null` field populated by the structured extractor | `convert()` returns `publishedAt` set for the fixtures; type compiles | Must |
| REQ-005 | Ubiquitous | `fetchStatic`, `fetchBrowser`, and `fetchAdaptive` shall thread `publishedAt` through their result objects unchanged | A fetch result object exposes `publishedAt`; typecheck passes; existing fields unchanged | Must |
| REQ-006 | Ubiquitous | The system shall provide `resolvePublishedDate(raw, referenceDate)` that resolves relative and natural-language dates via chrono-node, falling back to `Date.parse`, returning `null` when neither yields a valid date | `resolvePublishedDate("4 hours ago", ref)` = ref−4h; `"2 days ago"` = ref−2d; ISO string round-trips; garbage → `null`; empty/null → `null` | Must |
| REQ-007 | Event-driven | When `extractPostFields` runs for a post detail page, the system shall set the post's date to the structured `publishedAt` if present, otherwise `resolvePublishedDate(llmString, now)` | Detail extraction for therundown.ai fixture yields `2026-05-25` (structured), not `2026-05-21` (LLM body text) | Must |
| REQ-008 | Event-driven | When `discoverPostUrls` returns listing posts, the system shall route each post's LLM `published_at` string through `resolvePublishedDate(raw, now)` so relative listing dates resolve | A listing post with `published_at: "3 days ago"` resolves to an absolute date in the built `RawItemInsert` | Must |
| REQ-009 | Event-driven | When `fetchWebPost` (add-post single-post) fetches a page, the system shall set `publishedAt` from the structured extractor instead of hardcoding `null` | `fetchWebPost` on the therundown.ai fixture returns `publishedAt = 2026-05-25`; on a page with no date signal returns `null` | Must |
| REQ-010 | Ubiquitous | The structured extractor shall run against the original DOM in both `article` and `listing` modes (before tag-stripping / Readability) | Listing-mode fixture with `<head>` JSON-LD still yields a structured `publishedAt` | Must |
| REQ-011 | Ubiquitous | `sortPostsByPublishedAtDesc` and `applySinceDays` shall parse dates via `resolvePublishedDate(raw, now)` rather than bare `Date.parse` so relative LLM strings sort/filter correctly | A post list mixing ISO and "2 days ago" sorts newest-first; `applySinceDays` keeps a "1 day ago" post and drops a "40 days ago" post when `sinceDays=7` | Should |

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|--------------|
| EDGE-001 | `<script type="application/ld+json">` contains malformed JSON | Skip that block silently, continue to next signal tier; no throw | REQ-003 |
| EDGE-002 | JSON-LD `datePublished` is a non-ISO string (e.g. `"May 25, 2026"`) | Run through `resolvePublishedDate`; if it parses, use it; else treat tier as absent and fall through | REQ-002, REQ-006 |
| EDGE-003 | `<time>` element has no `datetime` attribute (relative text only) | Skip the `<time>` tier; rely on JSON-LD/meta or LLM fallback | REQ-002 |
| EDGE-004 | Page has no structured date signal at all and LLM returns empty | `publishedAt` resolves to `null` (unchanged from today; no fabrication) | REQ-007, REQ-009 |
| EDGE-005 | LLM returns a relative string ("4 hrs ago") and there is no structured signal | `resolvePublishedDate` converts it to absolute relative to `now` | REQ-006, REQ-007 |
| EDGE-006 | Structured signal present AND LLM also returns a date | Structured signal wins | REQ-007 |
| EDGE-007 | Multiple JSON-LD article nodes, only the second has `datePublished` | First node *with* `datePublished` is selected | REQ-003 |
| EDGE-008 | `referenceDate` passed explicitly | Relative resolution is deterministic against that instant (no hidden `Date.now()`) | REQ-006 |
| EDGE-009 | chrono parses a date-only string with no time-of-day | Accept the date; time-of-day defaults are tolerated (the calendar date is the signal) | REQ-006 |
| EDGE-010 | `og:published_time` / `meta[itemprop=datePublished]` / `meta[name=parsely-pub-date]` present instead of `article:published_time` | Meta tier still matches via the alternate selectors | REQ-002 |

## Verification Matrix

| ID | Unit Test | Integration Test | E2E Test | Manual Test | Notes |
|----|-----------|------------------|----------|-------------|-------|
| REQ-001 | Yes | No | No | No | Fixtures captured from probe HTML (therundown.ai, llm-stats.com) |
| REQ-002 | Yes | No | No | No | One test per precedence tier |
| REQ-003 | Yes | No | No | No | object / array / @graph shapes |
| REQ-004 | Yes | No | No | No | `convert()` returns publishedAt |
| REQ-005 | Yes | No | No | No | typecheck + field-passthrough assertion |
| REQ-006 | Yes | No | No | No | mirrors VS-0 chrono probe matrix; fixed referenceDate |
| REQ-007 | Yes | No | No | No | detail-pass precedence (structured > LLM) |
| REQ-008 | Yes | No | No | No | listing-pass resolver routing |
| REQ-009 | Yes | No | No | No | fetchWebPost no longer hardcodes null |
| REQ-010 | Yes | No | No | No | listing-mode extraction on original DOM |
| REQ-011 | Yes | No | No | No | sort + applySinceDays via resolver |
| EDGE-001..010 | Yes | No | No | No | All edge cases unit-covered |

## Verification Scenarios (VS-0 — promoted from library-probe)

### VS-0-chrono-node-relative: Library probe — chrono-node relative + absolute parsing
**Type:** api
**Run:** `node .harness/web-collector-date-fix/probes/chrono-node/probe-relative.mjs`
**Expected:** exit 0; relative inputs ("4 hours ago", "2 days ago", "yesterday") resolve
correctly relative to the fixed reference `2026-05-26T12:00:00.000Z`; ISO input round-trips
exactly; garbage/empty → `null` with no throw.
**Note:** probe runs in an isolated `/tmp` dir requiring `npm install chrono-node@2.9.1`.
Once chrono-node is a pipeline dependency, functional-verify exercises the in-repo
`resolvePublishedDate` unit tests (REQ-006), which cover the same matrix against the
in-tree dependency — preferred over the isolated probe.

## Out of Scope

- **Re-prompting / changing the LLM model** for date extraction — the fix is at the DOM/parse layer, not the prompt.
- **Backfilling `published_at`** for already-collected `raw_items` rows — no historical migration.
- **Clamping future-dated publish dates** — if a page reports a future date, it is accepted as-is.
- **Per-post structured dates in the listing pass** — the listing HTML does not generally expose individually-addressable per-post structured dates; the listing pass keeps LLM discovery and only adds resolver normalization. Precise structured dates come from the per-post detail pass.
- **Date extraction for non-web collectors** (HN/Reddit/Twitter/web-search) — they already have reliable source-provided timestamps and are untouched.
- **Timezone normalization of date-only inputs** — chrono's default time-of-day for date-only strings is tolerated; only the calendar date is relied upon.
- **Storing the date source/provenance** (which signal won) — not persisted.
