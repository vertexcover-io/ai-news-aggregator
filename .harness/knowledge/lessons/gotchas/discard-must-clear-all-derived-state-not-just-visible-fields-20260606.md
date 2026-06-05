---
title: "Discard must clear all derived/computed state, not just the user-visible fields"
date: 2026-06-06
category: gotchas
tags: [react, state-management, discard, derived-state, review-page]
component: web/pages/ReviewPage
severity: medium
status: implemented
applies_to: ["packages/web/src/**/*.tsx", "packages/web/src/**/*.ts"]
stage: [code, review]
evidence_count: 1
last_validated: 2026-06-06
source: review-fix@review-page-issues-audit
related: []
---

# Discard must clear all derived/computed state, not just user-visible fields

## Problem

`ReviewPage.tsx` tracked a `lastFailedSignature` (a hash of the current ranked-item order) to detect when a Regenerate call failed and unlock Save with an amber warning. When the user clicked Discard, the visible fields (digest headline, summary, etc.) were correctly reverted to hydrated values — but `lastFailedSignature` was not cleared.

If the user then re-ordered items to the same order as when Regenerate failed, `regenFailed` became `true` again (the hash matched) and the amber warning reappeared — even though the user had never attempted Regenerate in the post-Discard session.

## Insight

**Discard is a full state reset, not a field-wipe.** Any derived state that was computed *from* the user-editable fields must also be reset. Common examples:

- Hashes or signatures computed from the current item order
- Error flags (`regenFailed`, `hasError`) that are set in response to user actions
- "Last attempt" timestamps or identifiers used for rate-limiting or idempotency
- Pending flags (`pendingRegenerateCall`, etc.)

If a field is "derived from the user's current session state", its reset belongs inside the Discard handler.

## Solution

In `packages/web/src/pages/ReviewPage.tsx`, the Discard handler was extended:

```ts
// BEFORE — only visible fields cleared:
function handleDiscard() {
  setCurrent(initial);
  setDigestFields(hydratedDigestFields);
  setHasBeforeUnloadWarning(false);
}

// AFTER — derived state also cleared:
function handleDiscard() {
  setCurrent(initial);
  setDigestFields(hydratedDigestFields);
  setLastFailedSignature(null);   // ← reset regen-failure sentinel
  setHasBeforeUnloadWarning(false);
}
```

## Prevention / Reuse

- When implementing a Discard/Reset action, audit every piece of state in the component and ask: "Was this value set as a consequence of user interaction since the last save/hydration?" If yes, reset it.
- State names containing "last", "previous", "failed", "pending", "attempted", or "signature" are common candidates.
- Write a unit test that: (1) triggers the derived state, (2) clicks Discard, (3) re-creates the triggering condition, and (4) asserts the derived state does NOT reappear unless the trigger action is explicitly repeated.
