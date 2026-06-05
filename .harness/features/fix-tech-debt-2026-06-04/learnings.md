# Learnings — fix-tech-debt-2026-06-04

## 1. Phase-claims land in main .harness/, not the worktree's (known + reproduced)

The `.claude/rules/learnings/harness-path-resolution-in-worktrees.md` rule was confirmed again in phase 3: phase-{1,2,4,5}-claims.json all landed in the main checkout's `.harness/fix-tech-debt-2026-06-04/`, while the task's instructions referenced `.harness/fix-tech-debt-2026-06-04/claims.json` as if it were a single aggregated file. Only `phase-3-claims.json` existed in the worktree's harness (likely written by the orchestrator sub-agent). Functional verification adapted by reading from the main harness path directly.

**Action:** Future verify tasks should always check `$(git rev-parse --git-common-dir)/../.harness/` when the worktree harness path is empty.

---

## 2. vitest 4.1.8 blocked by constructor-mock breaking change

Phase 1 attempted vitest `4.1.8` upgrade per REQ-1. The `vi.spyOn(SomeClass, 'prototype')` and constructor-mock patterns used in several pipeline worker tests break on vitest 4 (changed `mockImplementation` semantics on `new` calls). Migration cost exceeded config-file changes — disposition `issue` applied per the spec fallback. The project stays on `3.2.1`.

**Action:** vitest 4 migration requires a separate PR auditing all constructor-mock test patterns and rewriting them with the new `vi.fn()` class-mock API. Add this to the next tech-debt pass.

---

## 3. `pnpm lint` requires `pnpm build` first in this monorepo

The eslint-plugin's custom rules are loaded from `packages/eslint-plugin/dist/`. If the dist is stale or missing, `pnpm lint` crashes (cannot resolve rule `newsletter/*`). Baseline notes this explicitly; functional verification hits it if cache is cold. Always run `pnpm build` before `pnpm lint` in CI or fresh checkout.

---

## 4. CC reduction expectations vs reality for React page components

Phase 4 targeted CC≥16 functions. In the React page components (`EvalIndexPage.tsx`, `ReviewPage.tsx`), most high-CC comes from deeply nested JSX conditionals that are semantically single-purpose rendering branches — splitting them into sub-components reduces lines but the new sub-component usually has CC 5–10 itself, so the "total complexity of the module" doesn't reduce. The refactor goal for these was structural (file under 400 lines) rather than CC-numeric. Plan for future: track JSX complexity separately from algorithmic complexity; don't target CC alone for React pages.

---

## 5. Static serving of pre-built web bundle requires a proxy for /api routes

The verification step tried `npx serve dist` and `python3 -m http.server` for the web package — both serve static files only and don't proxy `/api` to the backend (port 3000). Login silently failed (POST /api/admin/login returned 404 from serve). Fix: write a tiny node HTTP proxy inline or use `vite preview` (which does respect the `proxy` config) instead. On this machine, inotify watch limit (65536) prevented `vite dev` — increasing it requires sudo. Future: add `SESSION_SECRET` to `.env.test` and lift the limit in CI config.

---

## 6. Dispositions: deferred handoffs look like conflicts but aren't

Phase 2 marked two finding IDs as `dropped` with reason "deferred to phase 3/5 stream to avoid cross-PR conflict". Phase 3 and 5 then fixed them, reusing the same ID with status `fixed`. The VS-4 validation script detected these as "same id, different dispositions across files" and flagged them as conflicts. They are not conflicts — the `dropped` + reason "deferred" is the canonical signal. Future manifest validation scripts should treat (dropped + "deferred to phase X") followed by (fixed in phase X) as valid; only flag conflicts where both statuses are terminal and different.
