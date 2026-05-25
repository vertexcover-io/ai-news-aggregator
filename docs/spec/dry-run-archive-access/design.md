# Design: Dry-Run Archive — Hidden from Listing, Accessible by Direct Link

**Spec:** `dry-run-archive-access`
**Type:** Bug fix + intentional behavior change
**Date:** 2026-05-25

## Problem

Clicking "View Archive" for a **dry-run** newsletter on the admin dashboard navigates to the public
`/archive/:runId` page, which fails to load ("Couldn't load this issue"). The public single-archive API
route `GET /api/archives/:runId` returns **404** for any archive with `is_dry_run = true`.

The user wants two things:
1. Dry-run newsletters must **not appear in the public archive listing** (`/` and `GET /api/archives`).
2. A dry-run newsletter **must be accessible via its direct link** (`/archive/:runId`) with **no auth**.

The current code satisfies (1) but actively breaks (2): the public detail route 404s dry runs on purpose
(test `R-14`: "avoids leaking existence"). This intentional guard is what makes "View Archive" fail.

## Current behavior (verified)

- **Schema** `packages/shared/src/db/schema.ts:52` — `run_archives.is_dry_run boolean NOT NULL DEFAULT false`.
- **Listing** `GET /api/archives` → `run-archives.ts::listReviewed()` WHERE `reviewed = true AND is_dry_run = false`.
  Search (`searchReviewed`) and `findLatestReviewedSince` also filter `is_dry_run = false`. **(correct — keep)**
- **Detail** `GET /api/archives/:runId` (`packages/api/src/routes/archives.ts`):
  - `!archive` → 404
  - `!archive.reviewed` → 404
  - `archive.isDryRun` → 404  ← **this is the bug for the user's intent**
- **Admin detail** `GET /api/admin/archives/:runId` — no dry-run guard (admins can already view).
- **Frontend** `ArchivePage.tsx` uses `useArchive(runId)`; on API error renders "Couldn't load this issue".
  Non-`completed` archives render a "This issue isn't ready yet" state.
- **"View Archive" button** `RunsTable.tsx` / `RunsCardList.tsx` — shown when `derived === "reviewed"`
  (i.e. `run.reviewed === true`), with **no** `isDryRun` consideration. Links to `/archive/:runId`.

## Decision (from user)

1. **Public access:** `GET /api/archives/:runId` returns **200** for a dry-run archive that is `reviewed`.
   Remove the `if (archive.isDryRun) → 404` guard. This overrides test `R-14`, which will be updated.
2. **View criteria:** A dry run must be **`completed` AND `reviewed`** to be viewable via the direct link
   — identical contract to live archives. Un-reviewed or non-completed dry runs still 404 (`!reviewed`)
   or render the "not ready yet" state (non-completed), exactly as live archives do.
3. **Listing stays hidden:** No change to `listReviewed` / `searchReviewed` / `findLatestReviewedSince`.
   Dry runs never appear in the public listing or search results.

### Consequence for the "View Archive" button
Because reviewed dry runs now load, the existing "View Archive" button is **correct as-is** — it links to a
page that now works. **No frontend button-gating change is required.** (We are intentionally *enabling* the
link, not hiding it.) The button only shows for `reviewed` runs, and reviewed dry runs are now viewable.

### Security / leakage note
The original 404 guard existed to "avoid leaking existence" of dry runs. The user has explicitly accepted
public access by direct link (the runId is a UUID — unguessable). Dry runs remain absent from every public
*listing/search* surface, so the only way to reach one is to already hold its UUID link. This is the
accepted trade-off.

## Scope of change

| File | Change |
|------|--------|
| `packages/api/src/routes/archives.ts` | Remove the `if (archive.isDryRun) return 404` line in the **public** `GET /:runId` handler. Keep `!archive` and `!archive.reviewed` 404s. Admin route unchanged. |
| `packages/api/tests/unit/archives-route.test.ts` | Update `R-14` dry-run test: reviewed dry run now expects **200** (not 404). Add a test: **un-reviewed** dry run still 404. Keep the listing-hidden assertion. Keep live-archive regression. |
| (verify, likely no change) `run-archives.ts` listing methods | Confirm `is_dry_run = false` filter remains on `listReviewed` / `searchReviewed` / `findLatestReviewedSince`. |

**Out of scope:** schema changes, admin route changes, frontend component changes, the listing/search SQL.

## External Dependencies & Fallback Chain

**None.** This change uses only existing in-repo code (Hono route handler, Drizzle repo already in place,
Vitest already configured). No new external library, API, or SDK is introduced.

- Primary: existing Hono + Drizzle + Vitest stack — already verified working by the baseline.
- Fallback: N/A (no new dependency to fall back from).

## Verification plan

1. **API unit (Vitest):** reviewed dry run → 200 with archive body; un-reviewed dry run → 404; live archive
   → 200 (regression); listing excludes the dry run.
2. **E2E / functional (Playwright MCP):** seed a reviewed dry-run archive, navigate to `/archive/:runId`
   with no auth cookie → page renders the digest (not the error state); confirm `/` listing does not show it.
3. Full `pnpm typecheck && pnpm lint && pnpm test:unit` stays green vs baseline.
