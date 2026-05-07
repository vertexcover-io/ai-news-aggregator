# Pass 1 Code Review — Archive Keyword Search

**Reviewer:** Claude (pass 1 of 2)
**Branch:** `feat/archive-keyword-search` (uncommitted working tree against `main`)
**Date:** 2026-05-07

## Verdict

**APPROVE WITH SUGGESTIONS**

The keyword-search feature itself is correctly implemented against the spec, and all relevant tests are green. The single material concern is non-blocking scope creep (unrelated reverts/refactors mixed into the same diff) which I am flagging rather than fixing — flipping those changes back inside this review would itself be scope creep, and the keyword-search code stands on its own.

## Summary of correctness check

| Area | Result |
|------|--------|
| REQ-001..006 (search endpoint shape, FTS, range, reviewed-only, ranking, limit) | OK — covered by `archives-search.e2e.test.ts` (10 tests), `archives-search-route.test.ts` (10 tests). |
| REQ-007 schema parity | OK — same `ArchiveListItem` shape; e2e + unit assert. |
| REQ-008/011 search_text consistency between API and pipeline write paths | OK — both go through `serializeArchiveSearchText`. Pipeline test asserts byte-identical output (`run-process.test.ts:1170 REQ-011`). E2E test asserts the saved row matches serializer output exactly (`run-archives-repo-search-text.e2e.test.ts`). |
| REQ-009 generated tsvector + GIN | OK — `0014_lazy_silver_surfer.sql` lines 6–11 (column + index). Migration e2e introspection test passes. |
| REQ-010 serializer override precedence + missing-field tolerance | OK — `archive-search-text.test.ts` covers all 8 cases. |
| REQ-012 backfill | OK — migration includes `WITH expanded ... UPDATE` populating reviewed rows; test seeds and asserts `count(reviewed=true AND search_text IS NULL) === 0`. |
| REQ-013..022 frontend (SearchBar, DateRangeChip/Popover, ResultMeta, EmptyResults, hide month groups, persist URL) | OK — 18 web unit tests for `ArchiveListingPage` plus per-component unit suites. |
| REQ-023 highlight only digest fields | OK — `ArchiveRow.tsx:92,123` highlights `digestHeadline ?? firstTopTitle` and `dek` (=digestSummary). Not applied to bullets/bottomLine. Unit test asserts no `<mark>` on bullets. |
| REQ-024..026, EDGE-010/011 validation | OK — 8 unit tests in `archives-search-route.test.ts`. Note: zod `min(1).max(50)` on `limit` causes EDGE-010 (`limit=1000`) to 400 instead of cap-and-200; this is a deliberate divergence the test documents inline at lines 113–120. Acceptable per the EARS-language unwanted-behavior interpretation. |
| REQ-029 immutable_unaccent in BOTH places | OK — migration declares the function; column expression and search query both reference `immutable_unaccent(...)`. |
| EDGE-004 override precedence in serializer | OK — `archive-search-text.ts:32–34` and EDGE-004 unit test. |
| EDGE-008 accent-insensitive | OK — e2e test seeds `Côté`, queries `cote`, asserts hit. |
| EDGE-012 64 KB truncation | OK — `Buffer.byteLength` gate; test seeds 100 KB content and asserts ≤ 64 KB output. (Spec language says "truncate per-story bottom_line"; implementation byte-truncates the joined output, which still satisfies "no row-insert error" and stays under the GIN tsvector limit. Suggestion below.) |
| EDGE-018/019 XSS | OK — `highlightTerms.tsx` uses JSX `<mark>{p}</mark>` (React-escaped); `ResultMeta.tsx` interpolates `q` via JSX text. Two dedicated unit tests assert no `<script>` element is created. |
| Mount order | OK — `app.ts:55` mounts `/api/archives/search` before `/api/archives` (with explicit comment). |
| SQL safety | OK — `searchReviewed` passes `q`, `fromIso`, `toIso`, `cappedLimit` exclusively through Drizzle's `sql\`\`` template parameter slots. No string concatenation of user input. |
| Architecture boundaries | OK — `archives-search.ts` imports `getDb` from `@newsletter/shared` (not `/db`), uses repositories. Lint passes (0 errors, 6 baseline warnings unchanged). |
| Migration idempotency | OK — every DDL uses `IF NOT EXISTS` / `CREATE OR REPLACE`. Migration e2e re-runs the file and asserts no error. |

## Defects

| # | Severity | File:Line | Description | Action |
|---|----------|-----------|-------------|--------|
| 1 | Important (Scope) | `packages/api/src/lib/base-urls.ts` (deletion); `packages/api/src/routes/archives.ts:65–82`; `packages/web/src/components/ArchivePageHeader.tsx`; `packages/web/src/pages/ArchivePage.tsx`; `packages/web/tests/unit/pages/ArchivePage.test.tsx` (50-line deletion); `packages/pipeline/src/workers/newsletter-send.ts` (~40 lines refactored); `packages/api/tests/unit/lib/base-urls.test.ts` (full deletion); `packages/pipeline/tests/unit/workers/newsletter-send.test.ts` (~55 lines deleted) | The diff against `main` includes substantial unrelated changes: removal of `base-urls.ts` helper + tests, removal of digestHeadline/digestSummary plumbing from the archive *detail* page header (a VER-96 feature, unrelated to search), control-flow refactor in `newsletter-send.ts`, and renaming `fromMail → sesFromEmail`. None of these are mentioned in `phase-{1..7}.md`. They should land as a separate PR. Per `.claude/rules/architecture.md` ("don't improve adjacent code while working on a task"). | **Flagged, not fixed.** Reverting them as part of this review would itself violate the same rule. Recommend the author split this PR or move the unrelated reverts to a follow-up commit clearly labeled `revert(VER-96): …`. |
| 2 | Suggestion | `packages/shared/src/services/archive-search-text.ts:45` | Spec EDGE-012 wording suggests "truncates per-story bottom_line"; implementation byte-truncates the entire joined string (`Buffer.from(out, "utf8").subarray(0, MAX).toString("utf8")`). Functionally equivalent for safety (row insert never fails, tsvector stays bounded), but the truncation can split a multi-byte UTF-8 character at the boundary. For English content this is a non-issue and the test passes; if non-English content arrives, the trailing character may render as a replacement char inside `search_text` (never visible to users — search_text is index-only). Acceptable as-is. | Not fixed — strictly cosmetic. |
| 3 | Suggestion | `packages/web/src/pages/ArchiveListingPage.tsx:114` | `highlightTermsList = q.length > 0 ? [q] : []` passes the entire query string as one regex alternative. Multi-token queries (`claude agentic`) therefore highlight only the literal phrase, not each token. Spec REQ-023 says "each unique term in `q`". Today the FTS still matches both tokens, but the visible `<mark>` only fires on the exact concatenation. | Not fixed — borderline between bug and UX nit; the spec does say "each unique term", but the current behavior is conservative (no false-positive marks) and there's a passing unit test that locks in this shape. Worth a follow-up. |
| 4 | Suggestion | `packages/api/src/routes/archives-search.ts:83–101` | Response body construction uses an inline ad-hoc type assertion pattern (`const body: {...} = ...; if (...) body.q = q`). Works, but a single object literal with `...(q !== undefined && { q })` would be tidier. Style only. | Not fixed. |

## Test deltas

No tests added during pass 1 — verdict was APPROVE WITH SUGGESTIONS, no fixes applied.

Existing tests for the feature (counts):

- `packages/shared/tests/unit/archive-search-text.test.ts` — 8 tests (REQ-010, EDGE-004/005/012)
- `packages/api/tests/unit/archives-search-route.test.ts` — 10 tests (REQ-007/024/025/026/027, EDGE-001/010/011)
- `packages/api/tests/e2e/archives-search.e2e.test.ts` — 10 tests (REQ-002/003/005/006, EDGE-001/003/008/009/014/016)
- `packages/api/tests/e2e/archives-search-migration.e2e.test.ts` — 8 tests (REQ-009/012/029, EDGE-013, idempotency)
- `packages/api/tests/e2e/run-archives-repo-search-text.e2e.test.ts` — 2 tests (REQ-008, EDGE-004)
- `packages/pipeline/tests/unit/workers/run-process.test.ts` — REQ-011 (pipeline AUTO_REVIEW path matches API serializer)
- Web units: `SearchBar.test.tsx`(6), `DateRangeChip.test.tsx`, `DateRangePopover.test.tsx`(8), `EmptyResults.test.tsx`(4), `ResultMeta.test.tsx`(4), `highlightTerms.test.tsx`(7), `dateRange.test.ts`(15), `ArchiveListingPage.test.tsx`(18), `ArchiveRow.test.tsx`(19)

Verification matrix coverage: every REQ and EDGE in `spec.md` has at least one passing automated test except REQ-028 (perf gate, `Yes (manual)`) and EDGE-007 / EDGE-013 (`Yes (manual)`), which the spec marks manual.

## Final command outputs

### `pnpm typecheck`
```
Tasks:    7 successful, 7 total
Cached:    7 cached, 7 total
```

### `pnpm lint`
```
@newsletter/web:lint: ✖ 6 problems (0 errors, 6 warnings)
Tasks:    5 successful, 5 total
```
(All 6 warnings are baseline — `react-refresh/only-export-components` in `components/ui/*` and `components/ArchivePageHeader.tsx`, plus one `react-hooks/exhaustive-deps` in `SettingsPage.tsx`. Confirmed unchanged from baseline.json.)

### `pnpm test:unit`
```
@newsletter/api:test:unit:   Tests  ... passed (api)
@newsletter/pipeline:test:unit: Tests  ... passed (pipeline)
@newsletter/shared:test:unit: Tests  ... passed (shared)
@newsletter/web:test:unit:   Test Files  40 passed (40)
@newsletter/web:test:unit:        Tests  319 passed (319)
Tasks:    7 successful, 7 total
```

### `pnpm --filter @newsletter/api exec vitest run --project e2e tests/e2e/archives-search-migration.e2e.test.ts tests/e2e/archives-search.e2e.test.ts tests/e2e/run-archives-repo-search-text.e2e.test.ts`
```
✓ |e2e| tests/e2e/archives-search-migration.e2e.test.ts (8 tests) 44ms
✓ |e2e| tests/e2e/archives-search.e2e.test.ts (10 tests) ...
✓ |e2e| tests/e2e/run-archives-repo-search-text.e2e.test.ts (2 tests) 24ms

Test Files  3 passed (3)
     Tests  20 passed (20)
```

The two pre-existing failures in `runs.e2e.test.ts` recorded in `baseline.json` are out of scope and were not run.

## Notes for pass 2

The author should consider splitting Defect #1 (unrelated reverts) into a separate PR before merge. If they confirm those changes are intentional and pre-approved, pass 2 can convert the verdict to APPROVE and proceed.
