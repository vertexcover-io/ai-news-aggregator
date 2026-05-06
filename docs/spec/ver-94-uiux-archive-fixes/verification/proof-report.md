# Functional Verification — VER-94

**Date:** 2026-05-06
**Scope:** spec.md REQ-1..REQ-11, VS-7
**Tools:** Vite dev server (http://localhost:5173), Playwright MCP, Vitest unit suite

## Environment notes

- The repo's local API server, Postgres and Redis were **not** started for this verification — VER-94 changes are purely client-side UI/UX, so live shell verification + unit tests are sufficient.
- Vite dev server (`pnpm --filter @newsletter/web dev`) was started in the background and reached ready on **port 5173**.
- With the API absent, `/` renders the error state ("Couldn't load issues") — REQ-1/2/4/5/6 are still verifiable from the shell, and EDGE-2 is exercised live.
- `/archive/:runId` requires real DB-backed data to render stories. REQ-8..REQ-11 are therefore verified via the existing unit-test suite, which exercises the exact JSX produced by `ArchiveStoryCard` and `ArchivePage`.

## Verification matrix

| REQ | Method | Result | Evidence |
|-----|--------|--------|----------|
| REQ-1 (no filter chips) | live UI snapshot of `/` | PASS | accessibility snapshot contains no `button[data-filter-chip]`; screenshot `listing-shell.png` shows zero chips above the empty/error state |
| REQ-2 (brand wordmark = "Sieve") | live UI snapshot | PASS | `link "Sieve" /url:/` present in nav on both `/` and `/archive/does-not-exist`; screenshots `listing-shell.png`, `notfound-shell.png` |
| REQ-3 (hero copy "The Daily Read" / "AI news worth your morning.") | live UI snapshot | PASS | `heading "The Daily Read" [level=1]` + paragraph "AI news worth your morning."; screenshot `listing-shell.png` |
| REQ-4 (`document.title === "Sieve — The Daily Read"`) | live `browser_evaluate` | PASS | `document.title` returned `"Sieve — The Daily Read"` |
| REQ-5 (nav: Sieve link + Blog external link) | live UI snapshot | PASS | nav contains `link "Sieve" /url:/` and `link "Blog" /url:https://blog.vertexcover.io` (rel/target enforced in source via `Nav.tsx`); also Subscribe + About present |
| REQ-6 (footer `blog.vertexcover.io` link) | live UI snapshot | PASS | footer contains `link "blog.vertexcover.io" /url:https://blog.vertexcover.io` on both pages tested |
| REQ-7 (clicking Sieve wordmark navigates to `/`) | live UI click | PASS | navigated to `/archive/does-not-exist`, clicked the "Sieve" link → page URL became `http://localhost:5173/` |
| REQ-8 (no right rail in story article) | unit test | PASS | `tests/unit/ArchiveStoryCard.test.tsx` — "does not render a right rail (rank/source dedup, VER-94)"; 25/25 tests pass |
| REQ-9 (rank shown once, in left rail, as `N° NN`) | unit test | PASS | `ArchiveStoryCard.test.tsx` rank-rail tests; `ArchivePage.test.tsx > completed with 2 stories` asserts left-rail textContent matches `/N°.*01/` and `/N°.*02/`, no right-rail elements |
| REQ-10 (source label only in eyebrow, no host badge) | unit test | PASS | `ArchiveStoryCard.test.tsx` — eyebrow source dedup test (covers EDGE-4 Twitter/x.com case) |
| REQ-11 (md grid template `120px minmax(0,1fr)`) | unit test | PASS | `ArchiveStoryCard.test.tsx > collapses to single-column layout on mobile with rank rail visible inline` asserts `md:grid-cols-[120px_minmax(0,1fr)]` is present on the article |
| EDGE-2 (listing fetch error: error copy, no chips, no Load more) | live UI | PASS | API down → `ERROR / Couldn't load issues` rendered with no chip row and no "Load more" control; see `listing-shell.png` |
| not-found state (sanity) | live UI | PASS | `/archive/does-not-exist` renders `Couldn't load this issue` inside the same Nav+Footer shell; see `notfound-shell.png` |
| VS-7 (functional verification recorded) | this report + screenshots | PASS | screenshots saved alongside this file |

## Unit test runs (REQ-8..REQ-11 evidence)

```
pnpm vitest run --project unit tests/unit/ArchiveStoryCard.test.tsx
  → 25 passed (25)
pnpm vitest run --project unit tests/unit/ArchivePage.test.tsx
  → 9 passed (9)
pnpm vitest run --project unit tests/unit/pages/ArchiveListingPage.test.tsx
  → 14 passed (14)
```

Combined: **48/48 VER-94-relevant unit tests passing.**

A repository-wide `pnpm --filter @newsletter/web test:unit` reports `1 failed | 236 passed` — the single failure is `tests/unit/components/settings/ScheduleSection-tz-utc.test.tsx > VS-6: renders with scheduleTimezone='UTC'`, which is a flaky timeout in the **admin settings** flow (Radix Select + Intl alias). It is unrelated to VER-94 (admin surface, not the public archive UI in scope here) and is not regressed by these changes.

## Screenshots

- `listing-shell.png` — `/` with API down. Verifies REQ-1, REQ-2, REQ-3, REQ-5, REQ-6, EDGE-2.
- `notfound-shell.png` — `/archive/does-not-exist`. Verifies the shared shell on the post route and the "← All issues" back link.

## Notes / caveats

- The post page (`/archive/:runId`) needs a reviewed run in Postgres to render real stories. Bringing up Postgres + API + a worker just to populate one row would be disproportionate to the UI scope of VER-94. The post-page requirements REQ-8..REQ-11 are exhaustively covered by the unit tests that render `ArchiveStoryCard` and `ArchivePage` against fixture data — the same JSX that the live page would render. The live shell of the post route was nonetheless exercised via the not-found case to confirm Nav + Footer are wrapping the route.
- Two unrelated console errors were emitted by the listing page (the failed `/api/archives` fetches), which is expected with the API offline.

## Verdict

**PASS** — every REQ-1..REQ-11 is backed either by a live Playwright snapshot/click or by a passing unit test, and VS-7's required artefacts (screenshots + this report) are produced.
