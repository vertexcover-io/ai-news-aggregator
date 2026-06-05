# Design: Newsletter date reflects publish date, not pipeline-run date

**Spec name:** `publishedat-newsletter-date`
**Status:** Design (brainstorm output)
**Date:** 2026-05-25

## Problem Statement

The date shown for a newsletter issue in the UI is currently derived from **when the
pipeline ran** (`run_archives.completedAt`, or `startedAt ?? completedAt` for the detail
view), not **when the digest is published**. Because the pipeline typically runs late at
night and the digest is emailed/posted the next morning at the user's scheduled
`emailTime`, the displayed date is off — it shows the run day rather than the publish day.

Concretely: the operator runs the pipeline tonight (e.g. 23:00). It is scheduled to
publish tomorrow morning (e.g. 06:00). The issue should be dated **tomorrow** (its publish
day), but the UI shows tonight's date.

## Context

Current date flow (verified against the codebase):

- **DB:** `run_archives` has `completedAt`, `startedAt`, `createdAt` plus actual-send
  timestamps (`emailSentAt`, `linkedinPostedAt`, `twitterPostedAt`). There is **no**
  column for the intended/scheduled publish date.
  (`packages/shared/src/db/schema.ts:46-71`)
- **API listing** (`GET /api/archives`, search): `toArchiveListItem` sets
  `runDate = formatDateInTimezone(r.completedAt, timezone)`.
  (`packages/api/src/repositories/run-archives.ts:773-788`); ordered
  `ORDER BY completedAt DESC` (`:337-354`, search `:412`).
- **API detail** (`GET /api/archives/:runId`): `issueDate = getIssueDate(archive, tz)` which
  is `formatDateInTimezone(startedAt ?? completedAt, tz)`.
  (`packages/api/src/routes/archives.ts:72,107-108`)
- **Web:** listing date block reads `ArchiveListItem.runDate`
  (`ArchiveRow.tsx:26-44`); issue number is `recentIssues.length - idx` over a
  newest-first list (`HomePage.tsx:85-91`); admin dashboard reads the same `RunState`
  date fields.
- **Pipeline finalize (success):** `run-process.ts:787-803` upserts the `run_archives` row.
  User settings are already loaded earlier in the same scope
  (`run-process.ts:654-656`), so `settings.emailTime`, `settings.pipelineTime`, and
  `settings.scheduleTimezone` are all in hand at finalize time.
- **Existing helper (key reuse):** `publishDateForWindow(input)` in
  `packages/shared/src/scheduling/tz.ts:102-121` already computes exactly the desired
  value — the next occurrence of `publishTime` in the timezone, advancing one local day
  when `publishTime < pipelineTime`. **Caveat:** it `throw`s when
  `publishTime === pipelineTime`.
- **Highest migration:** `0030_common_thunderbird.sql` → next is `0031`.

## Requirements

### Functional

- **FR1:** Add a nullable `published_at` (timestamptz) column to `run_archives`.
- **FR2:** On a **successful** run finalize, compute the scheduled publish datetime from
  the user's settings (`emailTime` as publishTime, `pipelineTime`, `scheduleTimezone`)
  relative to the run's `completedAt`, using the existing `publishDateForWindow` helper,
  and write it to `published_at`.
- **FR3:** The UI/API must display the **publish date** derived from `published_at` when
  present, falling back to the current `completedAt` (listing) / `startedAt ?? completedAt`
  (detail) behavior when `published_at` is NULL.
- **FR4:** Switch the affected surfaces to the publish date:
  - Public archive listing `/` (date block **and** month grouping).
  - Public archive detail `/archive/:runId` (`issueDate`).
  - Admin dashboard `/admin` run rows.
  - Issue-number ordering — list ordering keys off the publish date when available.

### Non-functional

- **NFR1:** Backwards compatible. No backfill. Archives created before this change
  (`published_at IS NULL`) and runs where the schedule cannot produce a publish time fall
  back to existing behavior. No visible regression for old archives.
- **NFR2:** Pure-internal feature — no new external dependency, no new env var.
- **NFR3:** TypeScript strict (no `any`, explicit return types), repository-pattern
  boundaries preserved (only `@newsletter/shared` defines tables; web talks to API only).
- **NFR4:** The publish-date computation must be a single shared function so the pipeline
  (writer) and any fallback logic agree.

### Edge cases (actively considered)

- **EC1 — `publishTime === pipelineTime`:** `publishDateForWindow` throws. Finalize must
  guard this: if email/pipeline times are equal (or `emailTime` is otherwise unusable),
  leave `published_at` NULL and fall back. The finalize path must never let this throw
  abort the run archive write.
- **EC2 — run finishes before emailTime same day:** e.g. completes 03:00, emailTime 06:00,
  pipelineTime 23:00. `publishMinutes(360) >= pipelineMinutes(1380)` is false, so the
  helper adds a local day → publishes next day. Confirmed this is the intended "next
  occurrence after the run" semantics for the late-night→next-morning case. (The helper
  keys the day off `completedAt`'s local date, not "now".)
- **EC3 — schedule disabled / settings missing:** finalize has `settings` possibly null;
  if null or fields missing, leave `published_at` NULL and fall back.
- **EC4 — failed/cancelled runs:** these are not displayed as published issues; do **not**
  compute `published_at` for them (leave NULL). Only the success finalize sets it.
- **EC5 — dry-run archives:** excluded from the public listing already; computing
  `published_at` is harmless but unnecessary. Keep behavior consistent with success path
  (may set it; it is filtered out of listings anyway).
- **EC6 — month grouping / ordering coherence:** the date used for the month-group header
  and the date used to sort/number issues must be the **same** date (publish date with
  fallback), or an issue could appear under a month header that doesn't match its row date.
- **EC7 — timezone DST:** `publishDateForWindow` already handles DST via its
  formatter-reconciliation loop; reuse it, don't reimplement.

## Key Insights

1. **The hard part is already built.** `publishDateForWindow` implements precisely the
   "next occurrence of publishTime, +1 day if before pipelineTime" rule the user wants,
   with DST handling and unit semantics. The feature is mostly: add a column, call this
   function at finalize, thread the value through API DTO → web.
2. **Store, don't recompute per-request.** The user chose a stored `published_at` column
   (set at finalize) over on-the-fly API computation. This captures the schedule *as it
   was* at run time and survives later settings changes — and matches the explicit ask.
3. **Fallback is a display concern, not a write concern.** Old rows stay NULL; the
   *display* layer (API serialization + ordering) decides what to show. A single
   `COALESCE(published_at, completedAt)` style fallback at the SQL/serialization boundary
   keeps the change localized.
4. **Ordering + grouping must use the same effective date** to stay coherent (EC6).

## Architectural Challenges

- **Where ordering happens:** ordering is SQL-side (`ORDER BY completedAt DESC`). To order
  by effective publish date, the query orders by `COALESCE(published_at, completed_at)
  DESC`. Issue numbering is derived from list position client-side, so once the list is
  ordered by effective date, numbering follows automatically.
- **Two repos mirror each other** (pipeline writer + API reader for `run_archives`). The
  writer (pipeline) gains a `publishedAt` input + column; the reader (API) gains the column
  read + serialization. Keep both in sync (a known project pattern).
- **DTO surface:** the listing item already exposes `runDate`; the cleanest change is to
  make `runDate` *mean* the effective publish date (publish-with-fallback) so no web
  component needs a new field — the date block and month grouping already read `runDate`.
  Similarly the detail `issueDate` becomes publish-with-fallback. This minimizes web churn.

## Approaches Considered

### Approach A — Stored `published_at` column, set at finalize, effective-date at display (CHOSEN)

- Add `run_archives.published_at` (nullable timestamptz), migration `0031`.
- Pipeline success finalize computes via `publishDateForWindow` (guarded for EC1/EC3) and
  writes it.
- API listing/search order by `COALESCE(published_at, completed_at) DESC` and set
  `runDate = formatDateInTimezone(published_at ?? completedAt, tz)`.
- API detail sets `issueDate = formatDateInTimezone(published_at ?? startedAt ?? completedAt, tz)`.
- Web reads existing `runDate` / `issueDate` — no structural web change beyond it now
  carrying the publish date; month grouping already groups by `runDate`.
- **Trade-off:** small DB migration + two-repo edit; captures schedule at run time;
  matches the explicit ask. Backwards compatible by NULL fallback.

### Approach B — Compute publish date on-the-fly in API (no column)

- API derives publish date each request from `completedAt` + current `emailTime`.
- **Rejected:** the user explicitly asked for a `published_at` column; on-the-fly
  recomputation uses *current* settings (wrong for historical issues if schedule changed)
  and can't be ordered efficiently without recomputing per row.

### Approach C — Reuse `emailSentAt` as the displayed date

- **Rejected:** NULL until the email worker actually fires; reviewed-but-unsent archives
  would have no date. The user chose the *scheduled* publish date, available at finalize.

## Chosen Approach

**Approach A.** Add `published_at`, populate at success finalize using the existing
`publishDateForWindow` helper (guarded), and make the display layer use
publish-date-with-fallback for the date block, month grouping, detail issue date, admin
rows, and list ordering/numbering.

## High-Level Design

```
Pipeline (run-process success finalize)
  settings = {emailTime, pipelineTime, scheduleTimezone}  (already loaded)
  publishedAt =
     guard(settings present & emailTime != pipelineTime)
       ? publishDateForWindow({timezone, pipelineTime, publishTime: emailTime, completedAt})
       : null
  archiveRepo.upsert({ ..., publishedAt })           # new optional input + column

shared
  schema.ts: run_archives.published_at  timestamptz null
  migration 0031_*.sql: ALTER TABLE ... ADD COLUMN published_at
  (reuse) scheduling/tz.ts: publishDateForWindow  — unchanged

API (read side)
  repositories/run-archives.ts:
    SELECT ... published_at
    ORDER BY COALESCE(published_at, completed_at) DESC   # listing + search no-query
    toArchiveListItem: runDate = formatDateInTimezone(published_at ?? completedAt, tz)
  routes/archives.ts:
    getIssueDate: published_at ?? startedAt ?? completedAt
    (optionally expose publishedAt in RunState for admin dashboard)

Web (display)
  ArchiveRow / HomePage month grouping: unchanged — read runDate (now = publish date)
  Archive detail: unchanged — reads issueDate (now = publish date)
  Admin dashboard rows: read the effective date field
```

## Open Questions

- **Admin dashboard field:** the admin dashboard consumes `RunState`. Decide whether to
  surface `publishedAt` as a distinct field on `RunState` or reuse `issueDate`. Leaning
  toward exposing `issueDate` already-effective + an explicit `publishedAt` (nullable) for
  clarity, to be settled in planning. Non-blocking.

## Risks and Mitigations

- **R1 — `publishDateForWindow` throws on equal times (EC1).** *Mitigation:* guard before
  calling; never let it abort the archive write. Explicit unit test for equal-times → NULL.
- **R2 — Ordering/grouping incoherence (EC6).** *Mitigation:* both ordering and the date
  block/month-group read the same effective date (`published_at ?? completed_at`). Test a
  mixed set (some rows with `published_at`, some NULL) renders coherently.
- **R3 — Two-repo drift (writer vs reader).** *Mitigation:* edit both in the same phase;
  e2e test asserts a finalized run's `published_at` round-trips into the API DTO.
- **R4 — Old-archive regression.** *Mitigation:* NULL fallback; test old archive (NULL)
  still shows `completedAt`-based date and sorts correctly relative to new rows.

## Assumptions

- `emailTime` is the canonical "publish time" for the displayed date (the digest is an
  email-first product; LinkedIn/Twitter times are secondary). Confirmed by the user's
  framing ("scheduled to be published").
- No historical backfill is required (user chose fallback over backfill).
- The web does not need a brand-new visible field; making `runDate`/`issueDate` mean the
  effective publish date is acceptable and preferred for minimal churn.

## External Dependencies & Fallback Chain

None — pure-internal feature. Reuses the existing in-repo `publishDateForWindow`
(`@newsletter/shared` scheduling util) and Drizzle/Postgres already in the stack. No new
library, API, env var, or credential. Library-probe is **NOT_APPLICABLE**.
