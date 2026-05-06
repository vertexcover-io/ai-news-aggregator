# Phase 2: Settings API + handle resolution

> **Status:** pending

## Overview

Wires the new `twitterConfig` through the settings API and adds save-time `@handle → numericId` resolution. After this phase: `PUT /api/settings` accepts a `twitterConfig` payload, validates it, resolves any handles missing a `userId` via `rettiwt.user.details()`, and persists. `GET /api/settings` round-trips it.

This phase is the **single architectural exception**: `rettiwt-api` becomes a runtime dep of `@newsletter/api`. Justified in the design doc.

## Implementation

**Files:**
- Modify: `packages/api/package.json` — add `"rettiwt-api": "<exact version>"`.
- Modify: `packages/api/src/lib/validate.ts` — add `twitterConfigSchema` (zod), extend `userSettingsUpsertSchema`.
- Create: `packages/api/src/services/twitter-handle-resolver.ts` — exports `resolveTwitterHandles(handles, deps): Promise<{ handle, userId }[]>`. Wraps `rettiwt-api`.
- Modify: `packages/api/src/routes/settings.ts` — call the resolver before passing through to the repo, handle errors per REQ-046 / REQ-047.
- New tests:
  - `packages/api/tests/unit/lib/validate.test.ts` (extend existing or add) — zod schema cases for the new `twitterConfig` shape.
  - `packages/api/tests/unit/services/twitter-handle-resolver.test.ts` — unit tests stubbing the rettiwt client.
  - `packages/api/tests/unit/routes/settings.test.ts` (extend) — round-trip including `twitterConfig` with and without preset `userId`.

**Pattern to follow:** `redditConfigSchema` declaration in `validate.ts` for shape; existing `routes/settings.ts` for the route handler structure. The resolver is new, but follows the deps-injection pattern used elsewhere (`deps.getRettiwt() => Rettiwt instance`).

### Resolver signature

```ts
// packages/api/src/services/twitter-handle-resolver.ts
import type { Rettiwt } from "rettiwt-api";

export interface TwitterHandleResolverDeps {
  rettiwtFactory: () => Rettiwt;  // injectable for tests
}

export interface ResolvedHandle {
  handle: string;
  userId: string;
}

export class TwitterHandleResolutionError extends Error {
  constructor(
    public readonly handle: string,
    public readonly reason: "not_found" | "auth_failed" | "missing_api_key" | "unknown",
    cause?: unknown,
  ) {
    super(`failed to resolve @${handle}: ${reason}`);
    this.name = "TwitterHandleResolutionError";
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

export async function resolveTwitterHandles(
  handles: string[],
  deps: TwitterHandleResolverDeps,
): Promise<ResolvedHandle[]> {
  if (handles.length === 0) return [];
  if (!process.env.RETTIWT_API_KEY) {
    throw new TwitterHandleResolutionError(handles[0], "missing_api_key");
  }
  const rettiwt = deps.rettiwtFactory();
  const out: ResolvedHandle[] = [];
  for (const raw of handles) {
    const handle = raw.replace(/^@/, "").trim();
    if (!handle) continue;
    try {
      const user = await rettiwt.user.details(handle);
      if (!user || !user.id) {
        throw new TwitterHandleResolutionError(handle, "not_found");
      }
      out.push({ handle: user.userName ?? handle, userId: user.id });
    } catch (err) {
      if (err instanceof TwitterHandleResolutionError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      const reason = /not authorized/i.test(msg) ? "auth_failed" : "unknown";
      throw new TwitterHandleResolutionError(handle, reason, err);
    }
  }
  return out;
}
```

### Route integration

In `routes/settings.ts`, after zod parsing and before calling `repo.upsert`:

1. If `parsed.data.twitterConfig === null` → pass through.
2. Else split `users` into resolved (have `userId`) and unresolved (missing `userId`).
3. If unresolved is non-empty → call `resolveTwitterHandles(unresolved.map(u => u.handle), deps)`.
4. Merge resolved + newly-resolved into `parsed.data.twitterConfig.users`.
5. Pass to repo.

Errors:
- `TwitterHandleResolutionError(reason: "missing_api_key")` → respond 503 with `{ error: "twitter handle resolution unavailable: RETTIWT_API_KEY not configured" }`.
- `TwitterHandleResolutionError(reason: "auth_failed")` → respond 503 with `{ error: "twitter handle resolution unavailable: auth failed (rotate RETTIWT_API_KEY)" }`.
- Other → respond 422 with `{ error: "twitter handle resolution failed", failures: [{ handle, reason }] }`.

**What to test:**

| Test | REQ |
|---|---|
| Valid config (lists+users with userId already set) → 200, no rettiwt call | REQ-022, REQ-045b |
| Valid config (users without userId) → 200, rettiwt called once per handle, userIds populated | REQ-045 |
| Invalid handle ('definitely-not-a-real-handle-zzz999') → 422, body lists the handle, prior settings unchanged | REQ-046 |
| `RETTIWT_API_KEY` absent → 503, prior settings unchanged | REQ-047 |
| Zod rejects empty list ID, non-digit list ID, negative `maxTweetsPerSource`, etc. | REQ-022 |
| Round-trip: PUT then GET returns identical `twitterConfig` byte-equivalently | REQ-023 |

**Traces to:** REQ-022, REQ-023, REQ-045, REQ-045b, REQ-046, REQ-047.

**Commit:** `feat(twitter): settings API surface and handle resolver`

## Done when

- [ ] `pnpm --filter @newsletter/api test:unit` passes including new tests.
- [ ] `pnpm --filter @newsletter/api typecheck` clean.
- [ ] `pnpm lint` clean (no new violations).
- [ ] No leakage of rettiwt-api types into other API modules — only the resolver imports them.
- [ ] One commit.

## Notes

- The resolver is a thin wrapper. Don't add caching — handle resolution happens at most once per save, not per run.
- Zod schema for `userId` requires `/^\d+$/` to match Twitter's numeric ID format.
- Zod schema for `handle` should reject `@` prefix (the resolver strips it, but persisted form is canonical).
- `pnpm add --filter @newsletter/api rettiwt-api` for the dep install. Do NOT use `pnpm add` at workspace root.
