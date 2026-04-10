# Without `noUncheckedIndexedAccess`, defensive array-index undefined guards trigger lint

When `noUncheckedIndexedAccess` is NOT enabled in `tsconfig.json`, TypeScript types `arr[i]` as `T` (not `T | undefined`). This means any guard like `if (arr[i] !== undefined)` is always true, and ESLint's `@typescript-eslint/no-unnecessary-condition` flags it as a lint error. Similarly, `arr[i]!` non-null assertions and unnecessary `as T` type assertions in tests trigger `no-non-null-assertion` / `no-unnecessary-type-assertion`.

## Rule

Access array elements directly — do not defensively guard against `undefined` unless the tsconfig has `noUncheckedIndexedAccess: true`:

```ts
// BAD: triggers no-unnecessary-condition when noUncheckedIndexedAccess is off
if (candidates[i] !== undefined) {
  process(candidates[i]);
}

// GOOD: access directly
process(candidates[i]);

// BAD in tests: triggers no-non-null-assertion
expect(results[0]!.score).toBeGreaterThan(0);

// GOOD in tests: use optional chaining
expect(results[0]?.score).toBeGreaterThan(0);
```

For loops over a known-length array, prefer `for...of` or `.forEach` which give you a typed element directly and sidestep index access entirely:

```ts
// GOOD: no index access, no guard needed
for (const candidate of candidates) {
  process(candidate);
}
```

## Why

In the improved-ranking-system run, Phase 3 (semantic-dedup.ts) added defensive `!== undefined` guards on array element accesses as a style choice. Because the project tsconfig does not set `noUncheckedIndexedAccess: true`, these guards were flagged as unnecessary conditions by `@typescript-eslint/no-unnecessary-condition`, producing 24 lint errors. The test file also used `!` assertions on indexed results (`results[0]!.id`) which triggered `no-non-null-assertion`. All 24 errors required manual cleanup after the parallel wave completed — work that could have been avoided by knowing the tsconfig baseline.

## When this changes

If `noUncheckedIndexedAccess: true` is added to the root tsconfig, the rule inverts: TypeScript will type `arr[i]` as `T | undefined` and the guards become necessary. Before adding index-access guards, check `tsconfig.json` for this flag.
