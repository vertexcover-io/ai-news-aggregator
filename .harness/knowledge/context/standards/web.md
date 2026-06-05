---
id: S-web
applies_to: ["packages/web/src/**"]
enforced_by: convention
decisions: [D-100]
last_verified_sha: 5a2ff20
status: active
---

# Web standards

## S-web-01 — Subpath-only shared imports

**Rule:** All imports from `@newsletter/shared` must use subpaths (`@newsletter/shared/types`, `@newsletter/shared/constants`). Never import from the root `@newsletter/shared` barrel — it pulls `postgres` into the browser bundle.

**Enforced by:** convention (not linted, enforced by learnings rule and code review)

**Smell:** `import { RunSummary } from "@newsletter/shared"` — missing subpath.

## S-web-02 — API calls through client wrappers

**Rule:** All HTTP calls go through `api/client.ts` wrappers (`apiFetch`, `apiFetchAdmin`). Components and hooks never call `fetch` directly — except `api/eval.ts::runEval` which needs `ReadableStream` for SSE.

**Enforced by:** convention (not linted)

**Smell:** `await fetch("/api/...")` in a component or hook file.

## S-web-03 — Pages are thin

**Rule:** Page components compose hooks (data fetching + state) with presentational components. Business logic lives in hooks; rendering logic lives in components.

**Enforced by:** convention (not linted)

**Smell:** A page component with >50 lines of inline data fetching or state management logic.
