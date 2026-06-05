# Functional Verification — publishedat-newsletter-date

**Verdict: PASS**

Date: 2026-05-25
Surfaces verified live: API on `http://localhost:3055`, Web (Vite) on `http://localhost:5199`.

## Feature under test

`run_archives.published_at` (migration 0031) carries the *scheduled* publish date set by
the pipeline at success finalize (`resolveScheduledPublishAt`; NULL on failed / equal-times /
missing-settings). All public + admin display surfaces show the **effective** publish date —
`COALESCE(published_at, completed_at)` — as the issue/run date, and the public listing + search
are ordered by `COALESCE(published_at, completed_at) DESC`. The raw `published_at` is kept
internal and is never serialised on public archive routes.

## Seed data (this worktree DB, port 5433)

| Archive | runId (suffix) | completed_at | published_at | effective date | digest_headline |
|---------|----------------|--------------|--------------|----------------|-----------------|
| A | `…0001` | 2026-05-25 12:00 | 2026-05-26 06:00+00 | **2026-05-26** (publish) | Archive A digest headline |
| B | `…0002` | 2026-04-10 18:00 | **NULL** | 2026-04-10 (fallback) | Archive B digest headline |
| C | `…0003` | 2026-03-31 20:00 | 2026-04-01 05:00+00 | 2026-04-01 (publish) | Archive C digest headline |

Plus 15 pre-existing reviewed-but-empty archives (NULL published, completed 2026-05-25,
0 ranked items) belonging to the shared dev DB — NOT created by this feature, left untouched.

## UI claim proofs (Playwright, real browser)

| Claim | REQ / EDGE | Surface | Observed | Screenshot |
|-------|-----------|---------|----------|------------|
| **PHASE4-C4** | REQ-009, VS-1 | `/` featured "Today" block (TodaysIssueBlock) | Date block renders **"TUESDAY · MAY 26"** / cover plate **"2026-05-26"** for Archive A (publish date), even though completed_at is 2026-05-25. May-2026 month. | `docs/spec/publishedat-newsletter-date/verification/screenshots/PHASE4-C4-listing-date-block-2026-05-26.png` |
| **PHASE4-C5** | REQ-010, VS-2 | `/archive/00000000-aaaa-4000-8000-000000000001` | Issue-date masthead reads **"TUESDAY · MAY 26 · 2026"** = publish date 2026-05-26. | `docs/spec/publishedat-newsletter-date/verification/screenshots/PHASE4-C5-archive-detail-issue-date-2026-05-26.png` |
| **PHASE4-C6** | REQ-011, VS-3 | `/admin` dashboard run row (desktop) | Archive A row shows **Date "May 25, 2026 17:30"** (started) AND a separate **Publish date "May 26, 2026"** column/value. Both present. | `docs/spec/publishedat-newsletter-date/verification/screenshots/PHASE4-C6-admin-dashboard-run-row-publish-date.png` |
| **PHASE4-C2** | REQ-011 (desktop variant) | `/admin` `RunsTable` @ 1280px | Header columns include both **"Date"** and **"Publish date"**. Archive A: Date 2026-05-25 17:30, Publish date 2026-05-26. Empties show Publish date 2026-05-25 (fallback). | `docs/spec/publishedat-newsletter-date/verification/screenshots/PHASE4-C2-admin-RunsTable-desktop-publish-date.png` |
| **PHASE4-C1** | REQ-011 (mobile variant) | `/admin` `RunsCardList` @ 375px | Archive A card shows **"Started: May 25, 2026 17:30"** AND **"Publish date: May 26, 2026"** AND Run ID `…0001`. | `docs/spec/publishedat-newsletter-date/verification/screenshots/PHASE4-C1-admin-RunsCardList-mobile-publish-date.png` |
| **PHASE4-C7** | REQ-012, VS-4, EDGE-005 | `/` listing + `/archive/:B` + API ordering | Archive A (publish 2026-05-26) is featured/top-of-order, ABOVE the NULL-published 2026-05-25 rows. Archive B (NULL publish) renders **"FRIDAY · APRIL 10 · 2026"** (groups April via completed fallback). Publish-aware list order A → B → C (positions 1, 17, 18) confirmed via `/api/archives`. | `docs/spec/publishedat-newsletter-date/verification/screenshots/PHASE4-C7-home-A-featured-above-null-published.png`, `docs/spec/publishedat-newsletter-date/verification/screenshots/PHASE4-C7-archiveB-april-fallback-detail.png`, `docs/spec/publishedat-newsletter-date/verification/screenshots/PHASE4-C7-publish-aware-sort-order.png` |

### Note on the `/` month-grouped listing

The redesigned AgentLoop home (commit `3394036`) renders a featured "Today" block +
flat "Recent issues" list (capped server-side at 10). The standalone month-grouped
listing component (`groupVisible`/`MonthHeader`) is present in the codebase but is not
currently wired into a live route. The publish-aware **month** is still proven because the
`DateBlock`/issue-date masthead renders `runDate` directly (publish-aware), so the month
shown is always the effective-publish month — verified on the featured block (MAY 2026 for A)
and on Archive B's detail page (APRIL 2026 for the NULL-published row). Cross-month ordering
(A in May above B/C in April) is proven via the `/api/archives` payload.

## API evidence (captured prior, re-confirmed live)

| File | Confirms |
|------|----------|
| `verification/api/home-payload.txt` | `todaysIssue.runDate = 2026-05-26` for Archive A (publish-aware). |
| `verification/api/detail-A.txt` | Detail issueDate = 2026-05-26, startedAt = 2026-05-25; **no `publishedAt` key**; top-level keys enumerated. |
| `verification/api/detail-C.txt` | Archive C issueDate = 2026-04-01 (publish); no `publishedAt` key. |
| `verification/api/search-noq.txt` | `GET /api/archives/search` (no q) orders publish-aware: Archive A 2026-05-26 first. |

## REQ / EDGE coverage matrix

| Item | Description | Evidence | Verdict |
|------|-------------|----------|---------|
| REQ-006 | Detail issue date = effective publish date | detail-A.txt, C5 screenshot | PASS |
| REQ-007 | Listing date block = effective publish date | home-payload.txt, C4 screenshot | PASS |
| REQ-008 | List + no-q search ordered by COALESCE(published, completed) DESC | search-noq.txt, C7 API order (A→B→C = pos 1,17,18), repo `coalesce(...) desc` | PASS |
| REQ-009 | Listing date block + month group show publish date | C4 screenshot (MAY 26 / May), C7 Archive B (APRIL 10) | PASS |
| REQ-010 | Detail page shows publish date as issue date | C5 screenshot (MAY 26) | PASS |
| REQ-011 | Admin dashboard rows show publish date | C6 / C2 (desktop) + C1 (mobile) screenshots | PASS |
| REQ-012 | Issue numbering follows publish-date ordering | C7 (A featured/top = latest effective date) + API positions | PASS |
| EDGE-003 | Pre-change NULL-published row falls back to completed_at, no regression | Archive B issueDate 2026-04-10 (HTTP 200), C7 Archive B detail | PASS |
| EDGE-005 | Mixed list: ordering + grouping use the same effective date (no mismatched month) | adversarial probe (completed Apr 30 / published May 1 → issueDate 2026-05-01, May), C7 | PASS |
| EDGE-007 | Dry-run excluded from public listing (unchanged) | n/a — no dry-run regression introduced; public list filter `is_dry_run = false` untouched | PASS (by inspection) |
| (internal) | `published_at` never serialised on public routes | detail-A.txt, detail-C.txt, list payload key dump (NONE leaked) | PASS |

All six UI claim ids (C1, C2, C4, C5, C6, C7) have screenshots. No claim failed.
