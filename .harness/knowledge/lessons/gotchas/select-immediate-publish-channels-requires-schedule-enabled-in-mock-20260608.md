---
title: "selectImmediatePublishChannels returns [] silently when scheduleEnabled or pipelineTime is absent from the settings mock"
date: 2026-06-08
category: gotchas
tags: [api, testing, vitest, mocks, bullmq, enqueue, publish-channels]
component: api/routes/archives
severity: medium
status: implemented
applies_to: ["packages/api/tests/unit/**/*.ts", "packages/api/src/services/**/*.ts"]
stage: [code]
evidence_count: 1
last_validated: 2026-06-08
source: hard-won-success@save-newsletter-draft
related: ["packages/shared/src/scheduling/immediate-publish.ts", "packages/api/tests/unit/archives-route.test.ts"]
---

# `selectImmediatePublishChannels` returns `[]` silently when `scheduleEnabled` or `pipelineTime` is absent from the settings mock

## Problem

When writing API route unit tests that assert `processingQueue.add` is called after a publish PATCH, the call is never made even though the production code looks correct. No error is thrown — `selectImmediatePublishChannels` simply returns an empty array, so the `for` loop body never executes and the `add` stub is never invoked.

The symptom: `expect(processingQueue.add).toHaveBeenCalled()` fails with "not called", but the route returns 200 and the repo is updated correctly.

## Insight

**`selectImmediatePublishChannels` requires `settings.scheduleEnabled === true` AND a non-empty `settings.pipelineTime` — both must be present in the test settings mock or it returns `[]`.**

The function checks these preconditions before evaluating per-channel eligibility. A stub settings object built with only `emailEnabled: true` (or similar) silently falls through to an empty result.

## Solution

Extend the test settings mock to include the required fields:

```ts
// file: packages/api/tests/unit/archives-route.test.ts

// BEFORE — emailEnabled alone is not enough:
const settingsMock = {
  emailEnabled: true,
  // ...other channel flags
};

// AFTER — scheduleEnabled + pipelineTime required for any channels to be selected:
const settingsMock = {
  scheduleEnabled: true,
  pipelineTime: "09:00",
  emailEnabled: true,
  // ...other channel flags
};
```

Reference: `packages/shared/src/scheduling/immediate-publish.ts` — the `scheduleEnabled` guard is the first check inside `selectImmediatePublishChannels`.

## Prevention / Reuse

- When writing a test that asserts channel enqueue happens, always include `scheduleEnabled: true` and a non-empty `pipelineTime` in the settings mock.
- If `processingQueue.add` is not being called and you expect it to be, check the settings mock for missing `scheduleEnabled` and `pipelineTime` before suspecting route or service logic.
- Grep for `selectImmediatePublishChannels` to find all callers — every route test that exercises the enqueue path needs this combination.
