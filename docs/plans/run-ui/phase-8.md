# Phase 8: Integration tests + smoke run

> **Status:** pending
> **Depends on:** Phase 6, Phase 7
> **Traces to:** REQ-070, REQ-071, REQ-080, REQ-085, EDGE-001, EDGE-003, EDGE-015, and end-to-end REQ-001 flow

## Overview

Final integration gate. Runs the full pipeline against real Redis, real
Postgres, and mocked external services (HN RSS, Reddit JSON, Gemini LLM) to
exercise the entire fan-out/fan-in flow.

## Implementation

**Files to create:**
- `packages/pipeline/tests/e2e/run-flow.e2e.test.ts` — end-to-end BullMQ flow
- `packages/web/tests/e2e/run-page.spec.ts` — Playwright happy path
  (optional — may be deferred if Playwright isn't installed yet; if so, do a
  manual smoke test via dev server instead)

### `run-flow.e2e.test.ts` outline

```typescript
describe("run flow end-to-end", () => {
  beforeAll: truncate raw_items, clear Redis run:* keys, start FlowProducer,
             start collection + run-process workers
  afterAll:  stop workers, close connections

  it("completes a run with HN+Reddit sources", async () => {
    // Mock fetch for hnrss and reddit to return fixture data
    // Mock rank processor to return deterministic top-N
    // Seed initial run-state
    await flowProducer.add({
      name: "run-process",
      queueName: "processing",
      data: { runId, topN: 3, sourceTypes: ["hn","reddit"] },
      children: [
        { name: "hn-collect",     queueName: "collection", data: { runId, config: { sinceDays: 3 } } },
        { name: "reddit-collect", queueName: "collection", data: { runId, config: { subreddits: ["MachineLearning"], sinceDays: 3 } } },
      ],
    });

    // Poll run-state until stage === "completed" or timeout
    // Assert: sources.hn.status === "completed", sources.reddit.status === "completed"
    // Assert: rankedItems has 3 entries
    // Assert: completedAt is set
  });

  it("REQ-044: all collectors fail → run completes with empty rankedItems and warning", async () => {
    // Mock fetches to throw
    // Assert: status completed, rankedItems: [], warnings contains "no items collected"
  });

  it("REQ-080/REQ-085: emits structured logs", async () => {
    // Spy on logger, assert run.started (from API), run.source.completed,
    // run.dedup, run.rank, run.completed all present with runId
  });
});
```

### Playwright (optional)

If Playwright is desired for this PR, add it as a dev dep in `@newsletter/web`
and add a single smoke test that:
1. Navigates to `/run`
2. Enters the password
3. Fills the form (HN enabled, keywords "AI", sinceDays 3, topN 5)
4. Clicks submit
5. Waits for the status panel to appear
6. Asserts at least one source status element is visible

Given the scope of this PR, defer Playwright unless time permits and do a
manual smoke run via `pnpm dev` + a `curl` to `POST /api/runs` as backup.

## Full-stack smoke script

Create `scripts/smoke-run.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
: "${ADMIN_PASSWORD:?}"
: "${GEMINI_API_KEY:?}"
payload='{"topN":3,"hn":{"sinceDays":2,"pointsThreshold":20},"reddit":{"subreddits":["MachineLearning"],"sinceDays":2}}'
runId=$(curl -sf -X POST http://localhost:3000/api/runs \
  -H "Authorization: Bearer $ADMIN_PASSWORD" \
  -H "Content-Type: application/json" \
  -d "$payload" | jq -r .runId)
echo "runId=$runId"
for i in {1..30}; do
  status=$(curl -sf "http://localhost:3000/api/runs/$runId" -H "Authorization: Bearer $ADMIN_PASSWORD" | jq -r .status)
  echo "status=$status"
  [ "$status" = "completed" ] && break
  [ "$status" = "failed" ] && exit 1
  sleep 2
done
curl -sf "http://localhost:3000/api/runs/$runId" -H "Authorization: Bearer $ADMIN_PASSWORD" | jq .
```

## What to run as the gate

At the end of this phase, all of the following must pass:

```
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm build
pnpm --filter @newsletter/pipeline test:e2e   # if an :e2e script exists
pnpm --filter @newsletter/api test:e2e
```

Any failing check blocks PR creation.

**Commit:** `test(VER-run-ui): add end-to-end integration tests for run flow`

## Done When

- [ ] End-to-end pipeline test passes with real Redis + Postgres
- [ ] All-failed collectors scenario produces an empty ranked list with warning
- [ ] Structured logs assertion passes
- [ ] `scripts/smoke-run.sh` committed and documented in the PR
- [ ] All monorepo-wide checks green
