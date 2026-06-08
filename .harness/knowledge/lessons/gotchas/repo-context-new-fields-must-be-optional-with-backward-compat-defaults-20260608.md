---
title: "New fields on repository context interfaces must be optional with backward-compat defaults to avoid breaking existing tests"
date: 2026-06-08
category: gotchas
tags: [api, typescript, repository, drizzle, context, backward-compat, testing]
component: api/repositories/run-archives
severity: medium
status: implemented
applies_to: ["packages/api/src/repositories/**/*.ts", "packages/api/tests/unit/**/*.ts"]
stage: [code]
evidence_count: 1
last_validated: 2026-06-08
source: hard-won-success@save-newsletter-draft
related: ["packages/api/src/repositories/run-archives.ts"]
---

# New fields on repository context interfaces must be optional with backward-compat defaults

## Problem

When adding new intent-bearing fields (`reviewed`, `draftSavedAt`) to `UpdateRankedItemsContext` to support a new feature, making them required causes the TypeScript compiler to reject every existing test and call site that constructs the context object without the new fields. Even after fixing call sites, the logic must be audited to confirm existing tests still reflect correct behavior — the new fields are absent in their stubs.

## Insight

**When extending a repository context interface with new fields, make the fields optional and supply backward-compat defaults inside the repository method — never make them required.** This preserves the call contract for all existing callers while new callers opt in by passing explicit values.

The pattern: `field?: T` in the interface, `const value = ctx.field ?? <original-behavior>` inside the method body. The original behavior becomes the explicit default rather than an implicit assumption.

This applies broadly to any context/options object passed to a repository or service method that already has active callers.

## Solution

```ts
// file: packages/api/src/repositories/run-archives.ts

// BEFORE — would break every existing caller:
interface UpdateRankedItemsContext {
  rawItemsById: Map<string, RawItemRow>;
  digestMeta?: { ... };
  reviewed: boolean;        // required — breaks existing tests
  draftSavedAt: Date | null; // required — breaks existing tests
}

// AFTER — optional with backward-compat defaults:
interface UpdateRankedItemsContext {
  rawItemsById: Map<string, RawItemRow>;
  digestMeta?: { ... };
  reviewed?: boolean;           // default: true (original always-publish behavior)
  draftSavedAt?: Date | null;   // default: null (undefined → don't update the column)
}

// Inside updateRankedItems():
const isReviewed = ctx.reviewed ?? true;
// ...
if (ctx.draftSavedAt != null) {
  setValues.draftSavedAt = ctx.draftSavedAt;
}
```

The `ctx.draftSavedAt != null` guard also covers `undefined` (absent field) with a single check, so the column is never overwritten by callers that don't pass the field.

## Prevention / Reuse

- Before adding a field to a context/options interface, count existing call sites with `grep -rn "UpdateRankedItemsContext\|updateRankedItems(" packages/`. If there are more than one caller, make the field optional.
- State the backward-compat default in a comment inline with the `??` or guard: makes reviewers understand the intent without reading the interface definition.
- Check for the pattern after any PR that extends a context object: `git diff --unified=0 | grep -E '^\+.*interface.*Context'` — new required fields in a context interface with multiple callers should prompt this review.
