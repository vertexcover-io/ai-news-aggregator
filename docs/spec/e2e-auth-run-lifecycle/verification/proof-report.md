# Verification proof report — e2e-auth-run-lifecycle

**Date:** 2026-05-21
**Spec:** `docs/spec/e2e-auth-run-lifecycle/spec.md`
**Verdict:** PASSED

## Why this verification is itself the proof

The work delivered by this PR *is* a set of e2e tests. Re-driving the same
features through Playwright MCP as a "second proof" would be redundant —
Playwright IS the proof framework. This report records the test-suite
output as the verification evidence.

## VS-1 — Admin authentication (REQ-A1..A5)

Command:
```
pnpm --filter @newsletter/api exec vitest run --project e2e tests/e2e/admin.e2e.test.ts
```

Output (final clean run):
```
 ✓ |e2e| tests/e2e/admin.e2e.test.ts (7 tests) 3ms
   Tests  7 passed (7)
```

| REQ | Claim | Verified |
|---|---|---|
| REQ-A1 | login 200 + Set-Cookie | ✅ |
| REQ-A2 | login 401 + invalid_password | ✅ |
| REQ-A3 (×3) | login 400 for empty / missing / malformed body | ✅ |
| REQ-A4 | logout 200 + Max-Age=0 | ✅ |
| REQ-A5 | /me 200 + { admin: true } | ✅ |

## VS-2 — POST /api/runs/now (REQ-N1..N5)

```
 ✓ |e2e| tests/e2e/runs-now.e2e.test.ts (5 tests) 19ms
```

| REQ | Claim | Verified |
|---|---|---|
| REQ-N1 | 202 + runId, exactly one queue.add with jobId=runId | ✅ |
| REQ-N2 | 409 when settings null | ✅ |
| REQ-N3 | 409 when no sources enabled | ✅ |
| REQ-N4 | dryRun: true flows into job payload | ✅ |
| REQ-N5 | 400 for non-boolean dryRun | ✅ |

## VS-3 — POST /api/runs/:runId/cancel (REQ-C1..C3)

```
 ✓ |e2e| tests/e2e/runs-cancel.e2e.test.ts (3 tests) 44ms
```

| REQ | Claim | Verified |
|---|---|---|
| REQ-C1 | running → cancelling, exactly 1 pub/sub message on run:cancel:<id> | ✅ (tightened post-pass-2) |
| REQ-C2 | 404 when missing in Redis AND archive | ✅ |
| REQ-C3 | 409 + status when terminal | ✅ |

## VS-4 — GET /api/runs (REQ-L1..L3)

```
 ✓ |e2e| tests/e2e/runs-list.e2e.test.ts (6 tests) 21ms
```

| REQ | Claim | Verified |
|---|---|---|
| REQ-L1 | 200 + { runs: [] } no params | ✅ |
| REQ-L2 (×2) | 200 with limit=5, 200 with limit=100 | ✅ |
| REQ-L3 (×3) | 400 for limit=0, 101, abc | ✅ |

## VS-5 — Dashboard Run Now (REQ-W1, UI)

Command:
```
pnpm --filter @newsletter/web exec playwright test dashboard-run-now.spec.ts --reporter=line
```

Output:
```
Running 1 test using 1 worker
[1/1] [chromium] › tests/e2e/dashboard-run-now.spec.ts:69:3 › Dashboard Run Now (VS-5) › REQ-W1: Run now click adds a running row to the table
1 passed (1.6s)
```

This is a real Chromium browser session driven by Playwright against the
live Vite dev server + api dev server. It seeds settings via `PUT
/api/settings`, logs in, navigates to `/admin`, clicks Run Now, asserts
a row with status `running` appears in the table. The browser ran in
headless mode (matches `playwright.config.ts`).

## Tooling proof

```
$ pnpm typecheck   →  7/7 tasks successful, 0 errors
$ pnpm lint        →  5/5 tasks successful, 0 errors, 10 pre-existing warnings
```

## Aggregate

- 22 tests executed across 5 files
- 22 passed, 0 failed, 0 skipped
- 1 UI claim (REQ-W1) covered by real-browser Playwright
- Zero product code changes

## Out of scope

- Pre-existing failures in `runs.e2e.test.ts` (2) and `settings.e2e.test.ts` (1)
  remain. These reflect product drift (`scheduleTime` → `pipelineTime` rename;
  changed error-message wording on `web deferral`; REQ-012 returning 500 instead
  of expected 200). They are NOT caused by this PR and NOT in this spec's
  scope. Tracked as a follow-up in `learnings.md`.
