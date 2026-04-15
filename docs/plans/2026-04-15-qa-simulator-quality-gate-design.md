# QA Simulator Quality Gate Design

**Date:** 2026-04-15  
**Author:** Aman Kumar  
**Status:** Approved

## Overview

Upgrade the orchestrate pipeline's quality gate to include a human-simulator QA layer specific to the newsletter project. Claude acts as both a spec-driven verifier (checks every REQ ID from the feature SPEC) and an exploratory QA engineer (freeform Playwright-based regression testing). This replaces the generic "smoke test" and "E2E tests" checks in the global harness with meaningful, project-aware verification.

Additionally, reorganize the existing pipeline e2e tests into two clear categories (seam vs. network), and wire the global harness to respect project-local skill overrides.

## Goals

- Claude can verify every functional and non-functional requirement from a SPEC after a feature is built
- The quality gate catches regressions the automated test suite misses (UI flows, API contracts, data persistence)
- Orchestrate sessions in the newsletter project automatically use the local quality-gate skill
- E2E test files are clearly categorized by intent — no ambiguity about whether a test hits the real network

## Non-Goals

- Not a new QA iteration loop — QA runs once in the quality gate, reports PASS or BLOCKED, done
- Not a replacement for the existing Vitest e2e or Playwright test suites — those still run as Check 3
- Not a global harness redesign — only 3 lines change in the global orchestrate skill
- Not automated email delivery testing (Resend integration is out of scope for MVP)

---

## Architecture

```
Global Harness (harness-engineering)
  skills/orchestrate/SKILL.md     ← adds override resolution block (3 lines)
  skills/quality-gate/SKILL.md    ← unchanged (fallback for other projects)

Newsletter Project
  .claude/skills/
    quality-gate.md               ← full local override (owns everything below)
  packages/pipeline/tests/e2e/
    seam/                         ← reorganized: real DB+Redis, faked network
    network/                      ← reorganized: live external API tests (opt-in)
```

### Override Resolution (added to global orchestrate)

Before dispatching any stage that uses a named skill, the orchestrate skill checks:

```
<cwd>/.claude/skills/<skill-name>.md
```

Resolution order:
1. `<cwd>/.claude/skills/<skill-name>.md` — project-local (wins)
2. Global harness skill — fallback

Applies to: `quality-gate`, `tdd`, `testing`, `code-review`.  
Does NOT apply to: `orchestrate` itself (no recursive override).

When a local override is found, orchestrate logs:  
`"Using local skill override: .claude/skills/quality-gate/SKILL.md"`

### Compatibility Contract

The local `quality-gate.md` must emit these machine-parseable HTML comments so orchestrate can parse results:

```
<!-- QG:VERDICT:PASS -->    or    <!-- QG:VERDICT:BLOCKED -->
<!-- QG:CHECK:N:PASS -->    or    <!-- QG:CHECK:N:BLOCKED -->    (N = 1–9)
```

Everything else in the report can differ freely from the global format.

---

## Service Lifecycle

The local quality-gate skill manages service startup and teardown for all checks that require a running stack (Checks 8 and 9).

### Startup Sequence

1. **Infra check** — run `pnpm infra:up`. If Postgres + Redis are already healthy (health check passes), skip restart. Never restart running healthy infra.
2. **DB migrations** — run `pnpm --filter @newsletter/shared db:migrate`. Idempotent.
3. **API server** — start `pnpm --filter @newsletter/api dev` in background. Wait for `http://localhost:3000/health` to respond 200. Timeout: 30s.
4. **Pipeline worker** — start `pnpm --filter @newsletter/pipeline dev` in background. Wait 5s then verify by checking Redis MCP for the `bull:run-process:*` key pattern or by checking that no startup error appears in the process log. Timeout: 30s.
5. **Vite dev server** — start `pnpm --filter @newsletter/web dev` in background. Wait for `http://localhost:5173` to respond. Timeout: 30s.

If any service fails to start within its timeout, report BLOCKED immediately with the startup log as evidence. No QA checks run against a partially-started stack.

### Teardown

After all checks complete (pass or fail): kill the three background processes (API, pipeline, Vite) by PID.

Do NOT run `pnpm infra:down` — leave Postgres + Redis running so the developer can inspect state post-gate.

### Port Assignments

| Service | Port |
|---------|------|
| API (Hono) | 3000 |
| Pipeline worker | no HTTP |
| Vite dev server | 5173 |

---

## The 9 Checks

Checks 1–7 are identical in structure to the global skill, with project-specific commands filled in. Checks 8 and 9 are new.

| # | Check | Command / Method | Mandatory? |
|---|-------|-----------------|------------|
| 1 | Type checker | `pnpm typecheck` | Always |
| 2 | Linter | `pnpm lint` | Always |
| 3 | Unit + seam tests | `pnpm test:unit && pnpm test:e2e` | Always |
| 4 | Coverage | Per-package thresholds vs. baseline | Always |
| 5 | Scope compliance | LLM check: changed files vs. plan scope | Always |
| 6 | Plan compliance | LLM check: plan REQ IDs vs. implementation | Always |
| 7 | Ignore comment audit | `grep -r "@ts-ignore\|eslint-disable" packages/` | Always |
| 8 | Spec-driven verification | See below | When SPEC exists |
| 9 | Exploratory QA | See below | After Check 8 passes |

Check 9 only runs if Check 8 passes. If no SPEC exists for the current feature (e.g. a hotfix), Check 8 is `NOT_APPLICABLE` and Check 9 is skipped.

---

## Check 8: Spec-Driven Verification

### Input

The SPEC file path is derived from the plan being executed (plans reference their SPEC via a header field). Claude reads:
- The SPEC's requirements table (REQ IDs, EARS text, measurable criteria)
- The verification matrix column for `e2e` and `manual` — only these REQ IDs are exercised here

### Verification Methods by Requirement Type

| Requirement type | Verification method |
|-----------------|---------------------|
| UI flow (user navigates, clicks, sees result) | Playwright MCP — navigate, interact, assert DOM |
| API contract (request/response shape, status codes) | `curl` with `jq` assertions |
| Data persistence (DB state after action) | PostgreSQL MCP query |
| Background job (pipeline stage ran, Redis state) | Redis MCP + DB query for output |
| Non-functional (response time, error message text) | `curl --max-time` or Playwright network assertions |

### Evidence Per REQ

For each REQ ID verified, capture:
- The verification method used
- The exact command or Playwright action
- Verbatim output (first 50 + last 10 lines if >60 lines), with exit code
- PASS or FAIL verdict with reason

### Failure Handling

Any single REQ FAIL → Check 8 is BLOCKED. The report lists every REQ ID with its individual verdict so the coder agent knows exactly which requirements failed.

---

## Check 9: Exploratory QA Pass

Runs only after Check 8 passes. Claude acts as a QA engineer — not following a script, but exploring the app for regressions and edge cases the spec didn't anticipate. Budget: ~15 Playwright MCP interactions.

### Exploration Protocol

1. **Orient** — read the plan to understand what UI surfaces the feature touches
2. **Happy path replay** — navigate the primary user flow for the feature end-to-end (e.g. trigger run → wait → review page → reorder → save → archive view)
3. **Edge case probing** — try 3–5 inputs/states the SPEC doesn't explicitly cover:
   - Empty states (no runs, no items in list)
   - Error states (cancel a run mid-flight, submit invalid URL in add-post)
   - Boundary inputs (very long post title, missing optional fields)
4. **Regression spot-check** — visit 2–3 adjacent pages not directly touched by the feature; verify they load without console errors
5. **Non-functional check** — note visibly slow renders (>2s), layout breaks, missing labels

### Finding Classification

| Class | Definition | Effect on Check 9 |
|-------|-----------|-------------------|
| BLOCKER | Feature doesn't work, data loss, crash | BLOCKED |
| WARNING | Regression in adjacent feature, visual break | Reported, not BLOCKED |
| NOTE | Minor UX issue, cosmetic | Reported only |

### Evidence

Playwright MCP screenshots at each step + browser console error log captured after each interaction. All findings (including WARNINGs and NOTEs) appear in the report.

---

## E2E Test Reorganization

No tests deleted. Files reorganized into two subdirectories with a new Vitest project for the network category.

### New Structure

```
packages/pipeline/tests/e2e/
  seam/                                    ← real DB + Redis, faked network (always run)
    run-flow.e2e.test.ts
    run-process.e2e.test.ts
    personalized-ranking.e2e.test.ts
    workers/
      collection.e2e.test.ts
      run-process.e2e.test.ts
    db/
      schema.e2e.test.ts
  network/                                 ← live external APIs (opt-in only)
    collectors/
      reddit.e2e.test.ts
      web.e2e.test.ts
      hn.e2e.test.ts
```

### Vitest Config Change

Add a third test project `network` alongside existing `unit` and `e2e` (renamed to `seam`):

```ts
// vitest.config.ts
{
  project: "network",
  include: ["tests/e2e/network/**/*.e2e.test.ts"],
  testTimeout: 60000,
  enabled: process.env.RUN_NETWORK_TESTS === "1",
}
```

The `network` project:
- Only runs when `RUN_NETWORK_TESTS=1` env var is set
- Has a 60s timeout (vs. 30s for seam)
- Is excluded from `pnpm test:unit` and `pnpm test:e2e`
- Is never run by the quality gate

### package.json Script Update

The pipeline's `test:e2e` script must be updated when the Vitest project is renamed from `e2e` to `seam`:

```json
// packages/pipeline/package.json — before
"test:e2e": "vitest run --project e2e"

// packages/pipeline/package.json — after
"test:e2e": "vitest run --project seam"
```

The root `pnpm test:e2e` (via Turborepo) continues to work unchanged — it delegates to each package's `test:e2e` script.

### Quality Gate Behavior

Check 3 runs: `pnpm test:unit && pnpm test:e2e` (seam tests + Playwright web tests).  
Network tests are never triggered by the quality gate.

---

## Global Harness Change

**File:** `harness-engineering/skills/orchestrate/SKILL.md`

Add the following block to the "Stage dispatch" section:

```markdown
## Local Skill Override Resolution

Before dispatching any stage that uses a named skill, check for a project-local
override in the current working directory:

  .claude/skills/<skill-name>.md

Resolution order:
  1. <cwd>/.claude/skills/<skill-name>.md  ← project-local (wins)
  2. Global harness skill                   ← fallback

Applies to: quality-gate, tdd, testing, code-review.
Does NOT apply to orchestrate itself (no recursive override).

When a local override is found, log:
  "Using local skill override: .claude/skills/<skill-name>.md"

The local skill is loaded and followed exactly in place of the global one.
The local skill is responsible for emitting compatible QG verdict comments
so orchestrate can parse the result.
```

No other changes to the global harness. The global `quality-gate.md` is untouched.

---

## Implementation Scope

This design produces the following artifacts:

| Artifact | Action | Notes |
|----------|--------|-------|
| `.claude/skills/quality-gate/SKILL.md` | Create | Full local override skill |
| `harness-engineering/skills/orchestrate/SKILL.md` | Edit | Add override resolution block |
| `packages/pipeline/tests/e2e/seam/` | Create + move files | Reorganize existing seam tests |
| `packages/pipeline/tests/e2e/network/` | Create + move files | Reorganize existing network tests |
| `packages/pipeline/vitest.config.ts` | Edit | Add `network` project, rename `e2e` → `seam` |

## Out of Scope

- Changing the global `quality-gate.md` content
- Adding new automated tests (the reorganization only moves existing files)
- Resend / email delivery verification
- CI pipeline changes (GitHub Actions)
- Any other harness skill overrides beyond `quality-gate`
- Deployment or staging environment testing
