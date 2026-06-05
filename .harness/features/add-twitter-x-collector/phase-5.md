# Phase 5: Pipeline worker wiring

> **Status:** pending

## Overview

Wires `collectTwitter` into the BullMQ run flow. After this phase, configuring `twitterConfig` in user_settings and triggering a run actually fetches tweets and writes them to `raw_items`. End-to-end works.

## Implementation

**Files:**
- Modify: `packages/shared/src/run-start.ts` — extend `startRun()` to read `userSettings.twitterConfig` and put it on `RunCollectorsPayload.twitter` if non-null.
- Modify: `packages/pipeline/src/workers/run-process.ts`:
  - Add `twitter?: TwitterCollectConfig` to `RunCollectorsPayload` type if not already added in Phase 1 (check).
  - Add `collectTwitter` to the `CollectFns` interface.
  - Default-instantiate the rettiwt-backed `TwitterClient` and the rawItemsRepo when constructing the worker.
  - In `runCollecting()` (around lines 142-243), add a Task that conditionally invokes `collectTwitter(deps, payload.twitter!)` when `payload.twitter` is non-undefined.
- Modify: `packages/pipeline/src/workers/__tests__/run-process.test.ts` — add dispatch tests:
  - `payload.twitter` present → `collectTwitter` called once.
  - `payload.twitter` undefined → `collectTwitter` NOT called.
- Modify: `packages/shared/src/__tests__/run-start.test.ts` — extend round-trip test to assert `twitterConfig` flows from settings to payload.

**Pattern to follow:** the existing `web` config wiring in both `run-start.ts` and `run-process.ts`. Twitter mirrors it.

### `run-start.ts` change

Around lines 74-85 where `hnConfig`/`redditConfig`/`webConfig` are extracted:

```ts
const collectors: RunCollectorsPayload = {
  ...(settings.hnConfig ? { hn: settings.hnConfig } : {}),
  ...(settings.redditConfig ? { reddit: settings.redditConfig } : {}),
  ...(settings.webConfig ? { web: settings.webConfig } : {}),
  ...(settings.twitterConfig ? { twitter: settings.twitterConfig } : {}),  // NEW
};
```

(Use the precise existing pattern — could be different from this snippet.)

### `run-process.ts` change

Inside `runCollecting()` (or wherever the task array is assembled):

```ts
if (payload.twitter) {
  tasks.push({
    name: "twitter",
    run: () => deps.collectFns.collectTwitter(
      {
        client: deps.twitterClient,
        rawItemsRepo: deps.rawItemsRepo,
        signal: deps.signal,
      },
      payload.twitter!,
    ),
  });
}
```

The `deps.twitterClient` comes from `createRettiwtClient(...)` (Phase 3) — instantiated once at worker construction.

### `CollectFns` interface

```ts
export interface CollectFns {
  collectHn: typeof collectHn;
  collectReddit: typeof collectReddit;
  collectWeb: typeof collectWeb;
  collectTwitter: typeof collectTwitter;  // NEW
}
```

Default `createRunProcessWorker(...)` factory now passes `collectTwitter` in.

### Tests

| Test | REQ |
|---|---|
| `startRun puts twitterConfig on payload when settings has it` | REQ-024 |
| `startRun omits twitter key when twitterConfig is null` | REQ-024 |
| `runCollecting invokes collectTwitter exactly once when payload.twitter is present` | REQ-032 |
| `runCollecting does not invoke collectTwitter when payload.twitter is undefined` | REQ-033 |

These are integration-ish but use stubbed `collectTwitter` (a `vi.fn()`) so they don't need real network or DB.

**Traces to:** REQ-024, REQ-030, REQ-031, REQ-032, REQ-033.

**Commit:** `feat(twitter): wire collector into pipeline worker`

## Done when

- [ ] `pnpm --filter @newsletter/shared test:unit` passes.
- [ ] `pnpm --filter @newsletter/pipeline test:unit` passes.
- [ ] `pnpm typecheck` and `pnpm lint` clean.
- [ ] One commit.

## Notes

- `RunCollectorsPayload.twitter` was added in Phase 1's shared types — so this phase only needs to populate it.
- Resist the urge to refactor `runCollecting` to be shorter. Mirror the existing per-collector style.
- This phase does NOT implement the live integration test (VS-2). That's Stage 5 (functional-verify) territory.
