# Plan: Dry-Run Archive — Hidden from Listing, Accessible by Direct Link

> **Source:** docs/spec/dry-run-archive-access/spec.md
> **Created:** 2026-05-25
> **Status:** planning

## Goal

Make a reviewed, completed **dry-run** archive viewable via its public direct link
(`/archive/:runId`, no auth) while keeping it out of the public listing and search.

## Acceptance Criteria

- [ ] `GET /api/archives/:runId` returns 200 for a reviewed dry-run archive (REQ-001).
- [ ] `GET /api/archives/:runId` returns 404 for an un-reviewed dry-run archive (REQ-002).
- [ ] `GET /api/archives` and `/api/archives/search` still exclude dry runs (REQ-003, REQ-004).
- [ ] Live reviewed archives and the admin route are unchanged (REQ-005).
- [ ] The public `/archive/:runId` page renders the digest for a dry run with no auth (REQ-006).
- [ ] `pnpm typecheck && pnpm lint && pnpm test:unit` stay green vs baseline.

## Codebase Context

### Existing Patterns to Follow
- **Public archive detail route**: `packages/api/src/routes/archives.ts:88-134` (`createPublicArchivesRouter`).
  The three sequential 404 guards are at lines 92 (`!archive`), 93 (`!archive.reviewed`), 94 (`archive.isDryRun`).
  **The fix is removing line 94.** Admin router below (`:143`) has no dry-run guard — keep it that way.
- **Listing/search filters (keep verbatim)**: `packages/api/src/repositories/run-archives.ts`
  `listReviewed()` (`:337-355`, WHERE `reviewed=true AND is_dry_run=false`), `searchReviewed()` (`:356-437`),
  `findLatestReviewedSince()` (`:301-336`). No change.
- **Schema**: `packages/shared/src/db/schema.ts:52` — `is_dry_run boolean NOT NULL DEFAULT false`. No change.
- **Frontend page**: `packages/web/src/pages/ArchivePage.tsx` — `useArchive(runId)`; error → "Couldn't load this issue";
  non-completed → "isn't ready yet". No change (it already renders correctly once the API returns 200).

### Test Infrastructure
- **Unit (route)**: `packages/api/tests/unit/archives-route.test.ts` — uses `makeApp` / `makeArchiveRepo`
  fixtures; existing `R-14` test (`:154-173`) asserts dry run → 404 (to be flipped to 200), admin test
  (`:175-200`), live regression (`:214-231`). Run: `pnpm --filter @newsletter/api test:unit`.
- **E2E**: `packages/api/tests/e2e/` (DB+Redis via `pnpm infra:up`). Frontend e2e via Playwright MCP for REQ-006.
- **Doc**: `packages/api/CLAUDE.md` documents the route as "missing, dry-run, and unreviewed archives return 404" —
  must be updated to reflect dry runs now returning 200 when reviewed.

## Phase Graph

```dot
digraph phases {
  rankdir=LR
  node [shape=box]

  phase_1 [label="Phase 1: Public route allows reviewed dry runs + tests"]

  phase_1
}
```

Single phase — the change is one route guard plus its unit tests and a doc string. No parallelism.
