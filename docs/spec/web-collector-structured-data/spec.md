# SPEC: Web Collector — Surface Structured Data (JSON-LD + Next.js) to Discovery LLM

**Source:** docs/spec/web-collector-structured-data/design.md
**Generated:** 2026-05-26

## Requirements

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|---------------------|----------|
| REQ-001 | Event-driven | When `convert()` runs in `listing` mode, the system shall extract the raw text of every `<script type="application/ld+json">` block from the original HTML before `<script>` tags are stripped. | For HTML with N `ld+json` blocks, the extracted output contains the verbatim text of all N blocks. | Must |
| REQ-002 | Event-driven | When `convert()` runs in `listing` mode, the system shall extract the raw text of every Next.js data script — `self.__next_f.push(...)` scripts and `__NEXT_DATA__` — from the original HTML before `<script>` tags are stripped. | For HTML containing `self.__next_f.push` and/or `__NEXT_DATA__` scripts, their verbatim contents appear in the extracted output. | Must |
| REQ-003 | Ubiquitous | The system shall return the concatenated structured-data text as a nullable `ConvertResult.structuredData` field without parsing, schema-walking, or fragment-unwrapping the JSON. | `ConvertResult.structuredData` is a `string` containing the joined blob text, or `null`; no JSON is parsed into typed objects in `convert.ts`. | Must |
| REQ-004 | Event-driven | When a listing page contains no JSON-LD and no Next.js data scripts, the system shall set `ConvertResult.structuredData` to `null`. | For HTML with zero `ld+json`/`__next_f`/`__NEXT_DATA__` scripts, `structuredData === null`. | Must |
| REQ-005 | Event-driven | When `discoverPostUrls` builds the discovery prompt and `structuredData` is non-null, the system shall append it to the listing markdown inside a delimited `STRUCTURED DATA` section after the markdown. | The prompt body contains the markdown followed by a recognizable structured-data delimiter and the blob text, in that order. | Must |
| REQ-006 | Ubiquitous | The system shall truncate the combined discovery prompt body (markdown + structured data) to a single combined character cap before sending it to the LLM. | A combined body longer than `COMBINED_DISCOVERY_CAP` is sliced to exactly `COMBINED_DISCOVERY_CAP` characters; markdown content is preserved (appended first). | Must |
| REQ-007 | Event-driven | When `structuredData` is `null`, the system shall send the discovery prompt unchanged from the current markdown-only behavior. | With `structuredData === null`, the prompt body equals the listing markdown (capped); no `STRUCTURED DATA` section is present. | Must |
| REQ-008 | Ubiquitous | The system shall accept discovered post URLs without requiring the URL to be a literal substring of the listing markdown. | `validateDiscoveredUrls` no longer performs a `listingMarkdown.includes(url)` check; a URL present only in the structured blobs is retained. | Must |
| REQ-009 | Ubiquitous | The system shall reject a discovered URL that is empty, fragment-only (starts with `#`), non-parseable, or not `http(s)`. | Empty/`#`-prefixed/unparseable/non-http(s) URLs are dropped by `validateDiscoveredUrls`; valid `http(s)` URLs are retained and resolved to absolute form. | Must |
| REQ-010 | Event-driven | When a discovered item's URL — after stripping the `#fragment` — resolves to the listing URL itself, the system shall skip the Pass-2 detail fetch for that item. | No `detail` `CrawlJob` is enqueued for such an item; no detail fetch is attempted. | Must |
| REQ-011 | Event-driven | When the Pass-2 detail fetch is skipped under REQ-010, the system shall build the `RawItem` from the discovery LLM's `title` and `published_at`, keeping the full verbatim (`#item-…`) URL as `url` and `externalId`. | The stored item's `title`/`publishedAt` come from discovery fields; `url === externalId ===` the full fragment URL. | Must |

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|-------------|
| EDGE-001 | Listing HTML has JSON-LD blocks that are only page metadata (`WebPage`, `BreadcrumbList`) and no item list (e.g. therundown.ai landing). | Blobs are appended verbatim; the discovery LLM finds no extra posts in them; no manual filtering is applied. | REQ-001, REQ-003 |
| EDGE-002 | Combined body (markdown + structured data) exceeds `COMBINED_DISCOVERY_CAP`. | Combined string is truncated at the cap; markdown (appended first) is preserved even if the trailing structured blob is clipped mid-JSON. | REQ-006 |
| EDGE-003 | Discovery LLM returns a hallucinated URL not present in markdown or structured data. | URL passes validation (substring gate removed) but fails/404s in Pass-2 detail fetch, is logged as `detail_failed`, and no item is stored. | REQ-008 |
| EDGE-004 | A blog listing page has zero structured data and a normal anchor list. | `structuredData === null`, prompt is byte-for-byte the current markdown-only behavior, items discovered exactly as today (no regression). | REQ-004, REQ-007 |
| EDGE-005 | llm-stats `#item-https://techmeme.com/…` URL where the pre-fragment part equals the listing URL. | Pass-2 skipped; item built from discovery title + date; full `#item-…` string retained as `externalId` so each item dedups distinctly despite sharing a pre-fragment base. | REQ-010, REQ-011 |
| EDGE-006 | Both JSON-LD and `__next_f` describe the same news item (duplicate across blobs / across markdown). | Existing per-URL dedup (`findExistingExternalIds` + cap) and the single deduped discovery list collapse duplicates to one item. | REQ-005 |
| EDGE-007 | Page uses older `__NEXT_DATA__` rather than streaming `self.__next_f`. | Both selectors are matched defensively; `__NEXT_DATA__` content is included in the extracted blob text. | REQ-002 |
| EDGE-008 | A discovered item URL has a `#fragment` but the pre-fragment part is a real external article (not the listing URL). | REQ-010 does NOT trigger (pre-fragment ≠ listing URL); normal Pass-2 detail fetch proceeds against the URL. | REQ-010 |

## Verification Matrix

| REQ ID | Unit Test | Integration Test | E2E Test | Manual Test | Notes |
|--------|-----------|-----------------|----------|-------------|-------|
| REQ-001 | Yes | No | No | No | Fixture HTML with multiple `ld+json` blocks → assert all present in `structuredData`. |
| REQ-002 | Yes | No | No | No | Fixture HTML with `self.__next_f.push` + `__NEXT_DATA__` → assert contents present. |
| REQ-003 | Yes | No | No | No | Assert `structuredData` type is `string|null`; no parse occurs (joined text matches input). |
| REQ-004 | Yes | No | No | No | Plain HTML, no structured scripts → `structuredData === null`. |
| REQ-005 | Yes | No | No | No | Assert prompt body contains markdown then delimiter then blob (order + delimiter). |
| REQ-006 | Yes | No | No | No | Oversized combined body → length === cap, markdown prefix intact. |
| REQ-007 | Yes | No | No | No | `structuredData === null` → prompt body === capped markdown, no delimiter. |
| REQ-008 | Yes | No | No | No | URL only in structured blob (absent from markdown) is retained. |
| REQ-009 | Yes | No | No | No | Matrix of empty/`#`/unparseable/non-http(s)/valid URLs through `validateDiscoveredUrls`. |
| REQ-010 | Yes | No | No | No | `#item-…` URL whose pre-fragment == listing URL → no detail job enqueued. |
| REQ-011 | Yes | No | No | No | Skipped-Pass-2 item built from discovery fields; `url === externalId === full URL`. |
| EDGE-001 | Yes | No | No | No | therundown-style metadata-only JSON-LD fixture → no extra posts, no crash. |
| EDGE-002 | Yes | No | No | No | Truncation boundary test. |
| EDGE-003 | Yes | No | No | No | Hallucinated URL → validation passes, Pass-2 failure path logged, not stored. |
| EDGE-004 | Yes | No | No | No | No-structured-data regression test (current behavior preserved). |
| EDGE-005 | Yes | Yes | No | Yes | Unit on the resolve-to-listing helper; integration on `collectWeb` with an llm-stats fixture; manual dry-run against live llm-stats/ai-news to confirm the "Today" items are captured. |
| EDGE-006 | Yes | No | No | No | Duplicate-across-blobs dedup test. |
| EDGE-007 | Yes | No | No | No | `__NEXT_DATA__`-only fixture. |
| EDGE-008 | Yes | No | No | No | External-article-with-fragment → normal Pass-2 proceeds. |

## Verification Scenarios

_None folded in — no `library-probe.md` / `verification-stubs.md` (pure-internal feature, no external dependencies)._

Manual verification (post-merge, mirrors the original report): run the pipeline in dry-run
with the web collector configured to `https://llm-stats.com/ai-news` and confirm the
"Today" news items (the `NewsArticle` JSON-LD entries) are captured, not just the outbound
arxiv research links.

## Out of Scope

- **Manual/typed parsing of JSON-LD or Next.js payloads** — we hand raw blobs to the LLM; no `NewsArticle`/`ItemList` schema walking, no `#item-` URL unwrapping in our code.
- **Forcing browser rendering for aggregators** — confirmed the hydrated DOM still lacks the news anchors; render mode is unchanged.
- **Per-source caps or per-source extraction logic** — a single combined cap, applied uniformly; no source-specific branching.
- **Changing the Pass-2 detail extraction (`extractPostFields`) prompt or schema** — unchanged.
- **Backfilling or re-collecting historically missed items** — forward-only fix.
- **The publish-date extraction shipped in PR #208** (`extractPublishedAt` / `resolvePublishedDate`) — intact and unmodified.
- **Unwrapping the embedded source URL to fetch the real article** — explicitly chosen against; verbatim URL + Pass-2 skip is the agreed behavior.
