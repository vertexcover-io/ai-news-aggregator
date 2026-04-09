# Phase 7: `tools/check-repo-invariants.ts` script

> **Status:** pending

## Overview

Ship the Layer 3 checks as a standalone tsx script. These are file-shape and configuration invariants that ESLint can't naturally express: `package.json` version pinning, AI SDK major-version alignment, `vitest.config.ts` exclusion from `tsc -b`, and `docker`/`docker-compose` references. The script runs alongside `pnpm lint` and fails the build on any violation. <!-- invariants:allow docker -->

## Implementation

**Files to create:**
- `tools/check-repo-invariants.ts` — the script entry point
- `tools/invariants/package-json-pinning.ts` — REQ-081
- `tools/invariants/ai-sdk-alignment.ts` — REQ-082
- `tools/invariants/vitest-config-excluded.ts` — REQ-083
- `tools/invariants/no-docker-references.ts` — REQ-084
- `tools/invariants/index.ts` — aggregates checks and produces a final report
- `tools/tests/check-repo-invariants.test.ts` — unit tests for the pure check functions
- `tools/tests/fixtures/` — small fixture files (bad `package.json`, good `package.json`, etc.)

**Files to modify:**
- `package.json` (root) — add `"check:invariants": "tsx tools/check-repo-invariants.ts"`
- `package.json` (root) — change `"lint": "turbo lint"` → `"lint": "turbo lint && pnpm check:invariants"` (REQ-085). Alternative: add it to `turbo.json` as a dependency — but `turbo.json` is per-package oriented, so chaining at the root script level is simpler and clearer.
- `turbo.json` — no changes needed if we chain at the root script level
- `tsconfig.json` (root, if it exists) — include `tools/**` or give `tools/` its own tsconfig so the script typechecks

### Script shape

`tools/check-repo-invariants.ts`:
```ts
#!/usr/bin/env tsx
import { runAllInvariants } from "./invariants/index.js";

const result = runAllInvariants({ cwd: process.cwd() });
if (result.violations.length === 0) {
  console.log("✓ All invariants pass.");
  process.exit(0);
}

console.error("✗ Invariant violations:");
for (const v of result.violations) {
  console.error(`  [${v.invariant}] ${v.file}${v.line ? `:${v.line}` : ""} — ${v.message}`);
}
process.exit(1);
```

### Individual checks

**`package-json-pinning.ts` (REQ-081, EDGE-007):**
- Walk every `package.json` in the workspace (use `fast-glob` — already a transitive dep, check before adding; if not, use Node's `fs` + manual recursion)
- For each `dependencies`, `devDependencies`, `peerDependencies`, flag any value starting with `^` or `~`
- Allow `workspace:*` and `workspace:^` (EDGE-007 says `workspace:*` is treated as exact) — but NOT `^1.0.0`

**`ai-sdk-alignment.ts` (REQ-082, EDGE-008):**
- Find all `package.json` files
- Collect: the `ai` version (if present) and every `@ai-sdk/*` version (if any)
- If both `ai` and at least one `@ai-sdk/*` are present, assert their major versions match
- EDGE-008: if `@ai-sdk/*` is absent entirely, do not flag

**`vitest-config-excluded.ts` (REQ-083, EDGE-011):**
- Walk packages with a `vitest.config.ts`
- For each such package, read `tsconfig.json` and assert the `exclude` array includes `"vitest.config.ts"`
- EDGE-011: if no `vitest.config.ts` exists, skip

**`no-docker-references.ts` (REQ-084, EDGE-009):**
- Walk `packages/**`, `tools/**`, `docs/**` (skip `node_modules`, `dist`, `.worktrees`)
- For each file with `.ts`, `.tsx`, `.js`, `.json`, `.md`, `.yml`, `.yaml` extension, scan for the strings `docker-compose` and `docker ` (with trailing space) <!-- invariants:allow docker -->
- EDGE-009: skip files/lines that contain an inline allowlist marker `invariants:allow docker` (flexible — accept in a comment)

### Test strategy

Unit tests (vitest) exercise each check function with small fixture inputs:
- `package-json-pinning`: pass a good package.json → empty violations; pass one with `"lodash": "^4.0.0"` → one violation
- `ai-sdk-alignment`: pass `{ ai: "5.0.0", "@ai-sdk/openai": "5.0.0" }` → pass; pass `{ ai: "5.0.0", "@ai-sdk/openai": "6.0.0" }` → one violation; pass only `{ ai: "5.0.0" }` → pass (EDGE-008)
- `vitest-config-excluded`: pass a fixture with exclude array missing `vitest.config.ts` → violation
- `no-docker-references`: pass text with `docker-compose up` → violation; pass text with `docker-compose` preceded by `<!-- invariants:allow docker -->` → no violation

An integration test runs the full `check:invariants` script on the current repo and expects it to pass (since the repo is clean).

### Turborepo integration

Keep the wiring simple: change root `lint` script to `turbo lint && pnpm check:invariants`. This runs per-package lint first (cached), then the invariants check.

**Traces to:** REQ-080, REQ-081, REQ-082, REQ-083, REQ-084, REQ-085, EDGE-007, EDGE-008, EDGE-009, EDGE-011

**Commit:** `feat(VER): add tools/check-repo-invariants.ts with pinning + alignment checks`

## Done When

- [ ] `pnpm check:invariants` exits 0 on the clean tree
- [ ] Each invariant has unit tests covering at least one pass + one fail fixture
- [ ] Fixtures include EDGE-007, EDGE-008, EDGE-009, EDGE-011
- [ ] `pnpm lint` at root chains both `turbo lint` and `check:invariants`
- [ ] Root `package.json` has the new `check:invariants` script
- [ ] `pnpm typecheck` still passes monorepo-wide (including `tools/`)
