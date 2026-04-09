# Plan: Custom ESLint Plugin

> **Source:** `docs/plans/2026-04-09-custom-eslint-plugin-design.md` + `docs/spec/custom-eslint-plugin/spec.md`
> **Created:** 2026-04-09
> **Status:** planning

## Goal

Ship `@newsletter/eslint-plugin` (workspace package) with v1 rules enforcing project conventions, plus a `tools/check-repo-invariants.ts` script for non-AST checks, wired into `pnpm lint`. All rules start at severity `"warn"`.

## Acceptance Criteria

- [ ] `@newsletter/eslint-plugin` workspace package exists, builds, typechecks, lints, and has passing RuleTester unit tests
- [ ] All 5 custom rules (`dotenv-bootstrap`, `no-bundled-readfilesync`, `enforce-repository-access`, `collector-return-shape`, `no-raw-alter-table`) ship with code + tests + docs + meta.docs.url resolving
- [ ] Layer 1 boundary rules (pipeline→api, pipeline→hono, web→drizzle, api/routes→db) wired via `no-restricted-imports` in root `eslint.config.mjs`
- [ ] `tools/check-repo-invariants.ts` runs as part of `pnpm lint`, passes on the clean tree, catches all REQ-081..085 violations on fixtures
- [ ] Zero pre-existing violations of `enforce-repository-access` (refactored into repositories)
- [ ] `docs/rules/README.md` contains the decision tree
- [ ] All baseline checks still pass: `pnpm typecheck` 5/5, `pnpm lint` 4+1/5, `pnpm test:unit` ≥178 passing

## Codebase Context

### Monorepo layout
- `packages/shared` — Drizzle schema, DB client, Redis helper, shared types. Subpath exports: `.`, `./db`, `./types`, `./constants`, `./utils`, `./logger`.
- `packages/api` — Hono REST API. Entrypoint `src/index.ts` already has dotenv bootstrap.
- `packages/pipeline` — BullMQ workers. Entrypoint `src/index.ts` already has dotenv bootstrap.
- `packages/web` — React + Vite frontend.
- `eslint.config.mjs` (root) — flat config with `tseslint.configs.strictTypeChecked` + `stylisticTypeChecked`, `projectService: true`. Test files have relaxed typing.

### Existing repository pattern
- `packages/pipeline/src/repositories/raw-items.ts` is the canonical example: `createRawItemsRepo(db)` returns an object with query methods; collectors and workers consume it via dependency injection.

### Pre-existing runtime DB access violations (must be refactored in Phase 4)
- `packages/api/src/services/rank-hydration.ts` — `import { inArray } from "drizzle-orm"`
- `packages/pipeline/src/services/candidate-loader.ts` — `and`, `gte`, `inArray`, `rawItems`
- `packages/pipeline/src/workers/collection.ts` — `getDb`, `createRedisConnection`
- `packages/pipeline/src/queues/processing.ts` — `createRedisConnection` from `@newsletter/shared/db`
- `packages/pipeline/src/queues/collection.ts` — `createRedisConnection` from `@newsletter/shared/db`
- Note: `createRedisConnection` is Redis-only but currently lives under `@newsletter/shared/db`. Phase 4 extracts it to `@newsletter/shared/redis` so blocking the `db` subpath doesn't catch legitimate Redis imports.

### Type-only imports are allowed everywhere
Per user decision during planning, `import type { ... }` from `@newsletter/shared/db` or `drizzle-orm` is always allowed. The `enforce-repository-access` rule only flags value imports. This refines SPEC REQ-050 and will be documented in the rule's docs page and as a note in `spec.md`.

### Test infrastructure
- Runner: Vitest 3 (project split into `unit` + `e2e`)
- ESLint rule testing: `@typescript-eslint/rule-tester` (add as new exact-version devDep in Phase 1)
- Run: `pnpm test:unit` at root (Turborepo scoped)

### Library versions to pin exactly (per tooling.md)
- `@typescript-eslint/utils` — match the existing `typescript-eslint` 8.58.0 family
- `@typescript-eslint/rule-tester` — match the utils version

### Rules from .claude/rules/ driving this feature
- `architecture.md` — package boundaries, collector pattern, repository pattern
- `code-quality.md` — strict TS, no `any`, no speculative features
- `tooling.md` — pnpm-only, exact versions, podman-compose
- `.claude/rules/learnings/*.md` — the source-of-truth for which traps each rule prevents

## Phase Graph

```dot
digraph phases {
  rankdir=LR
  node [shape=box]

  p1 [label="Phase 1:\nScaffold @newsletter/eslint-plugin"]
  p2 [label="Phase 2:\nLayer 1 boundaries\n+ dotenv-bootstrap"]
  p3 [label="Phase 3:\nno-bundled-readfilesync\n+ no-raw-alter-table"]
  p4 [label="Phase 4:\nRefactor DB violations\ninto repositories"]
  p5 [label="Phase 5:\nenforce-repository-access"]
  p6 [label="Phase 6:\ncollector-return-shape\n(type-aware)"]
  p7 [label="Phase 7:\ntools/check-repo-invariants.ts"]
  p8 [label="Phase 8:\nDocs + learning footers"]

  p1 -> p2 -> p3 -> p4 -> p5 -> p6 -> p7 -> p8
}
```

Fully sequential. Each phase leaves the tree green (`pnpm lint`, `pnpm typecheck`, `pnpm test:unit` all passing), commits, hands off.

## Phase Summary

| # | Phase | Traces to |
|---|-------|----------|
| 1 | Scaffold `@newsletter/eslint-plugin` + plumbing | REQ-001, REQ-002, REQ-003, REQ-005, REQ-010, REQ-011, REQ-012, REQ-090 |
| 2 | Layer 1 boundary rules + `dotenv-bootstrap` | REQ-014, REQ-020..023, REQ-030..032, EDGE-001, EDGE-002 |
| 3 | `no-bundled-readfilesync` + `no-raw-alter-table` | REQ-040..043, REQ-070..071, EDGE-004, EDGE-010 |
| 4 | Refactor pre-existing DB violations into repositories | (enables Phase 5 clean baseline) |
| 5 | `enforce-repository-access` rule | REQ-050..053, EDGE-003, EDGE-006 |
| 6 | `collector-return-shape` type-aware rule | REQ-060..062, EDGE-005, EDGE-012, EDGE-015 |
| 7 | `tools/check-repo-invariants.ts` script | REQ-080..085, EDGE-007..009, EDGE-011 |
| 8 | Docs sync + learning footers + CLAUDE.md | REQ-091, REQ-092, docs polish |

## SPEC Clarifications

These refine items in `spec.md` based on planning-stage decisions:

1. **REQ-050 (enforce-repository-access scope):** The rule allows `import type { ... }` from both `@newsletter/shared/db` and `drizzle-orm` in all files. Only *value* imports outside `**/repositories/**` and `**/tests/**` are flagged. This will be documented in the rule's docs page.
2. **`createRedisConnection`:** Moved to `@newsletter/shared/redis` subpath (Phase 4) so that Redis-only importers don't touch the `db` subpath at all.
3. **REQ-014 (warn-first):** All new rules ship at `"warn"`. The quality gate must treat new warnings as non-blocking; only errors block.
4. **Pre-existing violations refactor (per user):** In scope for this PR. Phase 4 handles them before Phase 5 turns on the rule.

## Open Questions (deferred, not blocking this plan)

- Should any of the Layer 1 rules eventually use `eslint-plugin-boundaries` instead of `no-restricted-imports`? Defer — `no-restricted-imports` is working for now.
- Should the invariants script become an ESLint plugin for JSON via `eslint-plugin-jsonc`? Defer — the standalone script is simpler and self-contained.
- Should rule severity auto-promote from `warn` to `error` via a separate "promotion PR" workflow? Out of scope; tracked in design doc rollout plan.
