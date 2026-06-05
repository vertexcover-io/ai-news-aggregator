# Learnings — Web-Search Collector

**Date:** 2026-05-20
**Scope:** feat/web-search-collector (7-phase TDD implementation)

---

## Learning 1: Phase 1 typecheck cascade requires planning for downstream SourceType exhaustiveness

**What happened:** Phase 1 added `"web_search"` to the `SourceType` union in `packages/shared/src/types/run.ts`. This immediately caused TypeScript errors in exhaustive `switch` statements and `Record<SourceType, ...>` maps across the codebase (`ArchiveStoryCard.tsx`, `sourceDisplay.ts`, `api/src/services/runs.ts`, `pipeline/src/services/source-telemetry.ts`). The Phase 1 plan attributed this work to Phase 4, but it was actually required in Phase 1 to make `pnpm typecheck` pass.

**Why it matters:** The plan assigned "API types" work to Phase 4 but didn't account for the fact that widening a shared union type immediately breaks all downstream exhaustive checks. This forced Phase 1 to do production-code work originally planned for Phase 4, compressing the timeline unexpectedly.

**Rule:**
When a Phase 1 task widens a discriminated union that is exhaustively matched elsewhere in the codebase, **explicitly list every downstream exhaustive-match site in the Phase 1 file map** and assign their updates to Phase 1. Run `pnpm typecheck` after the type change (before writing any tests) to discover the full cascade.

**Test vector:** After adding any value to a `SourceType`-style union, run `pnpm typecheck` and list every file that errors. Add them all to Phase 1's file map.

---

## Learning 2: `POST /api/runs/now` anySource guard must be kept in sync with new source types

**What happened:** The `anySource` guard in `packages/api/src/routes/runs.ts:96-103` was not updated to include `webSearchEnabled`. As a result, a webSearch-only configuration returns `{"error":"no sources enabled"}` from the "Run Now" button, even though the daily scheduler (`daily-run.ts:21-29`) correctly handles it. This inconsistency was caught during functional verification (ADV-1).

**Why it matters:** The `daily-run.ts::sourcesEnabled()` function and `runs.ts::anySource` check are parallel implementations of the same logic. When a new source is added, both must be updated.

**Rule:**
When adding a new source to the pipeline, search for **all** locations that implement a "any source enabled?" check (not just the ones in the phase files). Grep for `anySource`, `sourcesEnabled`, `hnEnabled`, `redditEnabled` patterns to find every guard site. Update them all.

**Heuristic:** If there are two places that ask "is anything enabled?", they should share a helper function — not duplicate the logic. Consider extracting `anySourceEnabled(settings)` to `@newsletter/shared` and importing it in both `api/routes/runs.ts` and `pipeline/workers/daily-run.ts`.

---

## Learning 3: Tavily SDK AbortSignal limitation — accept or wrap at collector level

**What happened:** `TavilyProvider.search()` accepts `signal?: AbortSignal` in its input type (consistent with the project's convention), but `@tavily/core@0.7.3` uses axios internally with no per-call signal support. The SDK cannot be cancelled mid-flight. This was caught in code review (pass-1).

**Decision made:** Accept the limitation for this PR. In-flight Tavily requests run to completion (~2-15s) even after run cancellation; the surrounding pipeline still aborts enrichment and DB writes via the signal.

**Rule for future SDK integrations:**
Before selecting an SDK, run a probe that specifically tests: "Can I pass an AbortSignal to individual API calls?" If not, document the limitation at the provider class level with a JSDoc comment and in the `library-probe.md`. Decide consciously: accept limitation, or wrap with `Promise.race([sdkCall, rejectOnAbort(signal)])`.

**Pattern for wrapping:**
```ts
// When SDK doesn't support signal natively:
const result = await Promise.race([
  sdkCall(),
  new Promise<never>((_, reject) => {
    signal?.addEventListener("abort", () => reject(new Error("cancelled")));
  }),
]);
```
This doesn't cancel the in-flight HTTP request, but returns early to the caller. Only use if cancellation latency matters.

---

## Learning 4: Review agents must constrain tool use to local files only (no GitHub PR posting)

**What happened:** The Pass 1 review agent attempted to post a review comment to a GitHub PR. Since no PR existed for this branch yet (it's a worktree), the tool call failed with an authorization or not-found error. The agent recovered and continued, but the failure caused noise.

**Rule:**
In orchestrate Stage 4 (code review), constrain the review agent prompt to: "Produce a markdown review file. Do NOT call any GitHub MCP tools. Do NOT post to any PR. All output goes to `.harness/<feature>/review/pass-N.md`." The PR creation happens in Stage 6 (commit+PR), not during review.

**Implementation:** The orchestrate skill's review phase should pass `--no-github-tools` or equivalent constraint to prevent MCP tool calls that target external services during local review passes.
