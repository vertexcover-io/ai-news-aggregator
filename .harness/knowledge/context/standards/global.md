---
id: S-global
applies_to: ["**/*.ts", "**/*.tsx"]
enforced_by: tsconfig
decisions: []
last_verified_sha: ad0153a
status: active
---

# Global standards

## S-global-01 — TypeScript strict mode

**Rule:** All TypeScript code must compile under `strict: true` (root tsconfig.json). No `any` types, no `@ts-ignore`, no `as unknown as X` casts.

**Why:** Catches null/undefined errors, implicit any, and missing return types at compile time.

**Enforced by:** tsconfig `strict: true` (fails CI via `pnpm typecheck`)

**Smell:** `as any`, `@ts-ignore`, `as unknown as TargetType`

## S-global-02 — Exact dependency versions

**Rule:** All dependencies use exact versions (no `^` or `~` ranges in package.json).

**Why:** Prevents surprise breakage from semver-minor updates.

**Enforced by:** convention (not linted, checked in code review)

**Smell:** A `^` or `~` prefix in `package.json` dependencies.

## S-global-03 — No premature abstractions

**Rule:** Don't create util helpers, wrapper classes, or generic abstractions for things used only once. Three similar lines of code is better than a premature abstraction.

**Why:** Keeps code simple and avoids speculative indirection.

**Enforced by:** convention (not linted)

**Smell:** A new helper/wrapper/class created for a single call site.

## S-global-04 — Log at service boundaries only

**Rule:** Log at system boundaries: job started/completed, API requests, external API calls. Don't log inside tight loops or internal helper functions.

**Why:** Keeps logs signal-dense. Internal helpers called in loops produce noise.

**Enforced by:** convention (not linted)

**Smell:** `logger.info` inside a `for-of` loop or a pure computation function.
