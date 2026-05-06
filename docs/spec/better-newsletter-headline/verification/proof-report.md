# Proof Report — Better Newsletter Headline (VER-96)

<!-- QG:VERDICT:PASS -->
<!-- LP:VERDICT:NOT_APPLICABLE -->

Branch: `ver-96-better-newsletter-headline`
Worktree: `/Users/amankumar/Documents/newsletter/.worktrees/ver-96-better-newsletter-headline`

## Functional verification (live)

### VS-1 — Migration applies cleanly
```
$ pnpm --filter @newsletter/shared db:migrate
[✓] migrations applied successfully!
```

Verified columns exist:
```sql
SELECT column_name, data_type, is_nullable FROM information_schema.columns
WHERE table_name = 'run_archives' AND column_name IN ('digest_headline', 'digest_summary');
```
Returned both columns as `text`, `is_nullable = YES`.

### VS-2 — Existing archives unaffected
65 reviewed archives in DB; 0 have `digest_headline`/`digest_summary` populated. UI continues to render them via the legacy fallbacks — no errors, no missing copy.

### VS-3 — API surfaces the new fields
```
$ curl http://localhost:3000/api/archives | jq '.archives[0] | keys'
[
  "digestHeadline",
  "digestSummary",
  "leadSummary",
  "runDate",
  "runId",
  "storyCount",
  "topItems"
]
```
All 65 returned archives include `digestHeadline: null` and `digestSummary: null`.

### VS-4 — UI renders new headline + subheading when populated
After populating one archive's `digest_headline = 'Qwen 3.6 leaps ahead, Cloudflare opens agentic stack'` and `digest_summary = "Faster local inference, expanded agent tooling, and a major cloud commitment shape the day's AI infrastructure story."`, the listing's featured row rendered exactly that headline (8 words) and that subheading. Screenshot: `listing-with-digest-headline.png`.

### VS-5 — UI fallback when null
With both fields null, the featured row's headline equals `topItems[0].title` and the dek equals `leadSummary`. Verified live in browser via Playwright after reverting the test row.

### VS-6 — Chips and `+ N more` removed
DOM query found **0** chip `<ul>` elements and **0** matches for `/\+ \d+ more/` text on the rendered listing. Confirmed across all 10 visible rows (mix of featured + non-featured + no-stories rows). Full-page screenshot: `listing-fullpage.png`.

### VS-7 — Mixed legacy + new rendering
Full-page screenshot shows row 1 with new digest fields, rows 2 & 3 with legacy fallback (top-story title), no-stories rows untouched. No regressions to month header, filter chips (page-level), or footer.

## Quality Gate — POST-TDD

<!-- QG:CHECK:1:PASS -->
**Build (all packages)**
```
$ pnpm build
Tasks:    5 successful, 5 total
Time:     9.61s
```

<!-- QG:CHECK:2:PASS -->
**Typecheck (all packages)**
```
$ pnpm typecheck
Tasks:    7 successful, 7 total
Time:     6.909s
```

<!-- QG:CHECK:3:PASS -->
**Lint (all packages)**
```
$ pnpm lint
Tasks:    5 successful, 5 total
0 errors, 6 warnings
```
The 6 warnings are pre-existing (React fast-refresh advisories in shadcn UI primitives + one missing-deps warning in `SettingsPage.tsx`); identical to baseline. No new lint regressions introduced by this PR.

<!-- QG:CHECK:4:PASS -->
**Unit tests (all packages)**
- `@newsletter/pipeline`: 455/455 passing across 39 files (was 453 — added 2 new tests for digest fields; updated 3 fixtures).
- `@newsletter/api`: 331/331 passing across 29 files (no test changes needed).
- `@newsletter/web`: 242/242 passing across 29 files (replaced 4 chip-related tests with 4 new digest-headline/dek tests — net coverage on changed code is improved).

<!-- QG:CHECK:5:PASS -->
**Migration safety**
Migration `0012_regular_sauron.sql` is purely additive: two `ALTER TABLE run_archives ADD COLUMN` statements, both nullable. No data migration needed. Rollback = `ALTER TABLE ... DROP COLUMN`.

<!-- QG:CHECK:6:PASS -->
**No new external dependencies**
`pnpm-lock.yaml` unchanged. Library probe verdict: NOT_APPLICABLE.

<!-- QG:CHECK:7:PASS -->
**Schema-of-record alignment**
`packages/shared/src/types/archive.ts` `ArchiveListItem` matches the API repo's `listReviewed()` return shape and the DB schema's `run_archives` columns.

## Verdict

**PASS.** Feature works end-to-end with both legacy data (fallback path) and new data (digest path). All packages pass build, typecheck, lint, and unit tests. No new external deps, no destructive schema changes. Ready to commit and open PR.
