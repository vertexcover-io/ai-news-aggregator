---
title: "Real-DB e2e tests need hermetic cleanup and unique prefixes to stay idempotent"
date: 2026-06-08
category: gotchas
tags: [e2e, integration-test, postgres, vitest, hermetic, idempotency]
component: pipeline/tests/e2e
severity: high
status: implemented
applies_to: ["packages/pipeline/tests/e2e/**/*.ts", "packages/api/tests/e2e/**/*.ts"]
stage: [code, review]
evidence_count: 1
last_validated: 2026-06-08
source: hard-won-success@centralized-observability
related: []
---

# Real-DB e2e tests need hermetic cleanup and unique prefixes to stay idempotent

## Problem

`packages/pipeline/tests/e2e/seam/repositories/incidents.e2e.test.ts` used a `LIKE 'test-%'` match for `listUndelivered`. On a shared dev DB, prior test runs left leftover rows. The `LIMIT 50` batch in `listUndelivered` was exhausted by stale rows, pushing the freshly-inserted target row out of the result — the suite appeared to fail intermittently.

Separately, multiple `describe` blocks used `Date.now()` for fingerprint uniqueness, but all evaluated at the same millisecond, producing collisions.

## Insight

**Real-DB integration tests are not hermetic by default — they inherit whatever state was left behind by prior runs.** Two independent bugs can mask as one flaky test:

1. **Stale rows pollute bounded queries.** A `LIMIT N` or a pattern match that catches leftover rows silently evicts the freshly-inserted test rows. This only triggers occasionally (first run of the day passes; second run fails because the first run's rows are still there).

2. **Timestamp-based uniqueness is unsafe inside a `describe` block.** All `describe`-level `const` evaluations happen synchronously at collection time, potentially within the same millisecond. Two "unique" fingerprints can collide.

## Solution

```ts
// file: packages/pipeline/tests/e2e/seam/repositories/incidents.e2e.test.ts

// 1. Hermetic cleanup: delete test rows before the suite
beforeAll(async () => {
  await client.query("DELETE FROM incidents WHERE fingerprint LIKE '%test-%'");
});

// 2. Unique prefixes: inject Math.random() to break millisecond ties
const PREFIX = `test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const FP1 = `worker_crash:${PREFIX}-api:sig1`;
const FP2 = `job_failed:${PREFIX}-pipeline:sig2`;
```

## Prevention / Reuse

- **Every real-DB e2e suite must have a `beforeAll` cleanup** scoped to the test's own fingerprint/id pattern. Use a deterministic prefix like `test-` so the cleanup is safe to re-run.
- **Never use `Date.now()` alone for `describe`-scope constants** — add `Math.random()` (or a counter) to guarantee per-suite uniqueness.
- **`LIMIT N` queries are invisible poison for real-DB tests.** If a query has a limit, your cleanup must delete MORE rows than the limit, or the target row can silently fall off the end.
- **Signal that this is happening:** the test that verifies "row X is in the result" passes on a clean DB but fails on a re-run. If an e2e test is green on fresh infra but red on a warm DB, stale rows are the first suspect.
