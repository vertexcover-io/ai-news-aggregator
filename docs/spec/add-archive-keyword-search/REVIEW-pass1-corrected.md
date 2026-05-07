# Pass 1 Code Review (corrected diff scope) — archive keyword search

Verdict: **APPROVE WITH SUGGESTIONS**

Diff scope confirmed via `git status -s` against fork-point `cd0fda9`. Every changed file matches the expected list in the review brief — no scope creep. The three commits on `main` past `cd0fda9` (share-headline, NEWSLETTER_BASE_URL fallback) are unrelated and correctly excluded.

## Verification results

| Check | Result | Evidence |
|---|---|---|
| 1. Diff scope clean | PASS | `git status -s` exactly matches the expected file list (modified + untracked). No unrelated files touched. |
| 2. REQ-029 wrapper consistency | PASS | Migration `0014_lazy_silver_surfer.sql` defines `immutable_unaccent(text)` (line 2-4) and uses it in the generated `search_tsv` expression (line 8). Repo `searchReviewed` uses `websearch_to_tsquery('english', immutable_unaccent(${q}))` (`packages/api/src/repositories/run-archives.ts:191`). Same identifier verbatim — no `unaccent(...)` mix. |
| 3. REQ-011 cross-path strong assertion | PASS | `packages/pipeline/tests/unit/workers/run-process.test.ts:1243` uses `expect(arg.searchText).toBe(expected)` with `expected = serializeArchiveSearchText({...})`. Equality, not "called with non-null". Plus follow-up assertions confirming override precedence (`toContain("OVERRIDE_SUMMARY")` / `not.toContain("RECAP_SUMMARY")`). |
| 4. EDGE-018/019 XSS | PASS | `ResultMeta.tsx`, `EmptyResults.tsx`, and `highlightTerms.tsx` all interpolate `q`/text as JSX children. No `dangerouslySetInnerHTML` anywhere. `highlightTerms` regex-escapes terms before constructing the alternation, then wraps matched parts in `<mark>` JSX (text node, not HTML). |
| 5. SQL injection in `searchReviewed` | PASS | All references to `q`, `from`, `to`, `cappedLimit` are inside `${}` slots in Drizzle `sql\`\`` templates (lines 191, 203, 206, 213). No string concatenation. `cappedLimit` is `Math.min(Math.max(input.limit ?? 50, 1), 50)` so even bypassing the route validator it cannot inject. |
| 6. Mount order (REQ-001) | PASS | `app.ts:55-56` mounts `/api/archives/search` BEFORE `/api/archives`. There is also an inline comment documenting the requirement. Unit tests in `tests/unit/archives-search-route.test.ts` mount `/api/archives/search` and assert routability; e2e in `tests/e2e/archives-search.e2e.test.ts` exercises the full path against real Postgres. |
| 7. Scope creep | PASS | None. |
| 8. Verification matrix coverage | PASS | Spot-checked: REQ-001..029 each map to at least one test in shared/api/web. Frontend REQs covered by component unit tests + Playwright `archive-search.spec.ts`. EDGE-008 (accent) covered in e2e (`?q=cote`). EDGE-003 (websearch operators) covered (`?q=claude -agentic`). |
| 9. Test quality | PASS | E2E uses real Postgres with seeded data and asserts archive IDs/content. No hard-coded prod URLs, no LLM/network calls in tests, no assertion-free passes. Unit tests assert exact strings. |
| 10. ESLint custom rules | PASS | `pnpm lint` → 0 errors (6 pre-existing warnings unrelated to this PR: `react-refresh/only-export-components` in shadcn `button.tsx`/`form.tsx` and a `react-hooks/exhaustive-deps` in `SettingsPage.tsx`). `archives-search.ts` route only imports repo factories — no direct `@newsletter/shared/db` usage. |

## Quality gates

- `pnpm lint` — 0 errors, 6 pre-existing warnings.
- `pnpm typecheck` — passes.
- `pnpm test:unit` — 342/342 pass across 30 files (including new `archives-search-route.test.ts` 10 tests, `archive-search-text.test.ts`, `highlightTerms.test.tsx`, `dateRange.test.ts`, etc.).

## Suggestions (non-blocking)

1. `packages/api/src/repositories/run-archives.ts:189-190` — `fromIso = fromTs.toISOString()` then bound via `${fromIso}::timestamptz`. Drizzle would also accept the `Date` object directly (parameterized as a timestamp); the current form is fine but slightly inconsistent with the no-`q` branch right above (which passes `Date` objects via `gte`/`lte`). Pure style.
2. `packages/api/src/repositories/run-archives.ts:209-215` — the `total` count query duplicates the `WHERE` of the matched-rows query. Acceptable (FTS counts on the same condition are cheap with the GIN index), but a `count(*) OVER ()` window in the main query would save one round-trip. Optional.
3. `packages/api/src/routes/archives-search.ts:46-48` — the explicit `rawQ.length > 200` check duplicates the zod `max(200)` constraint. Both produce 400; the manual check just guarantees the specific error code `q-too-long` instead of zod's `bad-request`. That's intentional per REQ-024, so leaving this as a note rather than a change request.
4. The migration's `idx_run_archives_reviewed_completed` partial index (line 12-13) is created but never strictly required for the FTS path (which goes through `idx_run_archives_search_tsv`). It speeds the no-`q` branch; worth keeping but flag-worthy if the team wants a tighter migration.

## Summary

No Critical or Important defects. The implementation matches the spec, all verification-matrix REQs are covered by tests, the migration and runtime SQL agree on the `immutable_unaccent` wrapper, parameterization is sound, mount order is correct, and there is no XSS path. Approve.
