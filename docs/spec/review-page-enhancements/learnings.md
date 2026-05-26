---
title: "review-page-enhancements learnings"
date: 2026-05-26
spec: review-page-enhancements
---

# review-page-enhancements — Implementation Learnings

---

## Learning 1: Discriminant field names in cross-package discriminated unions must be frozen in Phase 1

**Date:** 2026-05-26  
**Category:** gotchas  
**Severity:** medium

### Problem

The `ItemPreview` discriminated union (`TweetPreview | LinkPreview | NoPreview`) was designed in Phase 1 (shared types) with a `kind` discriminant field. During implementation, an earlier draft of the spec and some inline code comments used `type` instead of `kind`. When Phase 4 wrote UI components (`ExpandedPreview.tsx`) and Phase 2 wrote the API serializer (`buildItemPreview`), both had to agree on the same literal field name.

A mismatch — `switch (preview.type)` in the UI vs. `kind: "tweet"` in the API — causes a silent runtime failure: TypeScript won't catch it if `type` is declared `string | undefined` on the interface, and the UI falls through to a no-preview fallback with no error.

### Insight

**The discriminant field name is a contract, not an implementation detail — it must be locked in the shared type definition and never changed unilaterally by any phase.**

Because `switch (preview.kind)` appears in:
- The API serializer (`buildItemPreview` in `rank-hydration.ts`)
- The web component (`ExpandedPreview.tsx`)
- All unit tests for both

...a rename requires touching every consumer simultaneously. Lock the field name in Phase 1 types and have Phase 1 tests explicitly assert the discriminant string literals:

```ts
// Phase 1 test: assert literal values, not just structural compatibility
expect(preview).toMatchObject({ kind: "tweet" });
// NOT: expect(preview.kind).toBeDefined()
```

### Prevention

- In Phase 1, write a test that constructs each variant with the exact discriminant literal and checks `preview.kind === "tweet"`, `"link"`, `"none"`.
- Search Phase 2+ for any `preview.type` or `item.type` after the switch — grep for both `kind` and `type` to catch divergence early.
- The discriminant field name must appear verbatim in the spec's type definitions section, not just in prose.

---

## Learning 2: API response shapes must be unit-tested before web hooks consume them

**Date:** 2026-05-26  
**Category:** gotchas  
**Severity:** medium

### Problem

`useSourceFacets` (web hook) was written to expect a flat `{sourceType, identifier, count}[]` array from `GET /api/admin/archives/:runId/source-facets`. During development, the route's early implementation returned a different shape (nested grouping). Because the web unit tests mock the API client and the API unit tests run independently, the shape mismatch only surfaced during end-to-end browser testing (VS-2).

### Insight

**When a new API endpoint is added in the same PR as a web hook that consumes it, the API unit test must assert the exact JSON shape the hook expects — not just that the route returns 200.**

The pattern that prevents this:

1. API unit test: `expect(body[0]).toEqual({ sourceType: "reddit", identifier: "r/LocalLLaMA", count: 1 })`
2. Web hook test: mock the client with the same literal shape from step 1
3. This forces both to agree on the same TS interface — the interface becomes the single source of truth

Without step 1, the API test passes with any `200` response, and the mismatch hides until runtime.

### Prevention

- For any new API endpoint: the unit test must assert the exact response shape using `.toEqual(...)` on at least one response item, not just status codes and counts.
- The TypeScript interface shared between `packages/api/` and `packages/web/` (exported from `@newsletter/shared/types`) is the contract — both sides must import and use it. If the type is not in shared, add it.
- After writing the API test, read it to the web hook author before they write the mock — this is the cheapest integration check available.

---

## Learning 3: tsx/esbuild dev server is incompatible with some transitive deps — build first for integration testing

**Date:** 2026-05-26  
**Category:** gotchas  
**Severity:** low

### Problem

During end-to-end verification, starting the API server via `tsx watch` (the dev-mode command) produced a `TransformError: Cannot find module 'domhandler'` failure. The cause was a tsx/esbuild version incompatibility with a transitive dependency (`domhandler`) introduced by `react-markdown` in the web package (which shares the lockfile).

### Solution

Build the API first with tsup, then run the compiled output:

```bash
pnpm --filter @newsletter/api build
API_PORT=3055 node packages/api/dist/index.js
```

This is always the correct approach for integration/e2e verification because it tests the actual production artifact, not a tsx-transpiled dev build.

### Prevention

- In any harness proof-report or e2e script: always start the API via `node dist/index.js` after a prior `pnpm --filter @newsletter/api build`, never via `tsx watch`.
- If `tsx watch` fails with a module-not-found for a package that exists in `node_modules`, suspect a tsx/esbuild version conflict and switch to the compiled output.

---

## Learning 4: vite CLI args are not forwarded through pnpm filter exec

**Date:** 2026-05-26  
**Category:** gotchas  
**Severity:** low

### Problem

Running `pnpm --filter @newsletter/web exec vite --port 5188 --strictPort` does not forward `--port 5188` to the vite binary — `exec` passes args to the binary but the flags were silently ignored, causing vite to start on its default port (5173) instead of 5188.

### Solution

Use `npx vite` directly inside the package directory, or pass through the pnpm `run` script (which forwards `-- --port 5188`):

```bash
cd packages/web && VITE_API_TARGET=http://127.0.0.1:3055 npx vite --port 5188 --strictPort
```

### Prevention

- In harness probes and proof scripts, always start the web dev server via the direct path above.
- If a port is required for isolation (non-default port), verify the server actually bound to that port with `lsof -ti:<PORT>` before running browser tests.
