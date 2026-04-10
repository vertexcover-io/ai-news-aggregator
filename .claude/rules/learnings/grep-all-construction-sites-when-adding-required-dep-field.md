# Grep all construction sites when adding a required field to a shared dep shape

When you add a required field to a shared dependency/context interface (e.g. `RunProcessDeps`, a React context value, a handler options bag), do not trust that updating the primary factory function is enough. Tests and alt entrypoints frequently construct the object directly, bypassing the factory — these are invisible to the type system only until you grep for them, because TypeScript will happily error at the call site but the orchestrator will miss them if they live in a test file that was not opened.

Workflow when adding a required field to any `*Deps`, `*Options`, `*Context`, or similar shape:
1. Update the interface in one place.
2. Run `rg "<TypeName>\\b"` across the whole repo (not just the package you are editing).
3. For every match that is NOT a type-only import, verify it either (a) goes through the factory you just updated, or (b) constructs the shape directly and needs the new field.
4. Run `pnpm typecheck` AND `pnpm test:e2e` (or the equivalent) — unit tests typically use the factory, e2e tests often hand-build deps.

```ts
// BAD: only the factory is updated
export interface RunProcessDeps {
  collectorFn: CollectorFn;
  rankFn: RankFn;
  shortlistFn: ShortlistFn; // new required field
}
export function createRunProcessWorker(deps: RunProcessDeps) { ... }

// Meanwhile in run-process.e2e.test.ts (untouched):
const deps = { collectorFn: fakeCollect, rankFn: fakeRank } as RunProcessDeps; // silently stale
// GOOD: grep found it, fixture updated with shortlistFn: fakeShortlist
```

Why: In the personalized-ranking run, phase 7 added `shortlistFn` to `RunProcessDeps` and updated `createRunProcessWorker`, but two pre-existing e2e tests (`run-flow.e2e.test.ts`, `run-process.e2e.test.ts`) constructed deps directly and silently broke. Unit tests passed because they used the factory; the break was only caught because phase 10 ran `pnpm --filter @newsletter/pipeline test:e2e`. Without the e2e step it would have hit CI. The rule: required-field additions to dep shapes are search-and-replace operations, not "edit one file" operations.
