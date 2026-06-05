---
title: "useCallback depending on the whole react-query result object defeats memoization"
date: 2026-06-06
category: gotchas
tags: [react, react-query, useCallback, memoization, hooks, performance]
component: web/hooks/usePool
severity: low
status: implemented
applies_to: ["packages/web/src/hooks/**/*.ts", "packages/web/src/**/*.tsx"]
stage: [code, review]
evidence_count: 1
last_validated: 2026-06-06
source: review-fix@review-page-issues-audit
related: []
---

# `useCallback` depending on the whole react-query result object defeats memoization

## Problem

`usePool.ts` had a callback that needed to call `query.refetch()`. The first draft listed `query` (the entire `UseQueryResult` object) in the `useCallback` dependency array:

```ts
const refetch = useCallback(() => {
  void query.refetch();
}, [query]); // ← depends on the whole query object
```

`react-query` returns a **new object reference on every render** even when no data changes (the query result is reconstructed each render cycle). `useCallback` compares dependencies with `Object.is` — since `query !== query` across renders, the callback is recreated on every render, making the `useCallback` a no-op that wastes time computing a new closure instead of reusing a stable one.

## Insight

**Only depend on stable values from react-query results.** The `data`, `status`, `isPending`, etc. fields change when the query state changes — these are fine as deps if you actually use them. But **`query.refetch` is a stable function** that does not change between renders; it can be extracted and used as a dependency directly.

This pattern applies to any hook that returns a stable function (e.g. `query.refetch`, `mutation.mutate`, `setters` from `useState`).

## Solution

```ts
// BEFORE — depends on whole query object (recreates callback every render):
const refetch = useCallback(() => {
  void query.refetch();
}, [query]);

// AFTER — depends only on the stable refetch fn:
const refetch = useCallback(() => {
  void query.refetch();
}, [query.refetch]);
```

`query.refetch` is a stable reference across renders (react-query guarantees this). The callback is now only recreated when the query's refetch function itself changes (i.e., on `queryKey` changes), which is the intended behavior.

## Prevention / Reuse

- When using `useCallback` or `useMemo` with react-query results, extract only the specific fields you need as dependencies — never pass the whole result object.
- `query.refetch`, `mutation.mutate`, and `mutation.mutateAsync` are stable references; prefer them as deps over `query` or `mutation`.
- If you need multiple fields from the query result inside a callback, extract each: `const { data, refetch } = query; useCallback(..., [data, refetch])`.
- TypeScript won't warn about over-specification in deps arrays — a linter rule (`react-hooks/exhaustive-deps`) will warn about under-specification but not over-specification. Review deps lists manually during code review.
