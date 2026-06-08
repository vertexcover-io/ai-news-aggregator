---
title: "Playwright waitForResponse must be registered before the click that triggers it"
date: 2026-06-08
category: gotchas
tags: [playwright, e2e, race-condition, waitForResponse, async]
component: web/tests/e2e
severity: high
status: implemented
applies_to: ["packages/web/tests/e2e/**/*.ts"]
stage: [code, review]
evidence_count: 1
last_validated: 2026-06-08
source: phase-4@centralized-observability
related: [".harness/knowledge/lessons/gotchas/playwright-getbyrole-heading-level-must-match-component-20260605.md"]
---

# Playwright `waitForResponse` must be registered before the click that triggers it

## Problem

An e2e test for the incidents Resolve button registered `waitForResponse` after the click:

```ts
await resolveButton.click();
const response = await page.waitForResponse(url => url.includes('/api/admin/incidents/'));
```

The PATCH request completed before `waitForResponse` was attached, causing a timeout: the test waited forever for a response that had already arrived.

## Insight

**`page.waitForResponse` is a promise that resolves when the NEXT matching response arrives.** If the request completes before the listener is registered, the promise never resolves — it just waits for the next matching request, which may never come.

This is a classic race condition in async Playwright tests. The fix is to start the listener before the action that triggers the request:

```ts
// WRONG — listener attached after click; request may already be done:
await button.click();
await page.waitForResponse(url => url.includes('/api/'));

// CORRECT — listener attached first, then trigger:
const responsePromise = page.waitForResponse(url => url.includes('/api/'));
await button.click();
await responsePromise;
```

This pattern applies to any Playwright event listener that observes network activity: `waitForResponse`, `waitForRequest`, `waitForEvent('response')`.

## Solution

```ts
// file: packages/web/tests/e2e/incidents.spec.ts

// Correct pattern for "click → wait for network" flows:
const responsePromise = page.waitForResponse(
  (res) => res.url().includes('/api/admin/incidents/') && res.request().method() === 'PATCH'
);
await resolveButton.click();
const response = await responsePromise;
expect(response.status()).toBe(200);
```

## Prevention / Reuse

- **Any time a test must confirm a network request completed:** register `waitForResponse` / `waitForRequest` before the action, not after.
- **Mental model:** think of `waitForResponse` as "subscribe to the next matching event" — you must be subscribed before the event fires.
- **Signal that this is the bug:** the test times out on the `waitForResponse` line even though the button click visually worked and the page updated correctly. The request already completed; the listener just missed it.
- **Alternative:** `page.waitForResponse` can be replaced with asserting the DOM change directly (e.g., `expect(row).not.toBeVisible()` after a dismiss action), which avoids the race entirely. Use network waiting only when you need the HTTP status code.
