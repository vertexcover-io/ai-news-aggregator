# @newsletter/web

React + Vite frontend for the admin review dashboard and public archive.

## Responsibilities
- Archive listing (`/`): PUBLIC — Ledger-layout listing of reviewed archives, month-grouped, with filter chips, client-side "Load more", a featured first row when a lead summary is available, and a search bar + date-range chip (`?q=`/`?from=`/`?to=` URL state) that calls `/api/archives/search` for keyword + date filtering with inline term highlighting
- Archive detail (`/archive/:runId`): PUBLIC — Ledger-aesthetic read-only view of a completed run: serif/mono typography, 3-column story sections with numbered N° rail, image plates, and rust-accented recap blocks; wrapped by `PublicLayout` (shared Nav + Footer)
- Admin login (`/admin/login`): password gate for operator pages
- Dashboard (`/admin`): shows recent runs table, schedule status banner, and "Run Now" button; each run row exposes a "Details" link to its observability page
- Run observability (`/admin/runs/:runId`): per-run telemetry — masthead + live status pill, pipeline funnel (collected→deduped→shortlisted→ranked), per-stage timing + cost strip, source telemetry table, link-enrichment strip, failures, and a debug timeline; viewable live (~2s poll, stops on terminal status) and persisted for past runs
- Review (`/admin/review/:runId`): curate ranked items before publishing — reorder (DnD, disabled while filters are active), remove, add by URL; filter by shortlist toggle and/or source facet; expand pool cards inline to see tweet/link/no previews
- Settings (`/admin/settings`): configure schedule and HN/Reddit source config
- Communicates with `@newsletter/api` via HTTP only

## Layout
- `src/pages/` — top-level route components (`ArchiveListingPage.tsx`, `ArchivePage.tsx`, `DashboardPage.tsx`, `ReviewPage.tsx`, `SettingsPage.tsx`, `AdminLoginPage.tsx`, `RunObservabilityPage.tsx`)
- `src/components/` — presentational pieces:
  - `archive-listing/` — `ArchiveRow.tsx`, `FilterChip.tsx`, `MonthHeader.tsx`, `format.ts`, `SearchBar.tsx`, `DateRangeChip.tsx`, `DateRangePopover.tsx`, `ResultMeta.tsx`, `EmptyResults.tsx` (Ledger listing components + keyword/date-range search UI)
  - `RunForm/`, `StatusPanel.tsx`, `ResultList.tsx` — run-page components
  - `review/` — `ReviewList.tsx` (DnD list; drag disabled when any filter is active), `ReviewCard.tsx` (shows `SOURCETYPE · identifier` badge; no "Expand preview" button — preview is pool-only), `PoolSection.tsx` (pool item list with `PoolCard.tsx`), `PoolCard.tsx` (collapsed by default; "Expand / Collapse preview" button toggling inline `ExpandedPreview`), `ExpandedPreview.tsx` (switches on `preview.kind`: tweet → tweet text + optional quoted-tweet block + "View on X" link; link → OG title + byline + domain + description + `SafeMarkdown` for Readability markdown; none → recap summary + "Full preview unavailable"), `SafeMarkdown.tsx` (DOMPurify-sanitizes HTML then renders via `react-markdown`; no `rehype-raw`; truncates at `MARKDOWN_EXCERPT_MAX` chars from `@newsletter/shared/constants`), `ReviewToolbar.tsx` (shortlist toggle checkbox — disabled when `shortlistedItemIds` is null — and source dropdown with grouped facets rendered as removable chips; AND-composes with shortlist toggle), `AddPostPanel.tsx`, `SaveBar.tsx`
  - `dashboard/` — `RunsTable.tsx` (≥ 640 px tabular layout; renders both a **Date** column (started/run time) and a separate **Publish date** column showing the run's publish-aware `issueDate`), `RunsCardList.tsx` (< 640 px stacked card layout; each card shows a **Started** line and a **Publish date** line with the same `issueDate`), `ScheduleBanner.tsx`, `EmptyState.tsx`, `SourcesDialog.tsx` (per-run raw-items modal opened from each row's "Sources" button; disabled when the run is `failed`/`cancelled` and `itemCount === 0`), `CostButton.tsx` + `CostDialog.tsx` (per-row LLM cost breakdown; label is `Cost: $X.XXX` when totalCostUsd is numeric, `Cost: ?` + warning chip when null with non-null breakdown, plain `Cost` for pre-feature runs with `costBreakdown === null`; dialog renders Stage/Calls/In tok/Out tok/Cached/Thinking/Model/Cost columns with stage-aggregate + per-model sub-rows), `cost-format.ts` (`formatCostUsd`, `formatTokens`), and `SocialOverflowMenu.tsx` (⋮ overflow menu on each run row; renders per-channel LinkedIn and X items — enabled trigger for unposted eligible runs, "View post ↗" anchor with `href=permalink` for posted runs, non-link "✓ Posted" div when posted but no permalink, disabled item for ineligible runs; opening an enabled trigger shows a confirm dialog, confirming calls `useTriggerSocialPost`; eligibility = run is reviewed + completed + not dry-run + not already posted on that channel)
  - `settings/` — settings-specific components
  - `eval/` — ranking-eval admin UI (`/admin/eval`, `/admin/eval/runs`): `RunDetailDrawer.tsx` (run-detail modal with two full-width tabs — **Prompt & Cost** = prompt snapshot + score + cost breakdowns; **Report** = full-width two-column rankings — defaulting to Report for a done run with report data, Prompt & Cost otherwise; Report tab label carries an `N → ranked` hint chip when pool size is known), `CalendarReportComparison.tsx` (Mode B previous-vs-draft ranking columns + prompt panes; exports `RankingFunnel`, the 3-cell **Sent for ranking → Ranked (top-N) → Cost** funnel where Sent = deduped pool size sent to the LLM ranker, with a "(sent − ranked) items considered but not surfaced" note), `ReportTab.tsx` (Mode A Expected-vs-Actual ranking + score strip, reusing `RankingFunnel`), and `EvalResultsPanel.tsx`. The funnel's Sent cell and hint chip are omitted (no NaN) for legacy runs without a persisted `poolSize`. Hidden-but-scrollable scroll regions use the `scrollbar-none` utility in `src/index.css`.
  - `observability/` — run observability page sections (consumed by `pages/RunObservabilityPage.tsx`): `RunFunnel.tsx` (proportional bars + drop annotations; hatched "pending" bar with "— / topN" for null stages), `StageTimingRail.tsx` (done/running/pending glyphs from stage start/end timing), `CostStrip.tsx` (running total / per-stage / tokens, graceful null), `SourceTelemetryTable.tsx` (status badges, items/retries/duration, inline failed-error note), `EnrichmentStrip.tsx` (attempted/ok/failed/skipped/avg-fetch, all-zeros when null), `FailuresList.tsx` (level=error cards with context tags + truncate/expand for long messages), `DebugTimeline.tsx` (All/Info/Warn/Error level filter; error rows in error style with an expandable dark stack block; distinct empty states for "no logs" vs "no entries at this level"), `LiveStatusPill.tsx` (`data-live` + `status · stage`), and `format.ts` (`formatDuration`/`formatCount`/`formatElapsed`/`formatClock`)
  - `ui/` — shadcn base components (Button, Input, etc.)
- `src/api/` — typed API client (`client.ts` for the fetch wrapper, `runs.ts` incl. `getRunObservability(runId)` — 404 → null, `triggerSocialPost(runId, channel)` — POSTs to `/api/runs/:runId/post/:channel` and returns the 202 response, `settings.ts`, `archives.ts` incl. `getSourceFacets(runId)` — GETs `/api/admin/archives/:runId/source-facets` and returns `SourceFacet[]`)
- `src/hooks/` — custom hooks (`useRunPolling.ts`, `useRunObservability.ts` — polls `GET /api/admin/runs/:runId/observability` every 2s while the run is non-terminal, stops on completed/failed/cancelled, treats 404 as null; mirrors `useRunPolling` without modifying it; `useTriggerSocialPost(runId)` — wraps `triggerSocialPost` in a react-query mutation and invalidates the `["runs"]` query on success; `useReviewFilters(shortlistedItemIds)` — manages `shortlistOnly: boolean` + `selectedSources: string[]` (each entry is `"sourceType::identifier"`) filter state; exposes filtered ranked and pool lists; disables DnD when any filter is active; `useSourceFacets(runId)` — fetches `GET /api/admin/archives/:runId/source-facets` via react-query and returns `{sourceType, identifier, count}[]`; and hooks for settings and review mutations)
- `src/layouts/` — `PublicLayout.tsx` (wraps `/` and `/archive/:runId`), `AdminLayout.tsx`, `RequireAdmin.tsx`

## Stack notes
- Tailwind CSS via `@tailwindcss/vite`; global styles in `src/index.css`; `@theme` tokens expose `font-serif` (Newsreader) and `font-mono` (Geist Mono) utilities loaded via Google Fonts in `index.html`
- Routing via `react-router-dom` using `createBrowserRouter` + `RouterProvider` (required for `useBlocker` in the review page); root route is `ArchiveListingPage` (`/`)
- Data fetching/polling via `@tanstack/react-query`
- Forms via `react-hook-form`

## Mobile layout conventions

All in-scope pages and `PublicLayout` use responsive horizontal padding: `px-4 sm:px-6 md:px-8` (with `/` and `/archive/:runId` using `md:px-20` for the wider desktop gutter).

The `120px / 1fr / 120px` three-column grids on `/` (`ArchiveRow`) and `/archive/:runId` (`ArchivePage`, `ArchiveStoryCard`) reflow to a single column at `< md` (768 px) using a single DOM element with responsive `grid-template-columns` — no duplicate markup.

The dashboard runs list uses a two-representation pattern: `RunsTable` is shown at `sm:` and above; `RunsCardList` is shown below 640 px (`sm:hidden` / `block sm:hidden`). Both receive the same `runs` prop.

The DnD review page (`ReviewList`) registers `TouchSensor` alongside `PointerSensor` with `activationConstraint: { delay: 250, tolerance: 5 }` so mobile users can scroll without triggering drag. Each `ReviewCard` exposes a visible `GripVertical` icon button with `data-dnd-handle="true"` and a minimum 44 × 44 px touch target.

## Rules
- No direct DB access — all data comes through the API
- No direct Redis/BullMQ access
- Use the typed API client (`src/api/`) for backend communication — never call `fetch` from components
- Pages compose components and hooks; keep business logic out of JSX

## Commands
pnpm dev          # Start Vite dev server
pnpm build        # Production build
pnpm typecheck    # Type check
pnpm test:unit    # Run unit tests (vitest + jsdom)
