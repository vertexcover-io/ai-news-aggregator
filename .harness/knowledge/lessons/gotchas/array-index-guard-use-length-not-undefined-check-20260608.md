---
title: "Use rows.length === 0 instead of !rows[0] — no-unnecessary-condition without noUncheckedIndexedAccess"
date: 2026-06-08
category: gotchas
tags: [eslint, typescript, array-access, no-unnecessary-condition, noUncheckedIndexedAccess]
component: api/repositories
severity: medium
status: implemented
applies_to: ["packages/api/src/repositories/**/*.ts", "packages/pipeline/src/repositories/**/*.ts", "packages/shared/src/**/*.ts"]
stage: [code, review]
evidence_count: 2
last_validated: 2026-06-08
source: review-fix@centralized-observability
related: []
---

# Use `rows.length === 0` instead of `!rows[0]` — `no-unnecessary-condition` without `noUncheckedIndexedAccess`

## Problem

Writing a defensive null guard after an array fetch:

```ts
const rows = await db.execute(sql`SELECT ...`);
if (!rows[0]) return null; // ← ESLint error
```

Triggered: `ESLint: Unnecessary conditional, value is always falsy (@typescript-eslint/no-unnecessary-condition)`.

## Insight

**Without `noUncheckedIndexedAccess: true` in `tsconfig.json`, TypeScript infers `T` (not `T | undefined`) for `arr[i]` access.** The ESLint rule `no-unnecessary-condition` then sees `!rows[0]` as a check that is always `false` (because `rows[0]` is typed `T`, which is always truthy-shaped), and flags it as unnecessary.

This project does NOT enable `noUncheckedIndexedAccess` (verified: not in any `tsconfig.json`). So `arr[i] !== undefined` and `!arr[i]` are always flagged.

The fix is simple: check `length` instead of the element value.

## Solution

```ts
// WRONG — trips no-unnecessary-condition without noUncheckedIndexedAccess:
if (!rows[0]) return null;
if (rows[0] === undefined) return null;

// CORRECT — length is always typed number, never flagged:
if (rows.length === 0) return null;
return rows[0]; // TypeScript knows this exists

// In tests: use optional-chaining instead of non-null assertion:
const row = rows[0]; // not rows[0]!
expect(row?.status).toBe("open");
```

## Prevention / Reuse

- **Any time you access `arr[0]` defensively in a repository:** use `arr.length === 0` as the guard, not `!arr[0]` or `arr[0] === undefined`.
- **In tests**, use `?.` for array element access instead of `!` (non-null assertion) or an undefined check.
- **If `no-unnecessary-condition` fires on an array access guard**, the fix is always to switch to `.length`. Do NOT add `// eslint-disable` — that suppresses the rule rather than fixing the type issue.
- **If you want the safer `arr[i]` typed as `T | undefined`**, enable `noUncheckedIndexedAccess: true` in `tsconfig.json`. This project has not done so — consult before changing (it causes widespread inference changes).

## Related

- Project memory note: `no-unchecked-index-access-avoid-defensive-guards.md`
