# Run Observability — Per-Source Tracing

**Feature:** `run-observability-source-tracing`
**Date:** 2026-06-23
**Page:** `/admin/runs/:runId` (Run Observability)
**Visual reference:** [`mock.html`](./mock.html) (open in a browser) · [`mock.png`](./mock.png) (static)

> The implementing agent MUST open `mock.html` and match the component layout, the per-source
> step timeline, the structured log lines, the independent scrollable Failures panel, and the
> demoted raw event stream. The mock is the source of truth for visual structure and the
> Ledger aesthetic (cream/serif/mono palette already in `packages/web/src/index.css`).

---

## 1. Problem

The observability page has three defects, all tracing to **two divergent "source identifier"
schemes that only coincidentally agree**:

- **At read-time**, the items panel and source list use `deriveRawItemIdentifier()` (shared) →
  a content-derived key: `news.ycombinator.com`, `r/lovable`, `@handle`, `cursor.com`, the search query.
- **At collection-time**, each collector authors its own `sourceTelemetry.identifier` and the
  `run_logs.source` column — and these do **not** use `deriveRawItemIdentifier`.

### 1a — Expanded item list is empty even when `itemsFetched > 0`
`run-source-items.ts:84-88` filters `item.sourceIdentifier === parsedSource.identifier`, where
`parsedSource.identifier` is the telemetry row's `identifier`. By collector:

| Source | Telemetry `identifier` | Item derived `sourceIdentifier` | Match? |
|--------|------------------------|---------------------------------|--------|
| blog | `cursor.com` (hostname) | `cursor.com` | ✅ |
| web_search | the query | the query | ✅ |
| reddit | `r/<sub>` (lowercased) | `r/<sub>` | ✅ |
| **hn** | `hn:<feed>` (e.g. `hn:topstories`) | `news.ycombinator.com` | ❌ |
| **twitter** | `list:<id>` / `user:<id>` | `@<handle>` | ❌ |
| **github** | (verify) | `<owner>/<repo>` | ❌ likely |

The mismatched collectors (hn, twitter, github) return an empty panel.

### 1b — Source log strip shows the whole collector's logs, not one source
Collectors stamp `run_logs.source = <sourceType>` (e.g. `"blog"`, `"web_search"`) and put the
real source name in `context.sourceName` (see `web.ts:234,288,338,367`). So
`listForRunSource` (`run-logs.ts:27-38`) finds **0 exact matches** on the identifier, then
**falls back to matching on `sourceType`** → returns every blog source's logs in the strip.

### 1c — Failures section is poorly placed and unclear
`FailuresList` is `logs.filter(level==="error")` rendered as inline stacked cards. The title is
mangled (`message.split("\n")[0].split(":")[0]` discards everything after the first colon), the
`context.errors[]` array and structured context are not surfaced, and it is not an isolated
scrollable region.

### 1d — Debug Timeline is low-signal
A flat firehose of all run logs (`source.completed: web_search`, `web listing processed`) with
no per-source grouping. You cannot see "what steps did *cursor.com* go through."

---

## 2. Goals / Non-Goals

**Goals**
- An operator can expand any source in any collector and see the exact **step path** it took to
  extract data (Discover → Fetch → Extract → Enrich → Dedup → Shortlist → Rank), with per-step
  status, count, and timing.
- The expanded item list is correctly populated for every collector.
- The source log strip shows **only that source's** log lines, with full structured context.
- Failures are an **independent, scrollable** panel with full, untruncated error context tied to
  source → step.
- The flat Debug Timeline is demoted to an opt-in "Raw Event Stream" for deep debugging.

**Non-Goals**
- **No backfill** of historical archives. Old runs keep their existing (possibly mismatched)
  identifiers and may still show empty panels — accepted, consistent with prior telemetry fixes.
- No new step-telemetry schema. Step data is **derived at read-time** from the (now correctly
  source-keyed) `run_logs` plus the existing per-source item lifecycle summary.

---

## 3. Design

### 3.1 Unified collection-unit identifier (root-cause fix for 1a + 1b)

Introduce a single canonical **collection-unit identifier** authored once by each collector at
emission time and propagated to all three consumers:

1. **`raw_items.metadata.collectionUnit`** — `{ sourceType, identifier, displayName }` stamped on
   each item as it is collected. `metadata` is existing `jsonb` (`RawItemMetadata`) — **no schema
   migration**, just a new optional field on the type.
2. **`sourceTelemetry.sources[].identifier`** — set to the same `collectionUnit.identifier`.
3. **`run_logs.source`** — stamped with the same `collectionUnit.identifier` (not the bare `sourceType`).

The identifier is the **configured collection unit**, not the content-derived host/handle. This
preserves operator-meaningful granularity AND makes the join exact:

| Source | `collectionUnit.identifier` | `displayName` |
|--------|------------------------------|---------------|
| hn | `hn:<feed>` (per feed) | `Hacker News · <feed>` |
| reddit | `r/<sub>` (lowercased) | `r/<sub>` |
| twitter (user) | `@<handle>` | `@<handle>` |
| twitter (list) | `list:<id>` | `Twitter list <id>` |
| blog / rss / newsletter | hostname | source displayName |
| web_search | the query | `"<query>"` |
| github | `<owner>/<repo>` | `<owner>/<repo>` |

> Twitter **lists** and HN **feeds** are the cases that break URL-derivation today: a list's items
> derive to many `@handle`s, an HN feed's items all derive to one host. Stamping the configured
> unit on the item resolves both without losing granularity — a list row expands to show all its
> items (per-author handle still visible in each item's `author`), and each HN feed is its own row.

**Read-time join change** (`run-source-items.ts`): filter the pool by
`item.metadata?.collectionUnit?.identifier === parsedSource.identifier`, **falling back** to the
existing `deriveRawItemIdentifier` comparison when `collectionUnit` is absent (legacy items). Same
fallback for the source-summary grouping in `raw-items.ts`.

**Log scoping change** (`run-logs.ts`): keep the exact-match query on `run_logs.source`. **Remove
the `sourceType` fallback** (`run-logs.ts:35-37`) that causes the leak — for new runs the exact
key matches; for legacy runs an empty strip is acceptable (was already wrong). Collector-wide
events not tied to a single unit (e.g. `collector.web-search.started`) are stamped `source = null`
and appear only in the Raw Event Stream, never in a per-source strip.

**Collector changes** (one canonical helper, used everywhere): add a shared
`deriveCollectionUnit(sourceType, configuredSource)` that returns `{ identifier, displayName }`,
and thread its output into (a) each `RawItemInsert.metadata.collectionUnit`, (b) the
`sourceTelemetry` entry, (c) every `runLogger.*` call's `source` field. Touch: `hn.ts`,
`reddit.ts`, `twitter/index.ts`, `web.ts`, `web-search/index.ts`, `github` collector, and
`source-telemetry.ts`.

### 3.2 Per-source step timeline (read-time derived)

The expanded source panel renders a horizontal **step timeline** of 7 steps. Steps split by
where their data comes from:

- **Collect-time steps — Discover, Fetch, Extract, Enrich** — derived from the source-scoped
  `run_logs` events. A shared `classifyLogStep(event, context)` maps events → step:
  - `*.listing*` / `discover.*` → **Discover**
  - `fetch.*` / `*.detail_*` / `web.extract.start` (fetch phase) → **Fetch**
  - `extract.*` / `web.extract.*` → **Extract**
  - `enrich.*` / `link_enrichment.*` → **Enrich**

  Collectors SHOULD set an explicit `context.step` for precision; the classifier is the fallback
  for events that don't carry it. Each step's status/count/timing is reduced from its events
  (`durationMs`, counts in context; presence of a `level==="error"` event → failed; no events for
  a step that should have run → "no data"; downstream steps after a fatal failure → skipped).
- **Process-time steps — Dedup, Shortlist, Rank** — derived from the existing per-source item
  lifecycle summary already computed by `summarizeSourceItems()` / `classifyItemLifecycle()`
  (survived/dropped, shortlisted, ranked counts).

The timeline shape, status icons (✓ done / ✕ failed / – skipped), and the "click a step → filter
the source log below" interaction are specified by `mock.html`.

New shared types: `RunSourceStep { key, label, status: "done"|"failed"|"skipped"|"running"|"empty", count, detail, durationMs }`.
`buildRunSourceItems` returns an added `steps: RunSourceStep[]`. Derivation lives in a new
shared/api service (`source-steps.ts`) so it is unit-testable in isolation.

### 3.3 Source log strip — full structured context (1b polish)

`SourceLogStrip` renders each line as: `time · level · event · message`, followed by a wrapped row
of **context key-value chips** for every field in `run_logs.context` (`url=`, `status=`, `bytes=`,
`durationMs=`, `retries=`, `class=`, `fatal=`, …). Error/warn lines get a colored left rail.
Layout per `mock.html`. The strip filters to the step selected in the timeline (client-side, by a
`step` tag derived the same way as 3.2). "Show as much info as fits, neatly."

### 3.4 Failures — independent scrollable panel (1c)

Replace `FailuresList` inline cards with a fixed-height (`max-h`), independently **scrollable**
panel. Each failure card shows:
- Title: a clean human label (do **not** truncate at the first `:` — use event-derived label +
  first line of message).
- Meta: `time · sourceType · <collectionUnit displayName> · step: <step>`.
- Full untruncated message (wrapped).
- A structured **context block** rendering `errorClass`, `url`/`endpoint`, `status`, `attempts`,
  `timeout`, and any `context.errors[]` entries as key/value rows.
- Tags: source, class, retries, fatal/non-fatal. Left rail color = fatal (red) vs non-fatal (amber).

Failures are grouped/labeled by source. Layout per `mock.html`.

### 3.5 Debug Timeline → Raw Event Stream (1d)

Demote `DebugTimeline` to a collapsed, opt-in "Raw Event Stream" section (toggle to expand),
labeled "advanced · for deep debugging only". Keep the existing level filters inside it. The
per-source steps (3.2) are the primary debug surface. Layout per `mock.html`.

---

## 4. Files touched (indicative)

**shared**
- `types/index.ts` (or `types/run.ts`): add `RawItemMetadata.collectionUnit?`.
- `types/observability.ts`: add `RunSourceStep`, extend `RunSourceItemsResponse` with `steps`.
- `services/source-identifier.ts`: add `deriveCollectionUnit()`; keep `deriveRawItemIdentifier` as legacy fallback.
- `services/source-steps.ts` (new): `classifyLogStep()` + step reducer (pure, unit-tested).

**pipeline**
- `collectors/{hn,reddit,web,web-search,github}.ts`, `collectors/twitter/index.ts`: stamp
  `collectionUnit` on items, telemetry, and `runLogger` `source`; optionally set `context.step`.
- `services/source-telemetry.ts`: carry `collectionUnit.identifier`.

**api**
- `repositories/run-logs.ts`: drop the `sourceType` fallback in `listForRunSource`.
- `repositories/raw-items.ts`: prefer stored `collectionUnit`, fall back to `deriveRawItemIdentifierSql`.
- `services/run-source-items.ts`: filter by `collectionUnit` (fallback to derived); attach `steps`.

**web**
- `components/observability/SourceItemsPanel.tsx`: render `StepTimeline` + wire step→log filter.
- `components/observability/StepTimeline.tsx` (new).
- `components/observability/SourceLogStrip.tsx`: structured context chips + step filter + colored rails.
- `components/observability/FailuresList.tsx` → scrollable panel, full context, clean titles.
- `components/observability/DebugTimeline.tsx`: wrap in a collapsed "Raw Event Stream" container.
- `pages/RunObservabilityPage.tsx`: section copy/order.

---

## 5. Testing

- **shared unit:** `deriveCollectionUnit` per source type (incl. twitter list vs user, hn feed);
  `classifyLogStep` event→step mapping; step reducer (done/failed/skipped/empty, fatal cascade).
- **api unit/e2e:** `run-source-items` returns non-empty items + correct `steps` for hn & twitter
  (regression for 1a); `listForRunSource` returns only the target source's logs (regression for 1b).
- **web unit:** `StepTimeline`, `SourceLogStrip` context chips + step filter, `FailuresList` scroll +
  full message + clean title.
- **e2e (Playwright, hermetic):** expand a source → steps render, items non-empty, log strip scoped;
  Failures panel scrolls and shows full context; Raw Event Stream toggles. No real external sends.

---

## 6. Open / accepted

- Legacy runs (pre-feature) won't gain `collectionUnit`; they fall back to URL derivation and may
  still show empty panels / leaked logs. **Accepted (new-runs-only).**
- `github` collector identifier alignment to be confirmed during implementation.
