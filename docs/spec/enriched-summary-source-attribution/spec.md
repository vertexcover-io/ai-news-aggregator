# SPEC: Enriched-link summary priority + accurate source attribution

**Spec name:** `enriched-summary-source-attribution`
**Branch:** `feat/enriched-summary-source-attribution`
**Source design:** [`design.md`](./design.md)
**Library probe:** [`library-probe.md`](./library-probe.md) → `NOT_APPLICABLE`

## Resolved Decisions

| ID | Open question (from design) | Resolution |
|---|---|---|
| OQ-1 | Apply `ENRICHED_SUMMARY_LAUNCHED_AT` launch-date gate for legacy archives? | **YES.** Mirror `COST_TRACKING_LAUNCHED_AT` pattern. Hydrators omit `enrichedSource` (force `null`) for archives whose `completedAt < ENRICHED_SUMMARY_LAUNCHED_AT`. Legacy chips render with the existing platform label unchanged. Constant value: the UTC ISO timestamp at merge time (placeholder `"2026-05-25T00:00:00Z"`, finalised at merge). |
| OQ-2 | Strip more than `www.` from hostnames? | **NO.** Just leading `www.`, lowercased. Defer broader stripping until a real complaint surfaces. |
| OQ-3 | Tell rerank LLM which source the content came from? | **OUT OF SCOPE.** Belongs to a future rerank-prompt-iteration spec. |

## Functional Requirements (EARS)

### Picker priority

- **REQ-001** WHEN `pickCandidateContent` is invoked with a non-null `metadata.enrichedLink` whose `status === "ok"` and whose `markdown` is a string of length ≥ 1, the function SHALL return that `markdown` value, regardless of whether `content` is non-empty.
- **REQ-002** WHEN `enrichedLink` is absent, `status !== "ok"`, or `markdown` is empty/missing, AND `content` is a non-empty string, `pickCandidateContent` SHALL return `content`.
- **REQ-003** WHEN neither enriched markdown nor content is available, `pickCandidateContent` SHALL return `null`.
- **REQ-004** The picker logic SHALL be implemented in a single shared helper `pickSummarySource(content, enrichedLink)` exported from `@newsletter/shared/services/summary-source`. `pickCandidateContent` SHALL delegate to this helper.

### Eval-path parity

- **REQ-005** `packages/pipeline/src/eval/replay.ts` SHALL call `pickCandidateContent` (or the underlying `pickSummarySource`) — never inline its own picker logic — so that eval-replay output equals live picker output for every fixture row.

### Add-post flow parity

- **REQ-006** `packages/pipeline/src/services/add-post-helper.ts::hydrateAddedPost` SHALL route the saved raw item through `pickCandidateContent` (or `pickSummarySource`) before passing body text to `generateRecap`. Both call sites identified in `add-post-helper.ts` (currently passing `row.content` / `saved.content` directly) SHALL be updated.

### Self-post invariance (regression guard)

- **REQ-007** FOR an HN Ask/Show item whose `url === sourceUrl` AND whose `content` is the non-empty selftext, the picker SHALL return the selftext (because no enrichment occurs). Test: construct such a fixture, assert the picker output equals the selftext.
- **REQ-008** FOR a Reddit self-post whose `url === sourceUrl` AND whose `content` is the non-empty `.md` selftext, the picker SHALL return the selftext. Test: same shape, Reddit `sourceType`.
- **REQ-009** FOR a Twitter tweet with no outgoing URL (`url === sourceUrl` OR enrichment skipped with `skipReason="no-url"`/`"same-platform"`), the picker SHALL return the tweet text.

### Hostname derivation

- **REQ-010** A pure function `deriveHostname(url: string): string | null` SHALL be exported from `@newsletter/shared/services/summary-source`. It SHALL: (a) parse `url` via the WHATWG `URL` global, returning `null` on parse failure; (b) lowercase the hostname; (c) strip a leading `"www."` if present; (d) return the resulting string. Examples: `https://www.theverge.com/2026/...` → `"theverge.com"`; `https://arxiv.org/abs/2401.0001` → `"arxiv.org"`; `not a url` → `null`.

### Summary-source classification

- **REQ-011** `pickSummarySource(content, enrichedLink)` SHALL return one of three discriminated-union variants:
  - `{ kind: "enriched", hostname: string, url: string, markdown: string }` — when `enrichedLink.status === "ok"`, `markdown` is non-empty, AND `deriveHostname(enrichedLink.url)` is non-null.
  - `{ kind: "native", content: string }` — when the above does not hold AND `content` is a non-empty string.
  - `{ kind: "none" }` — otherwise.
- **REQ-012** A malformed `enrichedLink.url` (where `deriveHostname` returns `null`) SHALL be treated as `kind: "native"` (with content fallback) or `kind: "none"`, never as `kind: "enriched"`. Test: pass `enrichedLink = { status: "ok", url: "::::not-a-url", markdown: "x" }` → expect `kind: "native"` or `"none"`, never enriched.

### Hydrator extension — RankedItem

- **REQ-013** The `RankedItem` interface in `packages/shared/src/types/run.ts` SHALL gain a field `enrichedSource: { hostname: string; url: string } | null` (non-optional, nullable).
- **REQ-014** `packages/api/src/services/rank-hydration.ts::hydrateRankedItems` SHALL populate `enrichedSource` on each hydrated item by calling `pickSummarySource(row.content, row.metadata.enrichedLink)`. Mapping: `kind: "enriched"` → `{ hostname, url }`; otherwise `null`.
- **REQ-015 (launch-date gate)** `hydrateRankedItems` SHALL accept an optional `archiveCompletedAt: Date | null` argument. WHEN `archiveCompletedAt !== null` AND `archiveCompletedAt < ENRICHED_SUMMARY_LAUNCHED_AT`, the hydrator SHALL set `enrichedSource = null` for every item in the result, regardless of what `pickSummarySource` returns. Both archive route handlers in `packages/api/src/routes/archives.ts` SHALL pass `archive.completedAt` to the hydrator. (Live `/run` routes pass `null` → no gating, current behaviour.)

### Hydrator extension — NewsletterStory

- **REQ-016** The `NewsletterStory` interface SHALL gain three new fields (added in BOTH `packages/pipeline/src/workers/email-send.ts` AND its mirror in `packages/api/src/lib/email/templates/newsletter.tsx`):
  - `sourceLabel: string` — platform label (e.g. `"Hacker News"`) when `enrichedSource === null`, hostname (e.g. `"theverge.com"`) otherwise.
  - `sourceUrl: string` — `item.url` (platform thread) when `enrichedSource === null`, `enrichedSource.url` otherwise.
  - `readVerb: string` — `"Read source"` / `"Read repo"` (per existing `readVerb()` for GitHub) when `enrichedSource === null`, `"Read on <hostname>"` otherwise.
- **REQ-017** `email-send.ts::hydrateItems` SHALL populate these three fields. It SHALL apply the same launch-date gate as REQ-015: items in archives whose `completedAt < ENRICHED_SUMMARY_LAUNCHED_AT` get `enrichedSource = null` semantics (platform label, `item.url`, "Read source").
- **REQ-018** The platform-label map (currently inlined in `ArchiveStoryCard.tsx`'s `SOURCE_LABEL` const) SHALL be extracted to a shared helper `getPlatformLabel(sourceType): string` co-located with `pickSummarySource` so the email template can import the same map. The exhaustive `Record<SourceType, string>` SHALL preserve every existing label verbatim: `hn` → `"Hacker News"`, `reddit` → `"Reddit"`, `rss` → `"RSS"`, `blog` → `"Blog"`, `twitter` → `"X / Twitter"`, `github` → `"GitHub"`, `newsletter` → `"Newsletter"`, `web_search` → `"Web Search"`.

### UI rendering — archive

- **REQ-019** `packages/web/src/components/ArchiveStoryCard.tsx` SHALL render the source chip as follows: `<span>{sourceLabel}</span> · <a href={sourceUrl}>{readVerb} ↗</a>` where `sourceLabel` / `sourceUrl` / `readVerb` are derived from `item.enrichedSource` (non-null → hostname + enriched URL + `"Read on <hostname>"`; null → existing platform label + `item.url` + existing `readVerb`).
- **REQ-020** The existing `SOURCE_LABEL` const in `ArchiveStoryCard.tsx` SHALL be removed in favour of importing `getPlatformLabel` from `@newsletter/shared/services/summary-source` (REQ-018). The existing inline `readVerb` function SHALL be removed in favour of derived chip data computed at the top of the component.

### UI rendering — email

- **REQ-021** `packages/api/src/lib/email/templates/newsletter.tsx::NewsletterEmail` SHALL render a new chip section at the bottom of each story (above the `<Hr />` separator), matching the archive's typography (small monospace, uppercase, letter-spaced, neutral grey) but using only React Email primitives (`<Text>`, `<Link>`). The chip content SHALL be: `{sourceLabel} · <Link href={sourceUrl}>{readVerb} ↗</Link>`.

### Backwards compatibility

- **REQ-022** All `RankedItem` consumers OTHER than `ArchiveStoryCard.tsx` and the email template SHALL continue to compile without modification. The new `enrichedSource` field is additive.
- **REQ-023** The `enrichedSource` field SHALL be omitted from the JSON serialisation of any route that does not consume it (no special suppression needed — additive field is harmless on the wire). Public archive routes already expose `RankedItem` via JSON; this is acceptable because `enrichedSource` contains only hostname + URL (already serialised as `item.url` for native items).

## Non-functional Requirements

- **REQ-024** `pnpm typecheck` SHALL pass for all four affected packages (`shared`, `pipeline`, `api`, `web`).
- **REQ-025** `pnpm lint` SHALL pass with zero new errors. Pre-existing warnings (17 in web; see `baseline.json`) are unchanged.
- **REQ-026** New unit tests SHALL cover:
  - `pickSummarySource` — at least 6 cases (each kind on enriched / native / none + the malformed-URL → native fallback + the empty-markdown → native fallback).
  - `deriveHostname` — at least 5 cases (canonical, leading `www`, uppercase, malformed URL → null, URL with port).
  - `pickCandidateContent` — preserve all existing test cases AND add a new case for the Twitter "tweet text + enriched OK" priority flip.
  - `hydrateRankedItems` (api) — at least 3 cases: enriched item gets `enrichedSource` non-null; native item gets `null`; launch-date gate forces `null` for old archive.
  - `email-send.ts::hydrateItems` — same three cases as above, asserting `sourceLabel` / `sourceUrl` / `readVerb` derive correctly.
  - `ArchiveStoryCard` — render test: enriched item shows hostname chip + retargeted link; native item shows platform chip + `item.url` link.
  - `NewsletterEmail` — render test (or snapshot): chip appears with correct label + link.
- **REQ-027** Web subpath-import rule (`.claude/rules/learnings/web-shared-subpath-imports.md`) SHALL be respected: any new imports from `@newsletter/shared` in the web package use the subpath form (`@newsletter/shared/services` / `/constants` / `/types`), never the root barrel.

## Verification Scenarios

| VS | Scenario | Surface | Method |
|---|---|---|---|
| VS-1 | Twitter link-tweet: recap input flips from tweet text to enriched markdown | Pipeline rerank | Unit: `pickCandidateContent({ content: "Look at this", enrichedLink: { status: "ok", markdown: "<big article>", url: "https://theverge.com/x" } })` → returns the article markdown. |
| VS-2 | HN Ask self-post: recap input stays as selftext | Pipeline rerank | Unit: `pickCandidateContent({ content: "<selftext>", enrichedLink: { status: "skipped", skipReason: "no-url" } })` → returns selftext. |
| VS-3 | HN/Reddit link-post: recap input unchanged (enriched markdown) | Pipeline rerank | Unit: covers `content: null` AND `content: ""` inputs. |
| VS-4 | Add-post route: same picker applied | Pipeline add-post | Unit: stub `generateRecap`, call `hydrateAddedPost` for a Twitter add-post URL, assert `generateRecap` was called with the enriched markdown, not the tweet text. |
| VS-5 | Eval replay parity | Pipeline eval | Unit: assert `replay.ts` consumes the same picker for both modes. |
| VS-6 | Archive chip — enriched | Web | RTL render test: item with `enrichedSource = { hostname: "theverge.com", url: "https://theverge.com/x" }` → chip text `"theverge.com"`, link href `https://theverge.com/x`, verb `"Read on theverge.com"`. |
| VS-7 | Archive chip — native | Web | RTL render test: item with `enrichedSource = null`, `sourceType = "hn"` → chip text `"Hacker News"`, link href `item.url`, verb `"Read source"`. |
| VS-8 | Archive chip — legacy archive gate | Web (via api hydrator) | Unit on `hydrateRankedItems` with an `archiveCompletedAt` before `ENRICHED_SUMMARY_LAUNCHED_AT` → every item's `enrichedSource` is forced `null`. |
| VS-9 | Email chip — enriched | Email render | Snapshot or DOM test: rendered HTML contains the hostname text and the enriched URL as a link. |
| VS-10 | Email chip — native | Email render | Snapshot: rendered HTML contains the platform label and the `item.url` as a link. |
| VS-11 | Hostname derivation — edge cases | Shared | Unit table: `www.`, leading/trailing whitespace, uppercase scheme, port-only URL, malformed URL. |
| VS-12 | Source label map exhaustiveness | Shared | TypeScript compile-time check: `Record<SourceType, string>` rejects an enum addition; runtime sanity test iterates `Object.keys` and asserts every value is non-empty. |

## Constants & Types Reference

```ts
// packages/shared/src/constants.ts
export const ENRICHED_SUMMARY_LAUNCHED_AT = new Date("2026-05-25T00:00:00Z");
// Finalise the exact merge timestamp during Stage 6 (commit & PR).

// packages/shared/src/services/summary-source.ts (new file)
import type { EnrichedLinkContent } from "../types/index.js";
import type { SourceType } from "../db/schema.js";

export type SummarySource =
  | { kind: "enriched"; hostname: string; url: string; markdown: string }
  | { kind: "native"; content: string }
  | { kind: "none" };

export function pickSummarySource(
  content: string | null,
  enrichedLink: EnrichedLinkContent | undefined | null,
): SummarySource;

export function deriveHostname(url: string): string | null;

export function getPlatformLabel(sourceType: SourceType): string;
// + an exhaustive PLATFORM_LABEL Record<SourceType, string>

// packages/shared/src/types/run.ts (extension)
export interface RankedItem {
  // ... existing fields unchanged
  enrichedSource: { hostname: string; url: string } | null;
}
```

## Files Touched (final)

| Package | File | Change | LoC |
|---|---|---|---|
| shared | `src/services/summary-source.ts` | NEW | ~80 |
| shared | `src/services/index.ts` | re-export | ~3 |
| shared | `src/services/__tests__/summary-source.test.ts` | NEW | ~120 |
| shared | `src/constants.ts` | add `ENRICHED_SUMMARY_LAUNCHED_AT` | ~3 |
| shared | `src/types/run.ts` | add `enrichedSource` to `RankedItem` | ~2 |
| pipeline | `src/services/candidate-loader.ts` | delegate to picker | ~10 |
| pipeline | `src/services/__tests__/candidate-loader.test.ts` | extend | ~30 |
| pipeline | `src/services/add-post-helper.ts` | route through picker (2 sites) | ~10 |
| pipeline | `tests/unit/.../add-post-helper.test.ts` | new case | ~30 |
| pipeline | `src/eval/replay.ts` | already uses picker — verify | ~0 |
| pipeline | `src/workers/email-send.ts` | extend `NewsletterStory` + `hydrateItems` (+ launch-date gate) | ~30 |
| pipeline | `tests/unit/workers/email-send-hydrate.test.ts` | NEW | ~80 |
| api | `src/services/rank-hydration.ts` | populate `enrichedSource` + launch-date gate | ~20 |
| api | `src/services/__tests__/rank-hydration.test.ts` | extend | ~60 |
| api | `src/routes/archives.ts` | pass `archive.completedAt` to hydrator | ~4 |
| api | `src/lib/email/templates/newsletter.tsx` | extend interface + render chip | ~40 |
| api | `tests/unit/email/newsletter-template.test.ts` | extend | ~30 |
| web | `src/components/ArchiveStoryCard.tsx` | replace inline chip data with derived data | ~25 |
| web | `src/components/__tests__/ArchiveStoryCard.test.tsx` | NEW | ~60 |

Total estimate: **~640 lines** (source + tests) across 4 packages.

## Out of Scope

- Rerank LLM prompt changes (REQ-OQ-3): unchanged.
- Persisting `summarySource` on `RankedItemRef`: explicitly rejected.
- Brand-name map for hostnames (e.g. `theverge.com` → `"The Verge"`): explicitly rejected.
- Backfilling old archives' `enrichedSource`: explicitly rejected (launch-date gate handles this).
- Cost-tracking alarm thresholds for Twitter-heavy rerank batches: future spec if needed.
