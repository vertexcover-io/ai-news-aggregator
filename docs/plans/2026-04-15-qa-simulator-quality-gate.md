# QA Simulator Quality Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the newsletter project's orchestrate pipeline with a human-simulator quality gate: spec-driven requirement verification (Check 8) and exploratory Playwright QA (Check 9), backed by a project-local skill override and a reorganized e2e test suite.

**Architecture:** A project-local `.claude/skills/quality-gate.md` overrides the global harness skill for all quality gate runs in this project. The global orchestrate skill gets a 3-line override resolution block so it checks for local skill overrides before using global ones. The pipeline's Vitest e2e tests are reorganized into `seam/` (always run, real DB+Redis) and `network/` (opt-in, live external APIs) subdirectories.

**Tech Stack:** TypeScript, Vitest 3, Playwright, BullMQ/Redis MCP, PostgreSQL MCP, Playwright MCP, Hono (API), Vite (web), pnpm/Turborepo

**Spec:** `docs/plans/2026-04-15-qa-simulator-quality-gate-design.md`

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Create | `.claude/skills/quality-gate.md` | Full local quality-gate skill override |
| Modify | `harness-engineering/skills/orchestrate/SKILL.md` (line ~213) | Add override resolution block before Sub-Agent Dispatch section |
| Create | `packages/pipeline/tests/e2e/seam/` | Destination for seam tests |
| Move | `packages/pipeline/tests/e2e/run-flow.e2e.test.ts` → `seam/` | Reorganize |
| Move | `packages/pipeline/tests/e2e/personalized-ranking.e2e.test.ts` → `seam/` | Reorganize |
| Move | `packages/pipeline/tests/e2e/db/schema.e2e.test.ts` → `seam/db/` | Reorganize |
| Move | `packages/pipeline/tests/e2e/workers/collection.e2e.test.ts` → `seam/workers/` | Reorganize |
| Move | `packages/pipeline/tests/e2e/workers/run-process.e2e.test.ts` → `seam/workers/` | Reorganize |
| Create | `packages/pipeline/tests/e2e/network/` | Destination for network tests |
| Move | `packages/pipeline/tests/e2e/collectors/hn.e2e.test.ts` → `network/collectors/` | Reorganize |
| Move | `packages/pipeline/tests/e2e/collectors/reddit.e2e.test.ts` → `network/collectors/` | Reorganize |
| Move | `packages/pipeline/tests/e2e/collectors/web.e2e.test.ts` → `network/collectors/` | Reorganize |
| Modify | `packages/pipeline/vitest.config.ts` | Rename `e2e` project → `seam`, add `network` project |
| Modify | `packages/pipeline/package.json` | Update `test:e2e` script to `--project seam` |

---

## Task 1: Reorganize E2E Tests — Move Seam Tests

**Files:**
- Create dirs: `packages/pipeline/tests/e2e/seam/`, `packages/pipeline/tests/e2e/seam/db/`, `packages/pipeline/tests/e2e/seam/workers/`
- Move: 5 test files into `seam/` subtree (no content changes)

- [ ] **Step 1: Create seam directory structure**

```bash
mkdir -p packages/pipeline/tests/e2e/seam/db
mkdir -p packages/pipeline/tests/e2e/seam/workers
```

- [ ] **Step 2: Move seam test files**

```bash
mv packages/pipeline/tests/e2e/run-flow.e2e.test.ts packages/pipeline/tests/e2e/seam/
mv packages/pipeline/tests/e2e/personalized-ranking.e2e.test.ts packages/pipeline/tests/e2e/seam/
mv packages/pipeline/tests/e2e/db/schema.e2e.test.ts packages/pipeline/tests/e2e/seam/db/
mv packages/pipeline/tests/e2e/workers/collection.e2e.test.ts packages/pipeline/tests/e2e/seam/workers/
mv packages/pipeline/tests/e2e/workers/run-process.e2e.test.ts packages/pipeline/tests/e2e/seam/workers/
```

- [ ] **Step 3: Verify structure**

```bash
find packages/pipeline/tests/e2e/seam -type f
```

Expected output:
```
packages/pipeline/tests/e2e/seam/run-flow.e2e.test.ts
packages/pipeline/tests/e2e/seam/personalized-ranking.e2e.test.ts
packages/pipeline/tests/e2e/seam/db/schema.e2e.test.ts
packages/pipeline/tests/e2e/seam/workers/collection.e2e.test.ts
packages/pipeline/tests/e2e/seam/workers/run-process.e2e.test.ts
```

- [ ] **Step 4: Remove now-empty old directories**

```bash
# Only remove if empty
rmdir packages/pipeline/tests/e2e/db 2>/dev/null || true
rmdir packages/pipeline/tests/e2e/workers 2>/dev/null || true
```

---

## Task 2: Reorganize E2E Tests — Move Network Tests

**Files:**
- Create dir: `packages/pipeline/tests/e2e/network/collectors/`
- Move: 3 collector test files into `network/` subtree (no content changes)

- [ ] **Step 1: Create network directory structure**

```bash
mkdir -p packages/pipeline/tests/e2e/network/collectors
```

- [ ] **Step 2: Move network test files**

```bash
mv packages/pipeline/tests/e2e/collectors/hn.e2e.test.ts packages/pipeline/tests/e2e/network/collectors/
mv packages/pipeline/tests/e2e/collectors/reddit.e2e.test.ts packages/pipeline/tests/e2e/network/collectors/
mv packages/pipeline/tests/e2e/collectors/web.e2e.test.ts packages/pipeline/tests/e2e/network/collectors/
```

- [ ] **Step 3: Remove now-empty collectors directory**

```bash
rmdir packages/pipeline/tests/e2e/collectors 2>/dev/null || true
```

- [ ] **Step 4: Verify final e2e structure**

```bash
find packages/pipeline/tests/e2e -type f | sort
```

Expected output:
```
packages/pipeline/tests/e2e/network/collectors/hn.e2e.test.ts
packages/pipeline/tests/e2e/network/collectors/reddit.e2e.test.ts
packages/pipeline/tests/e2e/network/collectors/web.e2e.test.ts
packages/pipeline/tests/e2e/seam/db/schema.e2e.test.ts
packages/pipeline/tests/e2e/seam/personalized-ranking.e2e.test.ts
packages/pipeline/tests/e2e/seam/run-flow.e2e.test.ts
packages/pipeline/tests/e2e/seam/workers/collection.e2e.test.ts
packages/pipeline/tests/e2e/seam/workers/run-process.e2e.test.ts
packages/pipeline/tests/e2e/setup/global-setup.ts
packages/pipeline/tests/e2e/setup/test-db.ts
packages/pipeline/tests/e2e/setup/test-redis.ts
```

---

## Task 3: Update Vitest Config and package.json

**Files:**
- Modify: `packages/pipeline/vitest.config.ts`
- Modify: `packages/pipeline/package.json`

- [ ] **Step 1: Update vitest.config.ts — rename e2e project to seam, add network project**

Replace the entire content of `packages/pipeline/vitest.config.ts` with:

```typescript
import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

const alias = {
  "@pipeline": resolve(__dirname, "src"),
  "@pipeline-tests": resolve(__dirname, "tests"),
};

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          setupFiles: ["tests/unit/setup.ts"],
          globals: false,
        },
      },
      {
        resolve: { alias },
        test: {
          name: "seam",
          include: ["tests/e2e/seam/**/*.e2e.test.ts"],
          testTimeout: 30000,
          globals: false,
          globalSetup: ["tests/e2e/setup/global-setup.ts"],
          fileParallelism: false,
          pool: "forks",
          poolOptions: { forks: { singleFork: true } },
        },
      },
      {
        resolve: { alias },
        test: {
          name: "network",
          include: ["tests/e2e/network/**/*.e2e.test.ts"],
          testTimeout: 60000,
          globals: false,
          globalSetup: ["tests/e2e/setup/global-setup.ts"],
          fileParallelism: false,
          pool: "forks",
          poolOptions: { forks: { singleFork: true } },
          enabled: process.env.RUN_NETWORK_TESTS === "1",
        },
      },
    ],
  },
});
```

- [ ] **Step 2: Update test:e2e script in packages/pipeline/package.json**

In `packages/pipeline/package.json`, change the `test:e2e` script from:
```json
"test:e2e": "vitest run --project e2e",
```
to:
```json
"test:e2e": "vitest run --project seam",
```

- [ ] **Step 3: Run seam tests to confirm they still pass**

```bash
pnpm --filter @newsletter/pipeline test:e2e
```

Expected: all seam tests pass (same as before the rename). If they fail, check that import paths in test files don't use relative `../` paths that would break after the move.

- [ ] **Step 4: Commit**

```bash
git add packages/pipeline/tests/e2e/ packages/pipeline/vitest.config.ts packages/pipeline/package.json
git commit -m "refactor(pipeline): reorganize e2e tests into seam/ and network/ subdirectories"
```

---

## Task 4: Add Override Resolution to Global Orchestrate Skill

**Files:**
- Modify: `harness-engineering/skills/orchestrate/SKILL.md` (insert before line 215 "## Sub-Agent Dispatch")

- [ ] **Step 1: Read the current orchestrate skill around line 213**

Open `harness-engineering/skills/orchestrate/SKILL.md` and locate the section break just before `## Sub-Agent Dispatch` (currently around line 215, after the `---` separator on line 213).

- [ ] **Step 2: Insert the override resolution block**

Insert the following block between the `---` separator (line 213) and `## Sub-Agent Dispatch` (line 215):

```markdown
## Local Skill Override Resolution

Before dispatching any stage that invokes a named skill, check for a project-local override in the current working directory:

```
<cwd>/.claude/skills/<skill-name>.md
```

Resolution order:
1. `<cwd>/.claude/skills/<skill-name>.md` — project-local (wins)
2. Global harness skill — fallback

Applies to: `quality-gate`, `tdd`, `testing`, `code-review`.
Does NOT apply to `orchestrate` itself (no recursive override).

When a local override is found, log:
> "Using local skill override: .claude/skills/\<skill-name\>.md"

The local skill is loaded and followed exactly in place of the global one. The local skill is responsible for emitting compatible verdict comments so orchestrate can parse the result:
- `<!-- QG:VERDICT:PASS -->` or `<!-- QG:VERDICT:BLOCKED -->`
- `<!-- QG:CHECK:N:PASS -->` or `<!-- QG:CHECK:N:BLOCKED -->` (N = 1–9)

---
```

- [ ] **Step 3: Verify the file reads correctly around the insertion point**

Read lines 210–230 of `harness-engineering/skills/orchestrate/SKILL.md` and confirm the new block appears between the separator and `## Sub-Agent Dispatch`.

- [ ] **Step 4: Commit in the harness repo**

```bash
cd /Users/amankumar/Documents/vertexcover/harness-engineering
git add skills/orchestrate/SKILL.md
git commit -m "feat(orchestrate): add local skill override resolution for quality-gate, tdd, testing, code-review"
cd /Users/amankumar/Documents/newsletter
```

---

## Task 5: Create the Local Quality-Gate Skill — Checks 1–7

**Files:**
- Create: `.claude/skills/quality-gate.md`

This task creates the skill file with the service lifecycle section and the first 7 checks (type checker through ignore comment audit). Checks 8 and 9 are added in Tasks 6 and 7.

- [ ] **Step 1: Create .claude/skills/ directory if it doesn't exist**

```bash
mkdir -p .claude/skills
```

- [ ] **Step 2: Create .claude/skills/quality-gate.md with header, service lifecycle, and Checks 1–7**

Create `.claude/skills/quality-gate.md` with the following content:

```markdown
---
name: quality-gate
description: Project-local quality gate for the newsletter project. Overrides the global harness quality-gate skill. Runs 9 checks including spec-driven verification (Check 8) and exploratory QA (Check 9).
---

# Newsletter Quality Gate

This skill overrides the global `harness:quality-gate` for the newsletter project. It inherits the global check structure, evidence protocol, and verdict format, but adds project-specific service lifecycle management and a human-simulator QA layer.

## Compatibility

Emit these comments so orchestrate can parse results:
- `<!-- QG:VERDICT:PASS -->` or `<!-- QG:VERDICT:BLOCKED -->`
- `<!-- QG:CHECK:N:PASS -->` or `<!-- QG:CHECK:N:BLOCKED -->` for N = 1–9

## Evidence Protocol

Every check result MUST include verbatim command output. If output >60 lines, include first 50 + last 10 lines. Always include exit code.

---

## Service Lifecycle

Run Checks 1–7 without services running. Start services only when Check 8 is reached.

### Startup Sequence (before Check 8)

1. **Infra** — run `pnpm infra:up`. If Postgres + Redis are already healthy, skip restart.
2. **DB migrations** — run `pnpm --filter @newsletter/shared db:migrate`. Idempotent.
3. **API server** — run `pnpm --filter @newsletter/api dev` in background. Wait for `http://localhost:3000/health` → 200. Timeout: 30s. Command: `curl -sf http://localhost:3000/health`
4. **Pipeline worker** — run `pnpm --filter @newsletter/pipeline dev` in background. Wait 5s, then verify via Redis MCP by checking for active worker registrations or confirm no startup error in process log. Timeout: 30s.
5. **Vite dev server** — run `pnpm --filter @newsletter/web dev` in background. Wait for `http://localhost:5173` → 200. Timeout: 30s. Command: `curl -sf http://localhost:5173`

If any service fails to start within its timeout: emit `<!-- QG:VERDICT:BLOCKED -->`, include the startup log as evidence, stop. Do not run Checks 8–9.

### Teardown (after all checks complete)

Kill the three background processes (API, pipeline, Vite) by their PIDs. Do NOT run `pnpm infra:down` — leave Postgres + Redis running for post-gate inspection.

---

## Check 1: Type Checker

```bash
pnpm typecheck
```

PASS if exit code 0. BLOCKED if any type errors.

Evidence: full output (truncated per protocol if >60 lines).

`<!-- QG:CHECK:1:PASS -->` or `<!-- QG:CHECK:1:BLOCKED -->`

---

## Check 2: Linter

```bash
pnpm lint
```

PASS if exit code 0. BLOCKED if any lint errors (warnings do not block).

Evidence: full output.

`<!-- QG:CHECK:2:PASS -->` or `<!-- QG:CHECK:2:BLOCKED -->`

---

## Check 3: Unit + Seam Tests

```bash
pnpm test:unit
pnpm test:e2e
```

Run both commands. PASS if both exit 0. BLOCKED if either fails.

Note: `pnpm test:e2e` runs Vitest `seam` project (pipeline) + Playwright (web). Network tests (`RUN_NETWORK_TESTS=1`) are NOT run here.

Evidence: output of both commands with exit codes.

`<!-- QG:CHECK:3:PASS -->` or `<!-- QG:CHECK:3:BLOCKED -->`

---

## Check 4: Coverage

Read `docs/spec/<SPEC_NAME>/baseline.json` for baseline coverage per package.

Run coverage for packages that changed:
```bash
pnpm --filter @newsletter/<package> test:unit -- --coverage
```

PASS if coverage does not regress below baseline. BLOCKED if any package regresses.

Evidence: coverage table (current vs. baseline) per package.

`<!-- QG:CHECK:4:PASS -->` or `<!-- QG:CHECK:4:BLOCKED -->`

---

## Check 5: Scope Compliance

Read the plan (`docs/spec/<SPEC_NAME>/plan.md` or the plan path passed to this skill). List every file changed since the base branch:

```bash
git diff --name-only <BASE_BRANCH>..HEAD
```

Compare against the plan's File Map. Flag any file changed that is NOT in the plan's File Map as a scope violation.

PASS if no out-of-scope changes. BLOCKED if any scope violations found.

Evidence: list of changed files, list of plan-scoped files, list of violations (or "none").

`<!-- QG:CHECK:5:PASS -->` or `<!-- QG:CHECK:5:BLOCKED -->`

---

## Check 6: Plan Compliance

Read the plan's task list. For each task, verify the implementation exists in the codebase (grep for key identifiers — function names, file paths, exports named in the plan).

PASS if all plan tasks are implemented. BLOCKED if any task's implementation is missing.

Evidence: per-task compliance check with grep results.

`<!-- QG:CHECK:6:PASS -->` or `<!-- QG:CHECK:6:BLOCKED -->`

---

## Check 7: Ignore Comment Audit

```bash
grep -r "@ts-ignore\|eslint-disable\|@ts-expect-error" packages/ --include="*.ts" --include="*.tsx" -n
```

PASS if zero results. BLOCKED if any suppression comments found (zero tolerance per project code-quality rules).

Evidence: grep output (or "No matches found").

`<!-- QG:CHECK:7:PASS -->` or `<!-- QG:CHECK:7:BLOCKED -->`
```

- [ ] **Step 3: Verify the file was created**

```bash
wc -l .claude/skills/quality-gate.md
```

Expected: ~140 lines.

---

## Task 6: Add Check 8 — Spec-Driven Verification

**Files:**
- Modify: `.claude/skills/quality-gate.md` (append Check 8 section)

- [ ] **Step 1: Append Check 8 to .claude/skills/quality-gate.md**

Append the following to `.claude/skills/quality-gate.md`:

```markdown

---

## Check 8: Spec-Driven Verification

**Precondition:** Services must be running (startup sequence above). If no SPEC file exists for the current feature, mark as `NOT_APPLICABLE` and skip Check 9.

**Input:** Read the SPEC file at the path referenced in the plan header (`Spec:` field). Extract:
- Requirements table: REQ IDs, EARS text, measurable criteria
- Verification matrix: filter to rows where the `e2e` or `manual` column is marked

**For each REQ ID in the e2e/manual verification matrix:**

Determine the verification method from the requirement type:

| Requirement type | Method |
|-----------------|--------|
| UI flow (user navigates, clicks, sees result) | Playwright MCP: navigate → interact → assert DOM |
| API contract (request/response shape, status code) | `curl` with assertions |
| Data persistence (DB state after action) | PostgreSQL MCP query |
| Background job (pipeline stage ran, Redis state) | Redis MCP + DB query |
| Non-functional (response time, error message text) | `curl --max-time` or Playwright network assertions |

**Per REQ evidence block:**

For each REQ ID, record:
1. REQ ID and EARS text
2. Verification method used
3. Exact command or Playwright MCP action taken
4. Verbatim output (first 50 + last 10 lines if >60), with exit code
5. PASS or FAIL with reason

**Failure handling:** Any single REQ FAIL → Check 8 is BLOCKED. Continue verifying remaining REQs so the full failure list is in the report (do not stop at first failure).

**SPEC not found:** If no SPEC path is resolvable, emit:
```
Check 8: NOT_APPLICABLE (no SPEC file for this feature)
<!-- QG:CHECK:8:PASS -->
```
And skip Check 9.

`<!-- QG:CHECK:8:PASS -->` or `<!-- QG:CHECK:8:BLOCKED -->`
```

- [ ] **Step 2: Verify append succeeded**

```bash
grep -n "Check 8" .claude/skills/quality-gate.md
```

Expected: one match showing the `## Check 8` heading.

---

## Task 7: Add Check 9 — Exploratory QA

**Files:**
- Modify: `.claude/skills/quality-gate.md` (append Check 9 section)

- [ ] **Step 1: Append Check 9 to .claude/skills/quality-gate.md**

Append the following to `.claude/skills/quality-gate.md`:

```markdown

---

## Check 9: Exploratory QA Pass

**Precondition:** Check 8 must have passed. If Check 8 was BLOCKED or NOT_APPLICABLE, skip Check 9.

**Budget:** ~15 Playwright MCP interactions total.

**Protocol:**

### 1. Orient
Read the plan to identify which UI surfaces the feature touches (pages, components, flows).

### 2. Happy Path Replay
Navigate the primary user flow for the feature end-to-end using Playwright MCP. For the newsletter project, the canonical flows are:

- **Run flow:** Dashboard → click "Run Now" → wait for run to appear as `completed` → click "Review" → review page loads with ranked items
- **Review flow:** Review page → drag-reorder items → remove an item → click "Save" → redirects to archive view
- **Archive flow:** Archive page → items display in saved order → "View Archive" shows correct content
- **Settings flow:** Settings page → update schedule time → save → confirm saved

Navigate only the flows relevant to the feature just built.

### 3. Edge Case Probing
Try 3–5 inputs/states not explicitly covered in the SPEC:
- **Empty states:** Navigate to review page with no completed runs — confirm empty state renders, no crash
- **Error states:** Cancel a run mid-flight via the cancel button — confirm status shows `cancelled`
- **Invalid input:** Add-post form with a malformed URL — confirm error message appears
- **Boundary inputs:** Post title that is very long (>200 chars) — confirm it truncates gracefully in the UI
- **Concurrent state:** Refresh the page mid-run — confirm polling resumes correctly

### 4. Regression Spot-Check
Visit 2–3 pages adjacent to the feature (not directly modified). For each:
- Navigate to the page
- Confirm it loads without a blank screen
- Check browser console for errors (use Playwright MCP `browser_console_messages`)

Adjacent pages to check based on what was modified:
- Dashboard (`/`) — always check
- Settings (`/settings`) — if run scheduling was touched
- Archive (`/archive/:runId`) — if review or ranking was touched

### 5. Non-Functional Check
Note any of the following (do not BLOCK for these, classify as WARNING or NOTE):
- Page render takes visibly >2 seconds after navigation
- Layout breaks at default viewport (1280×800)
- Form labels missing (inputs with no associated label)

### Finding Classification

| Class | Definition | Effect |
|-------|-----------|--------|
| BLOCKER | Feature doesn't work, data loss, crash, JS error on primary flow | Check 9 BLOCKED |
| WARNING | Regression on adjacent page, visual break, console error on non-primary flow | Reported, not BLOCKED |
| NOTE | Minor UX issue, cosmetic, non-functional observation | Reported only |

### Evidence

For each Playwright MCP interaction: capture a screenshot + note any console errors. Attach all findings with their classification. If no BLOCKERs found, Check 9 is PASS.

`<!-- QG:CHECK:9:PASS -->` or `<!-- QG:CHECK:9:BLOCKED -->`

---

## Final Verdict

After all 9 checks:

- **PASS:** All mandatory checks (1–8) are PASS or NOT_APPLICABLE, AND Check 9 has no BLOCKERs.
- **BLOCKED:** Any mandatory check is BLOCKED, OR Check 9 has a BLOCKER finding.
- **STAGNATION:** Same check fails 3× across gate runs with identical error signature — stop pipeline entirely.

Emit one of:
```
<!-- QG:VERDICT:PASS -->
<!-- QG:VERDICT:BLOCKED -->
```

Include a summary table:

| Check | Name | Result |
|-------|------|--------|
| 1 | Type checker | PASS/BLOCKED |
| 2 | Linter | PASS/BLOCKED |
| 3 | Unit + Seam Tests | PASS/BLOCKED |
| 4 | Coverage | PASS/BLOCKED |
| 5 | Scope Compliance | PASS/BLOCKED |
| 6 | Plan Compliance | PASS/BLOCKED |
| 7 | Ignore Comment Audit | PASS/BLOCKED |
| 8 | Spec-Driven Verification | PASS/BLOCKED/NOT_APPLICABLE |
| 9 | Exploratory QA | PASS/BLOCKED/SKIPPED |
```

- [ ] **Step 2: Verify full skill file structure**

```bash
grep -n "^## Check\|^## Final\|^## Service\|^---" .claude/skills/quality-gate.md
```

Expected output shows all major sections are present.

- [ ] **Step 3: Run typecheck and lint to confirm no regressions from the file moves and config changes**

```bash
pnpm typecheck && pnpm lint
```

Expected: both exit 0.

- [ ] **Step 4: Commit the quality-gate skill and harness changes together**

```bash
git add .claude/skills/quality-gate.md
git commit -m "feat(harness): add local quality-gate skill with spec-driven verification and exploratory QA"
```

---

## Task 8: Smoke Test the Override Resolution

**Goal:** Manually verify that the override resolution works end-to-end — i.e., the global orchestrate skill would pick up `.claude/skills/quality-gate.md` when run in this project.

This is a documentation/verification task, not a code task. The override resolution is implemented in the global harness skill (prose instructions for Claude), so we verify by reading the skill and confirming the logic is present.

- [ ] **Step 1: Read the updated orchestrate skill override section**

Open `harness-engineering/skills/orchestrate/SKILL.md` and confirm:
1. The "Local Skill Override Resolution" section exists between the `---` separator and `## Sub-Agent Dispatch`
2. It references `.claude/skills/quality-gate.md` as the check path
3. It lists the 4 skills that can be overridden (quality-gate, tdd, testing, code-review)
4. It documents the compatibility contract (QG:VERDICT and QG:CHECK comment format)

- [ ] **Step 2: Confirm .claude/skills/quality-gate.md emits compatible comments**

```bash
grep "QG:VERDICT\|QG:CHECK" .claude/skills/quality-gate.md
```

Expected: lines showing `<!-- QG:VERDICT:PASS -->`, `<!-- QG:VERDICT:BLOCKED -->`, and `<!-- QG:CHECK:N:PASS -->` / `<!-- QG:CHECK:N:BLOCKED -->` for N = 1–9.

- [ ] **Step 3: Final commit — verify clean working tree**

```bash
git status
```

Expected: clean working tree (all changes committed in Tasks 3, 4, 7).

---

## Self-Review Checklist

### Spec Coverage

| Spec Section | Task |
|-------------|------|
| Architecture / override resolution | Task 4 (global orchestrate), Task 5 (skill creation) |
| Service lifecycle (startup + teardown) | Task 5 (Check 1–7 section) |
| Check 1–7 (type, lint, tests, coverage, scope, plan, ignore audit) | Task 5 |
| Check 8: Spec-driven verification | Task 6 |
| Check 9: Exploratory QA | Task 7 |
| E2E test reorganization (seam + network) | Tasks 1–2 |
| Vitest config + package.json script | Task 3 |
| Compatibility contract (QG:VERDICT comments) | Tasks 4, 5, 7 |

All spec sections covered.

### Placeholder Scan

No TBDs, TODOs, or vague "add appropriate X" phrases. All code blocks are complete.

### Type Consistency

No TypeScript types defined in this plan (skill files are Markdown). File paths are consistent across all tasks.
