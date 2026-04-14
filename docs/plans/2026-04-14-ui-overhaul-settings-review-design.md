# UI Overhaul: Persistent Settings, Daily Scheduling, and Curation Review

**Date:** 2026-04-14
**Status:** Design → SPEC
**Scope:** Replace the manual `/run` form with a persistent settings + daily scheduled run model, and add a curation review page (reorder / remove / add posts) that edits the run before the archive renders it.
**Non-goals:** Email delivery (Resend), changes to the archive page UI, multi-user support, multi-config support.

**Mockups:** [`2026-04-14-ui-overhaul-mockups/dashboard.png`](./2026-04-14-ui-overhaul-mockups/dashboard.png) · [`settings.png`](./2026-04-14-ui-overhaul-mockups/settings.png) · [`review.png`](./2026-04-14-ui-overhaul-mockups/review.png)

**SPECs:** [`settings-scheduling-dashboard/SPEC.md`](./settings-scheduling-dashboard/SPEC.md) (Phase 1) · [`review-curation/SPEC.md`](./review-curation/SPEC.md) (Phase 2)

---

## Problem Statement

Today the app has a single `/run` form that the user fills out each time, submits, watches poll, then lands on the archive. The user wants:

1. **Configure once, run daily.** A persistent settings page. The scheduled job fires at a user-chosen time every day. A "Run now" button triggers the same pipeline on demand.
2. **Review before the archive renders.** Between "ranking complete" and "archive shows it", the user needs to curate: remove low-quality / duplicate items, reorder the list, and add missed posts (by URL, typed as HN / Reddit / web). The existing archive then renders the curated output, unchanged visually.

This is a medium-to-major change: new persistence (settings, repeatable scheduling), new workflow state (ranked → pending review → reviewed), several new UI surfaces (settings, dashboard, review), and new API verbs (PATCH archive, POST add-post).

## Context

**Current architecture.** Manual run only. `POST /api/runs` enqueues a `run-process` BullMQ job keyed by `runId`. In-progress state lives in Redis (1h TTL). On completion, `run_archives` is written (jsonb rankedItems). `/archive/:runId` renders read-only. No scheduling, no review, no editing. Stack: React + Vite + Tailwind 4 + React Query + RHF on the frontend; Hono + Drizzle + BullMQ on the backend. No UI component library — everything hand-rolled.

**What's staying.** The collection/ranking/recap pipeline is untouched. `run_archives` remains the canonical completed-run store. `/archive/:runId` renders exactly as today.

**What's changing.** The frontend becomes Dashboard + Settings + Review (+ existing Archive). The backend gains a settings table, a repeatable scheduler, a review PATCH endpoint, and single-post fetchers for HN / Reddit / web. `run_archives` gains a `reviewed` boolean and its `rankedItems` column becomes mutable.

## Requirements

### Functional

**Settings (`/settings`)**
- User edits one active config: HN / Reddit / web sources (same shapes as current `RunSubmitPayload`), profile selection, topN, halfLifeHours, schedule time (HH:MM), schedule timezone, and an "enabled" toggle.
- Settings persist to a new `user_settings` table (singleton row).
- Saving settings reconciles the repeatable BullMQ schedule: remove prior repeatable, add a new one with the new cron expression + timezone (unless disabled).
- A "Run now" button enqueues an immediate run using the current saved settings.

**Dashboard (`/`)**
- Lists recent runs (descending by `completedAt` / `startedAt`), showing date, status (running / ready-to-review / reviewed / failed), item count, and CTAs (Review or View Archive).
- Header: Run Now button + Settings link.
- Empty state when no settings saved yet: prompt to configure.

**Review (`/review/:runId`)**
- Renders the ranked items as a draggable list (title, source, score, thumbnail, rationale preview).
- Per-item: delete button, drag handle, "open source" link.
- "Add a post" panel at the top: user picks source type (HN / Reddit / web) and pastes a URL. Backend fetches → generates recap → appends to the list (inserted at a chosen position; default: end; user can drag after insertion).
- Save button persists the edited `rankedItems` (new order, with removals and additions) back to `run_archives` and flips `reviewed = true`.
- After save, redirect to `/archive/:runId` (unchanged UI).
- Unsaved-changes guard on navigation.

**Scheduling**
- BullMQ repeatable job `daily-run` owned by the pipeline package. On fire: reads `user_settings` and enqueues a normal `run-process` job with `jobId: <new-runId>`.
- Timezone handled via BullMQ repeat `tz` option. DST-safe.
- Collision policy: if a prior day's run is unreviewed, the new run starts anyway; history shows both.

### Non-functional

- Single-user, internal tool — no auth additions beyond what exists. Last-write-wins on settings and review saves.
- Archive page remains visually identical; only the underlying `rankedItems` content changes.
- Review UI must be accessible: keyboard-reorderable (@dnd-kit supports this), screen-reader labels on delete/drag handles.
- Adding a post is async (fetch + recap can take seconds). The UI must show a per-add loading state without blocking other edits.
- Schedule changes must be idempotent: editing settings twice in a row should not produce duplicate repeatable jobs.

### Edge cases

- **Settings not yet saved, schedule fires:** repeatable job should never have been scheduled; the scheduler reconciliation only creates the job when `enabled = true` and settings are complete.
- **Schedule time edited:** prior repeatable removed by key before new one is added.
- **Timezone change / DST:** BullMQ's `tz` option recomputes next fire — covered.
- **Add-post URL already in ranked list:** reject with a validation error in the UI ("already in the list").
- **Add-post fetch fails (dead URL, 404, timeout):** surface the error next to the add form; list state untouched.
- **User reorders then fetch for a pending add resolves:** inserted item lands at the chosen slot; the visible order is re-derived from the current client list, not the pre-fetch state. Server-side persistence only happens on Save.
- **Concurrent runs:** a manual "Run now" while a job is still running — UI disables the button based on latest run status; backend does not enforce uniqueness (cheap to allow).
- **Pre-existing archives (before this change):** backfill `reviewed = true` so they stop showing a "ready to review" badge. Their `rankedItems` remain as the AI output.
- **User deletes all items in review:** Save button disabled; empty digests aren't useful.

## Key Insights

1. **The archive is the output contract, not a separate artifact.** Review edits mutate `run_archives.rankedItems` directly. There's no "published" copy vs "draft" copy — one row, one list, one reviewed flag. This avoids a state machine.
2. **Added posts must look identical to collected ones.** They need to flow through the same recap-generation path and land in `raw_items` just like collector output, so the archive page renders them with no branching. `rankedItems` references them by id, same as today.
3. **Settings is a singleton row, not a user table.** Matches the "personal tool" scope. A single boolean `singleton = true` column with a unique index keeps the shape honest.
4. **Scheduling is stateless reconciliation, not event sourcing.** On every settings save, compute desired cron, remove any existing repeatable with the known key, add the new one. Idempotent, survives restarts.

## Architectural Challenges

**C1 — Making `run_archives` mutable without breaking the archive contract.** Today `/archive/:runId` hydrates `rankedItems` from `raw_items` by id. If review edits only touch the jsonb column and added items get upserted into `raw_items` first, the archive hydrates identically. The only new field is `reviewed: boolean` (default false for new runs, true for backfilled old runs).

**C2 — Single-post fetchers for each source type.** Collectors today are listing-oriented. Adding a post needs a one-off fetcher per type:
- **HN:** Parse HN item id from URL, call the existing HN Algolia/API path by id. Existing code is mostly reusable — just factor out the per-item hydration step.
- **Reddit:** Append `.json` to the post URL, fetch with the UA override (per the existing Reddit UA learning), parse a single post's data + top comments. New but small.
- **Web:** Direct URL → Jina markdown → LLM recap. Single-step. Reuses the web collector's per-URL path, bypassing the listing-page step.

All three paths converge on a shared helper that upserts a `raw_items` row and runs the recap stage, returning a fully-hydrated `RankedItem`.

**C3 — Repeatable scheduling in BullMQ.** A single repeatable job `daily-run` keyed with a stable `repeatJobKey` (e.g. `daily-run:default`) so reconciliation can target it. Its processor reads `user_settings`, computes a new `runId`, writes the initial RunState to Redis, and enqueues `run-process` — exactly what the current POST /api/runs route does. Factoring the "start a run" logic out of the route handler into a shared service keeps manual and scheduled paths symmetric.

**C4 — DnD + async add interleaving.** The review list is client-authoritative until Save. Drags reorder local state; delete removes from local state; add-post kicks off an async fetch and, on resolve, inserts into local state. No backend writes until Save. This keeps the model simple and avoids partial-state races.

**C5 — UI foundation shift.** Introducing shadcn/ui + Radix + @dnd-kit + lucide-react is a meaningful stack change. shadcn/ui copies components into `packages/web/src/components/ui/`; no runtime dep to break builds. Tailwind 4 already installed. The scope (settings form, dashboard table, review list, dialogs, toasts) justifies the investment once — building these by hand for each page would be slower overall.

## Approaches Considered

### Approach A — All-in-one slice

Ship settings + scheduling + dashboard + review in one PR. Pros: one coherent UX overhaul, no half-shipped intermediate state. Cons: big diff, bigger review surface, more risk in a single merge.

### Approach B — Two-phase delivery (recommended)

**Phase 1:** Settings page + `user_settings` table + BullMQ repeatable scheduler + "Run now" wired to saved settings + Dashboard listing runs. Replaces `/run` as the primary config UI. Review not yet implemented — clicking a completed run still links to `/archive/:runId` directly (so existing behavior works).

**Phase 2:** Review page + `reviewed` column + PATCH endpoint + single-post fetchers + add-post flow. Once merged, dashboard links completed-but-unreviewed runs to `/review/:runId` first.

Pros: natural split (backend surfaces are independent), each phase is reviewable and shippable, Phase 1 delivers user value on its own (no more re-filling the form). Cons: some Phase 1 UI placeholders get reshaped in Phase 2 (dashboard row CTA changes).

### Approach C — Review-only slice

Ship just the review UI; settings/scheduling come later. Pros: smallest scope. Cons: doesn't solve the "configure once" pain the user called out first; `/run` form stays in place meanwhile. Rejected — the settings pain is the larger one.

**Recommendation:** Approach B. Two SPECs, two PRs, same design doc.

## Chosen Approach

Two-phase delivery per Approach B. One design doc (this file), two SPECs (`settings-scheduling` and `review-curation`), shipped as two PRs.

## High-Level Design

### Data model changes (Drizzle)

**New table `user_settings`** (singleton):
- `id` (uuid PK), `singleton` (boolean, unique, default true)
- `profileName` (text, nullable)
- `topN` (int)
- `halfLifeHours` (int, nullable)
- `hnConfig` (jsonb, nullable)
- `redditConfig` (jsonb, nullable)
- `webConfig` (jsonb, nullable)
- `scheduleTime` (text, e.g. "07:00")
- `scheduleTimezone` (text, IANA, e.g. "Asia/Kolkata")
- `scheduleEnabled` (boolean)
- `updatedAt` (timestamptz)

**`run_archives` additions:**
- `reviewed` (boolean, default false, NOT NULL)
- Backfill migration: set existing rows to `reviewed = true`.

**`raw_items` additions:**
- `metadata.addedInReview` (boolean, optional) — marks items inserted via the add-post flow so telemetry can tell them apart. No schema column needed; metadata jsonb already exists.

### Backend surfaces

**Settings service (`packages/api`)**
- `GET /api/settings` → current row or null
- `PUT /api/settings` → upsert the singleton row, then reconcile the scheduler
- Scheduler reconciliation helper (lives in a shared location importable by API and pipeline) — given settings, calls BullMQ to remove + re-add the `daily-run` repeatable with cron derived from `scheduleTime` + `scheduleTimezone`

**Run-start service**
- Extracted from the current POST /api/runs handler: takes a RunSubmitPayload-shaped object, creates the Redis RunState, enqueues the `run-process` job, returns `runId`.
- Used by: `POST /api/runs/now` (the "Run now" button — reads settings, calls the service) AND the pipeline's repeatable daily-run processor.

**Pipeline `daily-run` processor**
- Reads settings via shared repo, calls the run-start service.

**Dashboard data**
- `GET /api/runs?limit=N` → list of `run_archives` rows projected to `{ runId, startedAt, completedAt, status, itemCount, reviewed }`.

**Review endpoints (Phase 2)**
- `PATCH /api/archives/:runId` → body `{ rankedItems: RankedItemLite[] }` (ids + order). Validates all ids exist in `raw_items`. Overwrites `rankedItems` jsonb, flips `reviewed = true`, updates `updatedAt`.
- `POST /api/archives/:runId/add-post` → body `{ sourceType: "hn"|"reddit"|"web", url }`. Fetches the post, generates recap, upserts into `raw_items`, returns the hydrated `RankedItem` (not yet persisted to the archive — client holds it until Save).

### Frontend surfaces

**Stack additions**
- `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`
- shadcn/ui primitives (button, input, form, select, switch, card, table, dialog, toast)
- `lucide-react`
- `cn()` helper + Tailwind merge

**Routes**
- `/` — Dashboard (runs table, Run Now, Settings link)
- `/settings` — Settings form
- `/review/:runId` — Review page (Phase 2)
- `/archive/:runId` — unchanged
- `/run` — redirect to `/settings` (legacy URL)

**Dashboard**
- Header: app name, Run Now button (disabled when a run is already running), Settings link
- Table of recent runs (date, status badge, item count, action)
- Empty state: "Configure your newsletter" CTA to /settings
- Polls latest run status while any run is active

**Settings page**
- Sectioned form: Profile / Sources (HN, Reddit, Web — each a collapsible fieldset with toggle) / Ranking (topN, halfLifeHours) / Schedule (time picker + timezone select + enabled switch)
- Save button at bottom; shows toast on success
- Uses RHF + zod resolver (zod schema shared with the API validator)

**Review page** (Phase 2)
- Top panel: "Add a post" — source-type tabs (HN / Reddit / Web), URL input, Add button. On submit, shows a pending row with spinner; on resolve, row turns into a full ranked item card; on error, inline message.
- Main list: sortable via @dnd-kit, each item a card with drag handle / thumbnail / title / source / rationale / delete button.
- Bottom bar: "Save & View Archive" button (disabled if list empty); discard-changes navigation guard.

### Phasing (implementation order)

**Phase 1 PR — settings + scheduling + dashboard**
1. Drizzle migration: add `user_settings` + backfill `run_archives.reviewed = true`.
2. API: `GET/PUT /api/settings`, `POST /api/runs/now`, `GET /api/runs`.
3. Scheduler reconciliation helper + pipeline `daily-run` processor.
4. Extract run-start service from current POST /api/runs.
5. Install shadcn/ui + lucide-react. Scaffold base components.
6. Frontend: Dashboard + Settings routes; retire /run form.

**Phase 2 PR — review + curation**
1. API: `PATCH /api/archives/:runId`, `POST /api/archives/:runId/add-post`.
2. Single-post fetcher helpers (HN by id, Reddit post JSON, web direct-URL).
3. Shared recap-generation path reused for added posts.
4. @dnd-kit install + Review route + unsaved-changes guard.
5. Dashboard CTA routing: unreviewed → /review/:runId, reviewed → /archive/:runId.

## Open Questions

1. **Timezone source for the scheduler UI** — ship a static curated list of IANA zones or use the browser's `Intl.supportedValuesOf('timeZone')`? Default to the latter with a fallback list.
2. **Dashboard pagination** — cap at last 30 runs for MVP, or paginate? Start uncapped + ordered DESC; revisit if it matters.
3. **Revert-to-original in review** — user didn't ask; leaving out. Archive's original `rankedItems` is overwritten on Save. If this matters later, add an `original_ranked_items` jsonb snapshot column.
4. **Run-now concurrency** — do we block a second Run Now while one is in progress? Design: UI-side disable based on latest run status; backend allows both (cheap).
5. **Toast vs inline error** for add-post failures — going with inline next to the add form; toast only for cross-page successes (Save).

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Repeatable job reconciliation leaks duplicate schedules | Duplicate runs daily | Use a deterministic `repeatJobKey`; always `removeRepeatableByKey` before `add` |
| Timezone/DST handling wrong | Run fires at wrong hour | Rely on BullMQ `tz` option (well-tested); write a test that asserts a known cron+tz -> correct UTC fire time; manual smoke across a DST boundary before ship |
| Adding a post via web URL hits the same failure modes as the web collector (timeouts, paywalls) | User-visible error in review | Inline error with retry; reuse existing collector timeout/retry config |
| shadcn/ui + Tailwind 4 compatibility | UI broken | Tailwind 4 is supported by current shadcn (`tailwindcss-animate` optional); verify on scaffold. Keep shadcn copies minimal — don't pull the whole set |
| `run_archives` schema change breaks the archive route | Archive page 500s | Drizzle migration + backfill shipped before API deploy; archive route already tolerates reading `rankedItems` as jsonb |
| Settings singleton enforcement bypassed | Multiple rows confuse reads | Unique index on `singleton` column + repo helper always `upsert`s the fixed row |
| Added post via HN but URL is a top-level "thread" not a post | Fetcher returns empty | Validate extracted id + post type before upsert; surface "not a valid HN post URL" inline |

## Assumptions

1. Single-user, internal tool — no auth additions needed beyond what exists today.
2. The existing recap-generation path (Vercel AI SDK + Claude Haiku) is idempotent enough to call for a single added post without re-running it for the whole list.
3. Web collector's single-URL path (Jina + LLM) can be invoked directly on a blog post URL, bypassing the listing discovery step.
4. BullMQ repeatable + `tz` is the right primitive; no need for a separate cron daemon.
5. Tailwind 4 + shadcn/ui coexist in this repo's Vite + Tailwind 4 setup.
6. Archive page (`/archive/:runId`) renders identically when it reads a curated vs. original `rankedItems` array — no additional UI distinction required.
7. Backfilling `reviewed = true` for existing archives is acceptable; users don't expect historical runs to prompt for review.
