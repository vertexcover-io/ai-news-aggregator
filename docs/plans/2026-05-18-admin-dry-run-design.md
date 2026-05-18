# Admin Dry-Run Pipeline — Design Doc

**Date:** 2026-05-18
**Owner:** Aman
**Linear:** TBD
**Spec dir:** `docs/spec/admin-dry-run-pipeline/`

## Problem

Today every admin-triggered run leads, eventually, to real external side-effects:
the per-archive scheduler enqueues `email-send` (subscriber email via Resend),
`linkedin-post` (auto-share to LinkedIn), and `twitter-post` (auto-tweet) jobs
once the archive is reviewed. There is no safe way for an admin to exercise the
*whole* pipeline end-to-end (collect → enrich → dedup → rank → recap → archive →
review UI) without risking those external sends. This makes it scary to:

- validate prompt/ranking changes against real recent data,
- demo the system,
- shake out a new source integration,
- reproduce a production bug that only manifests with live scraping.

We want a **dry-run mode**: same pipeline, no external sends.

## Goal

Admin can click **Run now → Dry run** on the dashboard and produce a run that:
1. Goes through the *full* collection, enrichment, ranking, recap, and archive
   stages identically to a normal run.
2. Is persisted as a `run_archives` row tagged `is_dry_run = true`.
3. **Never** enqueues `email-send`, `linkedin-post`, or `twitter-post` jobs —
   not at archive completion, not at review completion, not on settings change.
4. Is **not** visible on the public archive listing (`/` route) or via the
   public `GET /api/archives` / `GET /api/archives/search` endpoints.
5. Is **not** reachable via the public `GET /api/archives/:runId` route
   (returns 404 for non-admins).
6. Remains fully visible on `/admin` (with a "DRY RUN" badge) and reachable via
   `/admin/review/:runId` so the admin can inspect what would have shipped.

## Non-Goals

- No persistent default-dry-run setting in `/admin/settings`. Dry-run is a
  one-off per-invocation choice (user explicitly picked this).
- No "send to admin only" preview mode (user explicitly rejected this).
- No dry-run for daily *scheduled* runs (BullMQ `daily-run` repeatable job) —
  scheduled runs are always live. Dry-run is admin-triggered only.
- No promotion path from dry-run → real run. If the admin likes a dry-run
  result, they re-run live; the dry-run archive is for inspection only.
- No backfill / migration of historical archives (all existing rows are real).

## Current architecture (relevant slice)

```
┌────────────────────────────────────────────────────────────────────────┐
│ Frontend: DashboardPage "Run now" button                               │
│   → POST /api/runs/now                                                 │
└────────────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────────────────────┐
│ packages/api/src/routes/runs.ts:88   runs.post("/now")                 │
│   - loads UserSettings                                                  │
│   - calls shared startRun(settings, { redis, queue })                  │
│   - returns 202 { runId }                                              │
└────────────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────────────────────┐
│ packages/shared/src/run-start.ts   startRun()                           │
│   - allocates runId, writes RunState to Redis                          │
│   - enqueues "run-process" job into "processing" queue with payload    │
│     RunProcessJobPayload { runId, topN, sourceTypes, collectors, ... } │
└────────────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────────────────────┐
│ packages/pipeline/src/workers/processing.ts  Worker                     │
│   - case "run-process": handleRunProcessJob(deps, job)                 │
│     (collectors → enrich → dedup → rank → recap → write run_archive)   │
│     ... at the end, calls reconcilePerArchiveJobs() to schedule        │
│     email-send / linkedin-post / twitter-post jobs.                    │
└────────────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────────────────────┐
│ packages/pipeline/src/services/per-archive-schedule.ts                 │
│   reconcilePerArchiveJobs(settings, archive, deps)                     │
│     - enabledPublishTargets() decides which channels to enqueue        │
│     - queue.add("email-send" | "linkedin-post" | "twitter-post", ...)  │
└────────────────────────────────────────────────────────────────────────┘
```

Same `reconcilePerArchiveJobs` is also called from
`packages/api/src/services/per-archive-schedule.ts` (mirror copy) when:
- the admin saves the review (`PATCH /api/admin/archives/:runId` in
  `routes/archives.ts:179`), and
- the admin changes scheduling settings (`routes/settings.ts:27`).

There is a single chokepoint: **`reconcilePerArchiveJobs`**. If a dry-run
archive is filtered out there, no send job is ever enqueued — from any call
site.

## Design

### Data model

Add a single boolean column to `run_archives`:

```sql
ALTER TABLE run_archives
  ADD COLUMN is_dry_run boolean NOT NULL DEFAULT false;
```

- Nullable? No. Existing rows backfill to `false` (every existing archive was
  real). New live runs explicitly insert `false`. Dry-runs explicitly insert
  `true`.
- Index? No — cardinality is low and every public query already filters by
  `reviewed = true`; the additional `AND is_dry_run = false` adds nothing
  meaningful at our scale (single-digit archives/day). Revisit if archive count
  exceeds 10k.

### API surface

**Modify `POST /api/runs/now`** to accept an optional JSON body:

```jsonc
// no body, or:
{ "dryRun": false }   // → live run (current behavior)
{ "dryRun": true }    // → dry run
```

- Default when body absent or `dryRun` omitted: `false` (zero-risk default for
  any existing caller / curl / cron hitting the endpoint).
- Response unchanged: `202 { runId }`.

**Propagate `dryRun` to the worker** via `RunProcessJobPayload`:

```ts
interface RunProcessJobPayload {
  runId: string;
  topN: number;
  sourceTypes: SourceType[];
  collectors: { ... };
  halfLifeHours?: number;
  dryRun?: boolean;  // NEW. Default false.
}
```

`shared/run-start.ts:startRun()` gains a `dryRun?: boolean` option and writes it
into the job payload (and onto the `RunState` so the UI can show "DRY RUN" mid-
flight if useful).

**Persist on archive completion.** `handleRunProcessJob` already builds the
`run_archives` insert. It will read `job.data.dryRun ?? false` and write it to
the `is_dry_run` column.

**Gate the scheduler.** `reconcilePerArchiveJobs` gains an early return:

```ts
export async function reconcilePerArchiveJobs(
  settings: UserSettings,
  archive: ArchiveForSchedule,  // gains: readonly isDryRun: boolean
  deps: ReconcilePerArchiveDeps,
): Promise<ReconcilePerArchiveResult> {
  if (archive.isDryRun) {
    logger.info(
      { event: "publish.skipped_dry_run", runId: archive.id },
      "dry-run archive — skipping email/linkedin/twitter scheduling",
    );
    return { removed: [], enqueued: [] };
  }
  // ... existing logic
}
```

- `ArchiveForSchedule` is the narrow input interface used by both pipeline and
  api copies of the schedule service; we add `isDryRun` to it.
- The `ArchiveListItem`-equivalent rows passed in from API call sites
  (review PATCH, settings save) must also carry `isDryRun`. The
  `RunArchivesRepo.findById()` / list methods will hydrate it from the new
  column.

This single guard catches **all three call sites** (pipeline run-process,
review PATCH, settings change).

### Public listing & route gating

**API:**

| Route | Change |
|-------|--------|
| `GET /api/archives` (`listReviewed`) | Add `AND is_dry_run = false` to the SQL WHERE clause. |
| `GET /api/archives/search` (`searchReviewed`) | Same — both the no-query and FTS branches. |
| `GET /api/archives/:runId` (public) | After `findById`, return 404 if `archive.isDryRun === true`. (Use 404 rather than 403 to avoid leaking existence to anonymous probes.) |
| `GET /api/admin/runs` (admin list) | **No change** — dry-runs are visible to admin. |
| Admin per-run views (`/api/admin/runs/:runId/sources`, etc.) | **No change**. |

**Frontend:**

| Surface | Change |
|---------|--------|
| Public listing `/` (`PublicArchivesPage`) | No client change needed — server already filters dry-runs out. |
| Public archive page `/archive/:runId` | No client change needed — server 404s. |
| Admin dashboard `/admin` (recent runs) | Add a small "DRY RUN" badge next to dry-run rows. |
| Admin review page `/admin/review/:runId` | Add a "DRY RUN" header pill so admin can't confuse a dry-run review session with a live one. |
| Run-now button | Replace single button with a small **dropdown menu**: primary action "Run now" (live), secondary "Run now (dry run)". Keyboard-accessible via the existing shadcn `DropdownMenu` already used elsewhere. |

### Why a dropdown rather than a separate button

User picked "Toggle on Run Now button" (not "separate Dry Run button"). A
dropdown keeps the dashboard chrome compact and makes the live path the visible
default — accidental clicks land on the safe-feeling primary action, and
choosing dry-run requires an extra deliberate click on the chevron. A standalone
checkbox modal would add unnecessary friction for the common case.

### Logging & observability

Every skipped external action logs `event: "publish.skipped_dry_run"` with
`runId` and intended `channel` (when we know which channel was about to be
scheduled). This gives us a one-grep trail to confirm "would have sent" without
actually sending.

We do **not** post a Slack notification for dry-runs (the review-complete Slack
notifier already keys on `slackNotifiedAt`; we extend its guard to also skip
when `isDryRun = true`). Same reasoning: a dry-run shouldn't page anyone.

### Backwards compatibility

- Migration adds a column with `DEFAULT false NOT NULL` — existing rows fill in
  cleanly. No data backfill needed.
- `POST /api/runs/now` body is optional and defaults to `dryRun: false`. Any
  existing caller (curl, cron, tests, the current frontend before this PR)
  continues to produce live runs.
- `RunProcessJobPayload.dryRun` is optional with a `false` default — any job
  already enqueued before this deploy is treated as live.
- `reconcilePerArchiveJobs` input gains `isDryRun: boolean` — call sites must
  pass it. Existing call sites already hydrate from `RunArchivesRepo.findById`,
  so the repo just needs to read the new column.

## Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Admin clicks "Dry run" expecting a real run, dry-run silently swallows the publish. | Visible "DRY RUN" badge on dashboard row, header pill on review page, dropdown shows live as primary. |
| Future call site to `reconcilePerArchiveJobs` forgets the dry-run guard. | Guard lives **inside** `reconcilePerArchiveJobs` itself — single point of enforcement. Add a unit test asserting it returns `{ removed: [], enqueued: [] }` when `archive.isDryRun = true`. |
| A bug elsewhere bypasses the scheduler and enqueues `email-send` directly. | Add a defensive check inside each of `email-send`, `linkedin-post`, `twitter-post` worker handlers: load the archive, if `isDryRun` true, log `event: "publish.dry_run_bypassed"` and return without sending. This is a belt-and-braces guard. |
| Dry-run row leaks into FTS index (`search_text`). | `searchReviewed` adds the `is_dry_run = false` filter on the SQL side; the FTS column itself can still be populated, but it's not indexed by `is_dry_run` and the WHERE clause prevents leakage. |
| `RunArchivesRepo.listForAdmin` / dashboard count gets noisy with dry-runs. | Admin dashboard lists *all* runs (this is intentional — the admin must see their dry-runs). Counts for "issues published" should already key off `emailSentAt`/`linkedinPostedAt`/`twitterPostedAt`, which dry-runs never set; verify in implementation. |

## External Dependencies & Fallback Chain

This feature uses **no new external libraries, APIs, or services**.

All work is internal:
- Drizzle schema migration (already in stack)
- Existing BullMQ queues (no new queues)
- Existing Resend/LinkedIn/X integrations (suppressed, not invoked)
- shadcn/ui `DropdownMenu` (already in `packages/web/src/components/ui/`)

**Library probe verdict:** `NOT_APPLICABLE` — nothing new to verify.

## Verification scenarios (preview — spec.md will formalize)

1. **VS-1: Live run unchanged.** `POST /api/runs/now` with no body → run completes, archive created with `is_dry_run = false`, after review the email/linkedin/twitter jobs are enqueued exactly as today.
2. **VS-2: Dry run end-to-end.** `POST /api/runs/now { "dryRun": true }` → run completes, archive has `is_dry_run = true`, **no** publish jobs are enqueued at any point (verified by inspecting BullMQ queue state and by log assertion on `publish.skipped_dry_run`).
3. **VS-3: Public listing excludes dry-runs.** Two reviewed archives in DB (one live, one dry); `GET /api/archives` returns only the live one. Same for `/api/archives/search?q=...`.
4. **VS-4: Public per-archive 404 for dry-run.** `GET /api/archives/<dry-run-id>` returns 404.
5. **VS-5: Admin sees both.** `GET /api/runs?limit=10` (admin route) returns both archives. `/admin` dashboard renders a "DRY RUN" badge on the dry-run row.
6. **VS-6: Review of a dry-run does not enqueue publishes.** `PATCH /api/admin/archives/<dry-run-id>` with reorder/edits → 200, archive marked reviewed, **no** publish jobs enqueued, no Slack review notification posted.
7. **VS-7: Defensive worker guard.** Manually enqueue an `email-send` job for a dry-run archive (simulating a bug) → handler returns without sending and logs `publish.dry_run_bypassed`.
8. **VS-8: Dashboard UI.** Click the "Run now" dropdown → primary action "Run now" still triggers live; secondary "Run now (dry run)" sets the `dryRun: true` body. Cancel and active-run state behave identically.

## Out of scope (future work)

- A persistent "default to dry-run" toggle in `/admin/settings` (could be added
  later with a `userSettings.defaultDryRun` boolean if we find ourselves doing
  dry-runs frequently).
- A "promote dry-run → live publish" action (currently the admin re-runs).
- Surfacing a dry-run count in any metrics/PostHog dashboard.
- Marking historical real archives as dry-runs (no need; the column defaults
  correctly).
