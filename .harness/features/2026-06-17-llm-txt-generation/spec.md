# SPEC: llm.txt / llms.txt Generation

Derived from `design.md`. EARS-style acceptance criteria.

## Inputs / data shapes (real, from codebase)

- `RankedItem` (`@newsletter/shared` `types/run.ts`): `{ title, url, sourceType, author,
  publishedAt, score, rationale, recap: RecapContent | null, enrichedSource, ... }`.
- `RecapContent`: `{ title, summary, bullets: string[], bottomLine }`.
- `PublicMustReadEntry`: `{ id, url, title, author, year, annotation, addedAt }`.
- `ArchiveListItem`: `{ runId, runDate, storyCount, topItems, digestHeadline, digestSummary, ... }`.
- Issue meta for rendering: `{ runId, issueDate, digestHeadline, digestSummary }`.
- Base URL: `webBaseUrl` from `resolveBaseUrls(env)`.

## Functional Requirements

**REQ-1 (shared generator — issue).** The system SHALL provide a pure function
`renderIssueLlmTxt(issue, stories, opts)` that returns a string with: an H1 of the issue headline
(or a default), a `>` blockquote of the digest summary, an issue date line, and one `##` section
per story containing the story title as a link to its URL, the recap summary, bullet lines, and the
bottom line when present.

**REQ-2 (shared generator — index).** The system SHALL provide `renderIndexLlmsTxt(site, sections)`
returning an llmstxt.org-structured document: H1 site title, `>` site summary, then `##` sections.
Sections SHALL include **Issues** (recent published issues, each `[<date> — <headline>](<abs url>)`),
**Canon** (must-read entries as `[<title>](<url>): <annotation>`), **How we build** (link to the
built page), and **Pages** (Archive, Sources, etc.). All internal links SHALL be absolute (prefixed
with `webBaseUrl`).

**REQ-3 (shared generator — full index).** The system SHALL provide `renderIndexLlmsFullTxt(...)`
that produces the index AND inlines each listed issue's full rendered content (REQ-1 output) under
its section.

**REQ-4 (canon render).** The system SHALL provide `renderCanonLlmTxt(entries, opts)` returning the
must-read list as an llm.txt document (H1 "Canon", one `-` link line per entry with annotation).

**REQ-5 (URL absolutization).** WHEN a relative site path (e.g. `/archive/<id>`) is rendered, the
generator SHALL prefix it with the configured `webBaseUrl`, with no double slashes.

**REQ-6 (empty states).** WHEN there are no published issues, `renderIndexLlmsTxt` SHALL still
return a valid document with the static sections and an Issues section noting none are available
yet (no crash, no empty `##`).

**REQ-7 (API — index endpoint).** The system SHALL expose `GET /llms.txt` (public, no admin gate)
returning `200` with `Content-Type: text/plain; charset=utf-8` and the index document built from
the latest published issues + canon + static pages.

**REQ-8 (API — full index).** The system SHALL expose `GET /llms-full.txt` (public) returning the
full-content index.

**REQ-9 (API — per-issue).** The system SHALL expose `GET /api/archives/:runId/llm.txt` (public)
returning the issue's rendered llm.txt for a reviewed run. WHEN the run is missing or not reviewed,
it SHALL return `404` with `text/plain` body.

**REQ-10 (caching header).** Each text endpoint SHALL set `Cache-Control: public, max-age=3600`.

**REQ-11 (materialization script).** The system SHALL provide a script (npm script
`generate:llm-txt`) that fetches published issues + canon from the DB and writes:
`llms/llms.txt`, `llms/llms-full.txt`, `llms/canon.llm.txt`, and `llms/issues/<date>-<runId>.llm.txt`
per published issue, using the SAME shared generator the endpoints use.

**REQ-12 (no-drift guarantee).** The materialized file content for the index SHALL be byte-identical
to the `GET /llms.txt` response body for the same DB state (enforced by a test asserting both call
the shared generator with the same inputs / by comparing outputs).

**REQ-13 (repository discipline).** The generator SHALL NOT import `drizzle-orm` or
`@newsletter/shared/db`. The API endpoints and script SHALL obtain data via existing repository
factories only.

## Non-Functional

- TypeScript strict; type hints on all functions.
- Pure generator functions: no I/O, no `Date.now()` inside (caller passes timestamps/dates).
- No new external dependencies.

## Verification Scenarios

- **VS-1:** Unit — `renderIssueLlmTxt` with 2 stories → contains H1 headline, `>` summary, both
  story links, bullets, bottom line.
- **VS-2:** Unit — `renderIndexLlmsTxt` with 1 issue + 2 canon entries + static pages → contains
  Issues/Canon/How-we-build/Pages sections, all links absolute.
- **VS-3:** Unit — empty issues → valid doc, Issues section present with "none yet" note.
- **VS-4:** Unit — relative path `/archive/x` → `https://host/archive/x` (no `//`).
- **VS-5:** API — `GET /llms.txt` → 200, `text/plain; charset=utf-8`, `Cache-Control` set, body
  starts with `# `.
- **VS-6:** API — `GET /api/archives/:runId/llm.txt` for reviewed run → 200 text with the digest;
  for unreviewed/missing → 404.
- **VS-7:** API — `GET /llms-full.txt` → 200, inlines issue content (story titles appear).
- **VS-8:** Script/no-drift — generator output used by the script equals the endpoint's body for the
  same inputs (compare strings).
