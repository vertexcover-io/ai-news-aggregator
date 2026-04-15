---
name: quality-gate
description: Use when running the quality gate for the newsletter project. Overrides the global harness quality-gate skill with project-specific service lifecycle, spec-driven verification, and exploratory QA.
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
```

And skip Check 9.

`<!-- QG:CHECK:8:PASS -->` or `<!-- QG:CHECK:8:BLOCKED -->`

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
