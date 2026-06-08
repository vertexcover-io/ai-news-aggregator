---
title: "Extending a shared TypeScript interface requires rebuilding shared before downstream packages typecheck"
date: 2026-06-08
category: gotchas
tags: [typescript, monorepo, turborepo, shared-package, interface, build]
component: shared
severity: medium
status: implemented
applies_to: ["packages/shared/src/**/*.ts", "packages/api/src/**/*.ts", "packages/pipeline/src/**/*.ts"]
stage: [code]
evidence_count: 1
last_validated: 2026-06-08
source: phase-3@centralized-observability
related: []
---

# Extending a shared TypeScript interface requires rebuilding `shared` before downstream packages typecheck

## Problem

Adding new methods (`list()`, `setStatus()`) to the `IncidentRepository` interface in `packages/shared/src/types/incident.ts`, then running `pnpm --filter @newsletter/api typecheck` immediately produced errors like:

```
Type 'IncidentsRepo' is missing the following properties from type 'IncidentRepository': list, setStatus
```

The `IncidentsRepo` implementation did define those methods. The error was a stale `dist/` in `@newsletter/shared`.

## Insight

**TypeScript in a monorepo reads `.d.ts` files from the compiled `dist/`, not from source.** `tsconfig.json` path mappings point `@newsletter/shared` to `packages/shared/dist/`. When `dist/` is stale, downstream packages see the old interface definition, not the current source.

This trips you when:
1. You add a method to a shared interface.
2. You implement it in both `api` and `pipeline`.
3. Typecheck still fails with "missing property" — because `dist/` hasn't been rebuilt.

The error looks like a missing implementation, but the implementation is there.

## Solution

```bash
# After modifying any shared interface or type:
pnpm --filter @newsletter/shared build

# Then downstream typechecks will see the updated .d.ts:
pnpm --filter @newsletter/api typecheck
pnpm --filter @newsletter/pipeline typecheck

# Or just run the root typecheck (Turborepo respects the dependency graph):
pnpm typecheck
```

Turborepo's root `pnpm typecheck` already runs `shared:build` before `api:typecheck` / `pipeline:typecheck` because the dependency is declared in `turbo.json`. Use the root command when unsure.

## Prevention / Reuse

- **After any change to `packages/shared/src/`:** run `pnpm --filter @newsletter/shared build` before typechecking a downstream package in isolation.
- **"Missing property" on a shared interface you just implemented** → rebuild shared first, then retry.
- **Root `pnpm typecheck` is always safe** — Turborepo handles the build order. Per-package typechecks in isolation skip the dependency build.
- **If `pnpm typecheck` fails but the code looks correct**, check whether `packages/shared/dist/` is stale (run `ls -la packages/shared/dist/*.d.ts` and compare timestamps to the source file).
