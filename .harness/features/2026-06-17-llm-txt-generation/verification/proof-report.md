# Verification Proof Report — llm.txt / llms.txt Generation

**Date:** 2026-06-17
**Verdict:** PASS

## Quality gate

| Check | Command | Result |
|---|---|---|
| Typecheck (shared) | `pnpm --filter @newsletter/shared typecheck` | PASS (no errors) |
| Typecheck (api) | `pnpm --filter @newsletter/api typecheck` | PASS (no errors) |
| Lint (shared) | `pnpm --filter @newsletter/shared lint` | PASS (clean) |
| Lint (api) | `pnpm --filter @newsletter/api lint` | PASS (clean) |
| Unit tests (shared) | `pnpm --filter @newsletter/shared test:unit` | 44 files / 405 tests passed |
| Unit tests (api) | `pnpm --filter @newsletter/api test:unit` | 58 files / 722 tests passed |

Baseline note: before this change the API suite reported 14 failing test *files* due to a
worktree with incomplete `node_modules` (`@ai-sdk/deepseek`, `playwright-core` not installed →
stale pipeline `dist`). Running `pnpm install` + rebuilding `@newsletter/pipeline` cleared the
baseline; the feature itself introduced zero failures.

## Scenario coverage (from spec.md)

| Scenario | Where proven | Result |
|---|---|---|
| VS-1 issue render | `shared/src/llm-txt/__tests__/render.test.ts` | PASS |
| VS-2 index render w/ absolute links | same | PASS |
| VS-3 empty issues → "none" note | same | PASS |
| VS-4 URL absolutization, no `//` | same (`absoluteUrl`) | PASS |
| VS-5 `GET /llms.txt` 200 text/plain + cache header | `api/tests/unit/llm-txt-route.test.ts` | PASS |
| VS-6 per-issue 200 reviewed / 404 unreviewed+missing | same | PASS |
| VS-7 `GET /llms-full.txt` inlines story content | same | PASS |
| VS-8 no-drift: route body === snapshot.index | `api/tests/unit/llm-txt-drift.test.ts` | PASS |
| Index excludes unreviewed + dry-run archives | `llm-txt-route.test.ts` | PASS |

## Adversarial checks performed

- **Route collision** (`/api/archives/:runId/llm.txt` vs public `/:runId`): independently
  proven with a throwaway Hono test — both paths resolve correctly; the per-issue route is not
  swallowed by the `:runId` catch-all. Different path depths → no conflict regardless of mount order.
- **Public data leak**: the per-issue and index endpoints render text only from
  `{title, url, recap}` + `digestHeadline/digestSummary` via the shared generator. No
  admin-only field (`costBreakdown`, raw `publishedAt`, `reviewed`, `shortlistedItemIds`) is
  referenced in any render path.
- **Null/empty**: `digestHeadline`/`digestSummary` null → default headline / summary omitted;
  empty `rankedItems` → "No stories in this issue."; empty canon/issues → "None yet." / "No
  published issues yet." All exercised by unit tests; no crash paths.
- **No-drift guarantee**: `/llms.txt` serves `buildLlmTxtSnapshot().index` — the exact string the
  materialization script writes — so committed files cannot diverge from served responses. Proven
  by byte-equality test (VS-8).
- **Repository discipline**: generator/types/static-pages import only types; routes + script use
  repository factories; no `drizzle-orm` / `@newsletter/shared/db` import outside repositories.
  Confirmed by passing `newsletter/enforce-repository-access` lint.

## Code-review findings & fixes

- **Important (fixed):** index path applied the 30-row limit *before* the reviewed/dry-run
  filter (`list(30)` then JS filter), so dry-run/unreviewed rows could consume slots and drop
  real published issues. Fixed by adding `RunArchivesRepo.listReviewedRows(limit)` — filters
  `reviewed = true AND is_dry_run = false` in SQL, orders by
  `coalesce(publishedAt, completedAt) desc`, then limits — matching the public archive list.
  The route and the materialization script both use it.
- **Minor (fixed):** `/llms.txt` over-hydrated (it built the full snapshot for the index path).
  `loadSnapshotData(withStories=false)` now skips per-story hydration for the index; the index
  render only needs headline/date/runId, so output is byte-identical.
- **Minor (no action — intentional):** the must-read page is omitted from `LLM_TXT_STATIC_PAGES`
  because Canon has a dedicated section that links to `/must-read`; avoids duplication.

## Artifacts produced

- Generated snapshot committed under `llms/` (index, full index, canon, per-issue files) +
  `llms/README.md` documenting regeneration via `pnpm generate:llm-txt`.
