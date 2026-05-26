# Web Collector Date Extraction & Relative-Date Resolution — Design

## Problem Statement

The web (blog) collector and the single-post add-post web fetcher extract publish
dates by feeding Readability-cleaned markdown to an LLM and asking it to read the
date off the rendered text. This fails in two concrete, reproducible ways:

1. **Date extraction fails / returns the wrong date** when the page exposes its
   publish date only in structured metadata (JSON-LD `datePublished`,
   `<meta property="article:published_time">`, `<time datetime>`) — which
   Readability strips before the markdown reaches the LLM.
2. **Relative dates are not resolved.** Pages that render "4 hrs ago" / "2 days ago"
   as visible text are not reliably normalized to absolute timestamps.

The user wants the web collector to **capture** the date from these pages and
**resolve** relative dates to absolute timestamps.

## Context

The web blog collector (`packages/pipeline/src/collectors/web.ts`) runs a two-pass
flow: `discoverPostUrls` (listing → post entries with `published_at`) and
`extractPostFields` (post markdown → title/author/`published_at`/image). Both rely
entirely on Claude Haiku reading the markdown produced by
`services/web-fetch/convert.ts`, which uses `@mozilla/readability` (article mode)
or a tag-stripped body (listing mode) then Turndown → markdown. `parseDateOrNull`
(`Date.parse`) then converts the LLM string to a `Date`, silently yielding `null`
for anything `Date.parse` can't handle (including all relative formats).

`fetchWebPost` (the add-post single-post fetcher) does not even attempt date
extraction — it hardcodes `publishedAt: null`.

The publish date lands in `raw_items.published_at` (nullable timestamp) and feeds
`sortPostsByPublishedAtDesc` and `applySinceDays` (recency filtering).

### Probe evidence (validated against the user's two test URLs)

Probes in `.harness/web-collector-date-fix/probes/` confirm the root cause:

- **`therundown.ai/p/google-tops-...`** — the true publish date
  `2026-05-25T09:00:00Z` exists **only** in a JSON-LD `Article.datePublished`
  block. There is no `<time>` element and no `article:published_time` meta. After
  Readability article-mode conversion, the **only** date-like string left in the
  markdown is `2026-05-21` — a *body-text* date ("Last week…"), not the publish
  date. So the LLM today returns either nothing or the wrong date. This is the
  "extraction fails" bug, and worse, it can silently produce a wrong date.
- **`llm-stats.com/ai-news`** — per-article publish times exist as absolute ISO
  timestamps in JSON-LD `NewsArticle.datePublished` nodes **and** as
  `<time datetime="2026-05-19">` elements. The page renders "N hrs ago" labels
  client-side, but the machine-readable absolute timestamps are right there in the
  static HTML. The current pipeline ignores them and feeds only the rendered text.

**Key takeaway:** structured-signal extraction alone fixes *both* reported test
cases. A relative-date parser is the residual fallback for pages that genuinely
expose only relative text in their HTML.

## Requirements

### Functional Requirements

1. During HTML→markdown conversion, extract the publish date from structured
   signals in this precedence order, returning the first valid absolute date:
   1. JSON-LD `datePublished` (on `Article`/`NewsArticle`/`BlogPosting`, including
      `@graph` arrays and arrays of nodes).
   2. `<meta property="article:published_time">` (and `name=` variant), plus the
      common alternates (`og:published_time`, `meta[itemprop=datePublished]`,
      `meta[name=date]`, `meta[name=parsely-pub-date]`).
   3. `<time datetime="…">` (first element carrying a parseable `datetime`).
2. Surface the extracted structured date through `ConvertResult` (new
   `publishedAt: Date | null` field) so both `fetchAdaptive` consumers
   (collector + add-post) can read it.
3. Resolve relative dates ("N seconds/minutes/hours/days/weeks/months/years ago",
   "yesterday", "today") to absolute timestamps using `chrono-node`.
4. **Precedence at the collector layer:** structured date (from #1) wins; when no
   structured date exists, fall back to the LLM string, parsed first by
   `chrono-node` (handles relative + many absolute formats) then `Date.parse`.
5. Apply the same extraction to all three web date paths:
   - `discoverPostUrls` listing pass (best-effort per discovered post),
   - `extractPostFields` per-post detail pass,
   - `fetchWebPost` add-post single-post fetcher (replace the hardcoded `null`).
6. `published_at` in `raw_items` reflects the resolved absolute timestamp.

### Non-Functional Requirements

- **No behavior regression** for pages that already worked: when a structured
  signal is absent the LLM path still runs; when present it overrides only with a
  *valid* parsed date.
- **Boundary-only validation:** structured-signal parsing is parsing of external
  scraper output — validate there, trust internal callers (project rule).
- **Deterministic + unit-testable:** the extractor and the relative-date resolver
  are pure functions tested against fixed HTML fixtures and a fixed "now".
- **Lightweight:** `chrono-node` is MIT, zero runtime deps, ships its own types.
- **Logging:** no new noisy logs inside loops; the existing collector boundary
  logging is sufficient.

### Edge Cases and Boundary Conditions

- JSON-LD that is an array, an `@graph`, or a single object; multiple article
  nodes (pick the first with `datePublished`).
- Malformed / unparseable JSON-LD `<script>` → skip silently, fall through.
- `datePublished` present but not ISO (e.g. `"May 25, 2026"`) → run through
  `chrono`/`Date.parse`; if still unparseable, treat as absent.
- Future-dated relative text or `datePublished` → accept as-is (do not clamp; out
  of scope).
- `<time>` with no `datetime` attribute or with relative text only → skip; rely on
  meta/JSON-LD or LLM fallback.
- `chrono-node` parsing relative dates needs a **reference instant** (now). Pass an
  explicit `referenceDate` so tests are deterministic and the resolution is
  relative to collection time.
- Listing mode currently strips `<script>`/`<nav>`/`<footer>`/`<aside>` but NOT
  `<head>` JSON-LD — extraction must run against the *original* DOM before
  stripping (same pattern already used for `extractImageUrl`).
- Empty / missing date everywhere → `null` (unchanged from today; no fabrication).

## Key Insights

- The bug is **not** an LLM-prompt problem — the date is *physically removed* from
  the LLM's input by Readability. No prompt tweak can recover a date that isn't in
  the text. The fix must run at the HTML/DOM layer, before Readability.
- The same `convert.ts` already extracts `og:image` from the original DOM before
  Readability mutates it — structured date extraction is the exact same pattern and
  slots in cleanly next to `extractImageUrl`.
- Structured-signal extraction is higher-precision than the LLM (machine-readable,
  unambiguous) and fixes both reported cases; relative parsing is a smaller,
  secondary safety net.

## Architectural Challenges

- **Where extraction lives:** in `convert.ts`, against the original parsed DOM,
  returned on `ConvertResult.publishedAt`. This keeps a single fetch/parse pass and
  avoids re-fetching or re-parsing HTML in the collector.
- **Threading the value out:** `ConvertResult` → `fetchStatic`/`fetchBrowser`/
  `fetchAdaptive` results must carry `publishedAt`. This is an additive,
  backward-compatible field.
- **Precedence composition:** a small helper at the collector layer chooses
  structured-date → chrono(LLM string) → `Date.parse(LLM string)` → null. This
  replaces the bare `parseDateOrNull` call sites.
- **Listing-pass plumbing:** the listing pass only has one markdown blob for the
  whole page, so per-post structured dates aren't individually addressable from the
  listing HTML in general. The listing pass keeps LLM discovery for per-post dates
  but routes the LLM string through the new resolver (so "3 days ago" in a listing
  resolves). The per-post detail pass gets the precise structured date.

## Approaches Considered

### Approach A: DOM-layer structured extraction in `convert.ts` + chrono resolver (chosen)
Extract date from JSON-LD/meta/`<time>` against the original DOM, return on
`ConvertResult`, and add a `chrono-node`-backed resolver for relative/LLM strings.
Collector precedence: structured wins, resolver is fallback.
- **Addresses:** both test cases (structured) + relative text (chrono).
- **Trade-offs:** adds one dependency and one `ConvertResult` field. Minimal blast
  radius — additive.
- **Risk:** low; isolated to convert + collector, fully unit-testable with fixtures.

### Approach B: Improve the LLM prompt only
Tell the LLM more forcefully to compute relative dates and find the date.
- **Rejected:** cannot work for therundown.ai — the date is not in the LLM input at
  all. Also non-deterministic and already the failing status quo.

### Approach C: Add a dedicated post-fetch "date enrichment" pass
A separate service that re-fetches the URL and parses dates independently.
- **Rejected:** duplicate fetch + parse, more moving parts, no benefit over doing it
  inline in the existing single parse pass.

## Chosen Approach

**Approach A.** Add structured publish-date extraction to `convert.ts` (run on the
original DOM, like `extractImageUrl`), expose it as `ConvertResult.publishedAt`,
thread it through the fetch results, and add a `chrono-node`-backed
`resolvePublishedDate(raw, referenceDate)` resolver. At each web date call site the
precedence is **structured DOM date → resolver(LLM string) → null**. Wire
`fetchWebPost` to set `publishedAt` from the structured date (fixing the hardcoded
`null`).

## High-Level Design

```
fetchAdaptive(url, mode)                     [services/web-fetch]
  └─ fetchStatic/fetchBrowser → HTML
       └─ convert({html, baseUrl, mode})     [convert.ts]
            ├─ extractImageUrl(originalDoc)          (existing)
            ├─ extractPublishedAt(originalDoc)  ←──  NEW
            │     1. JSON-LD datePublished
            │     2. meta article:published_time / alternates
            │     3. <time datetime>
            └─ Readability → markdown
       returns ConvertResult { markdown, title, byline, imageUrl,
                               textLength, publishedAt }   ← NEW field

collectors/web.ts
  resolvePublishedDate(raw, refDate)  ←── NEW (chrono-node → Date.parse → null)
  discoverPostUrls / extractPostFields / fetchWebPost:
     date = structuredPublishedAt ?? resolvePublishedDate(llmString, now)
  → RawItemInsert.publishedAt
```

- **New pure functions** (unit-tested): `extractPublishedAt(doc): Date | null` in
  `convert.ts` (or a small `published-date.ts` helper imported by `convert.ts`);
  `resolvePublishedDate(raw: string | null | undefined, referenceDate: Date): Date | null`.
- **`ConvertResult`** (in `web-fetch/types.ts`) gains `publishedAt: Date | null`.
  `fetchStatic`, `fetchBrowser`, `fetchAdaptive` pass it through.
- **Collector wiring:** the structured date from the detail fetch overrides the LLM
  date; the listing pass routes its per-post LLM strings through `resolvePublishedDate`.

## External Dependencies & Fallback Chain

### Primary: chrono-node
- **Purpose:** parse relative ("4 hrs ago", "2 days ago", "yesterday") and varied
  absolute natural-language dates from LLM-extracted/visible strings into a `Date`,
  relative to an explicit reference instant.
- **Use cases to probe:**
  1. Relative past: `"4 hours ago"`, `"2 days ago"`, `"3 weeks ago"` → absolute Date
     relative to a fixed `referenceDate`.
  2. Natural absolute: `"May 25, 2026"`, `"25 May 2026"` → correct Date.
  3. Already-ISO passthrough: `"2026-05-25T09:00:00.000Z"` → same instant.
  4. Garbage / empty → `null` (no throw).
- **Maturity:** v2.9.1, MIT license, **zero runtime dependencies**, ships its own
  TypeScript types (`dist/esm/index.d.ts`), latest published 2026-05-06 (actively
  maintained). No bad signals.
- **Auth:** none.
- **Required env keys:** none.

### Fallbacks (in order)
1. **`date-fns` / `dayjs` custom parser** — parse a fixed set of relative patterns
   with a hand-written regex + arithmetic; both libs are well-maintained but require
   us to write the relative-grammar matching ourselves.
2. **Hand-rolled internal relative-date parser** — a ~30-line pure function over
   `/(\d+)\s*(sec|min|hour|hr|day|week|month|year)s?\s+ago/i` plus
   `yesterday`/`today`, no dependency. (This is the build-our-own landing option.)

Note: structured-signal extraction (the primary fix for both reported URLs) uses
the **already-present `jsdom`** — no new dependency and not gated on chrono.

## Open Questions

- Should `applySinceDays` / `sortPostsByPublishedAtDesc` also route through
  `resolvePublishedDate` instead of bare `Date.parse`? (Likely yes for consistency,
  since the LLM may still hand back a relative string in the listing pass.) Decide
  during planning.

## Risks and Mitigations

- **Risk:** JSON-LD shapes vary wildly across sites. **Mitigation:** handle object /
  array / `@graph`; skip unparseable blocks; fixture tests for therundown.ai and
  llm-stats.com shapes captured by the probes.
- **Risk:** chrono mis-parses an ambiguous body-text date as the publish date.
  **Mitigation:** structured signal always wins; chrono only runs on the LLM string
  when no structured signal exists — same exposure as today, strictly better.
- **Risk:** browser-mode (`fetchBrowser`) returns post-JS HTML where structured
  tags may differ. **Mitigation:** extraction runs on whatever HTML the fetch
  returns; both static and browser paths thread the field through identically.

## Assumptions

- The structured signals observed in the probes are representative of the failing
  sites; extraction precedence (JSON-LD → meta → `<time>`) covers the common cases.
- Collection time is an acceptable reference instant for resolving relative dates
  ("4 hrs ago" means 4 hrs before we fetched), matching user intent.
- `published_at` remaining `null` when no date is discoverable is acceptable
  (unchanged behavior; no fabrication).
