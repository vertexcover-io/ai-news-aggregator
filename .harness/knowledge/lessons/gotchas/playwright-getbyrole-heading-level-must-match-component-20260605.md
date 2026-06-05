---
title: "Playwright getByRole heading level must match the component's actual rendered heading element"
date: 2026-06-05
category: gotchas
tags: [playwright, e2e, accessibility, heading, getByRole]
component: web/tests/e2e
severity: medium
status: implemented
applies_to: ["packages/web/tests/e2e/**/*.ts", "packages/web/tests/unit/**/*.tsx"]
stage: [code, review]
evidence_count: 1
last_validated: 2026-06-05
source: review-fix@admin-edit-after-review
related: []
---

# Playwright `getByRole("heading", { level: N })` must match the component's actual rendered heading

## Problem

`edit-after-review.spec.ts` asserted that the edited story title was visible on the public archive page:

```ts
await expect(page.getByRole("heading", { name: editedTitle, level: 1 })).toBeVisible();
```

`ArchiveStoryCard.tsx` renders story titles in `<h2>`, not `<h1>`. The selector matched zero elements regardless of whether the edit persisted correctly — the VS-1 end-to-end verification scenario timed out on every run, making the persistence check non-functional.

## Insight

**`getByRole("heading", { level: N })` is a strict equality check — it only matches `<hN>` exactly.** A wrong level turns a functional test into an always-failing no-op. The error looks like the feature is broken, but the feature is fine; only the assertion is wrong.

This bites when a test author writes the assertion against an assumed heading level (e.g. "the main content heading must be h1") without checking how the component actually renders. Page-level headings (the page title) are typically `<h1>`; card/section headings (individual story titles in a list) are typically `<h2>` or lower. Mixing them up is easy.

## Solution

Change the `level` argument to match the component:

```ts
// file: packages/web/tests/e2e/edit-after-review.spec.ts

// BEFORE (wrong — ArchiveStoryCard renders <h2>, not <h1>):
await expect(page.getByRole("heading", { name: editedTitle, level: 1 })).toBeVisible();

// AFTER (correct):
await expect(page.getByRole("heading", { name: editedTitle, level: 2 })).toBeVisible();
```

The component source (`packages/web/src/components/ArchiveStoryCard.tsx:34`) confirms `<h2>`.

## Prevention / Reuse

- **Before writing `getByRole("heading", { level: N })`, open the component file and confirm the actual element tag.** Do not guess from context — "story titles in a list" intuitively feel like `<h2>`, but page-level title components vary.
- **If the level doesn't matter for the test's purpose, omit the `level` option.** `getByRole("heading", { name: editedTitle })` matches any heading level and is more resilient to markup refactors.
- **Signal that the level is wrong:** the test times out with a "locator was not visible" message — not a type error, not a helpful "heading found but at wrong level" message. If your heading assertion times out on a page where the text is definitely present, the `level` value is the first suspect.
- **After writing any heading assertion, run the test once against a known-good state** to confirm it passes before relying on it as a gate.
