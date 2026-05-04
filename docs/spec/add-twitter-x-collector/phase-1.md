# Phase 1: Schema migration + shared types

> **Status:** pending

## Overview

Adds the foundational types and DB column the rest of the feature builds on:
- `userSettings.twitterConfig` jsonb column (Drizzle migration).
- `RunSubmitTwitterConfig` type in `@newsletter/shared`.
- `TwitterCollectConfig` type in `@newsletter/pipeline`.
- Verification that `SourceType` already includes `"twitter"` (per CLAUDE.md it does — confirm and don't re-add).

After this phase, `pnpm typecheck` passes with the new types but no logic uses them yet.

## Implementation

**Files:**
- Modify: `packages/shared/src/db/schema.ts` — add `twitterConfig` jsonb column to `userSettings` table.
- Generate: `packages/shared/src/db/migrations/<timestamp>_add_twitter_config.sql` (Drizzle Kit output).
- Modify: `packages/shared/src/types/run.ts` — add `RunSubmitTwitterConfig`, extend `RunSubmitPayload` and `RunCollectorsPayload`.
- Modify: `packages/pipeline/src/types.ts` — add `TwitterCollectConfig`.
- Verify: `packages/shared/src/db/schema.ts:11` `SourceType` includes `"twitter"`. If absent, add. (CLAUDE.md says it's there but this is a sanity check.)

**Pattern to follow:** The existing `redditConfig` column declaration and `RunSubmitRedditConfig` type are the closest match. Follow them line-for-line in shape.

**Type definitions:**

```ts
// packages/shared/src/types/run.ts (add)
export interface RunSubmitTwitterUser {
  handle: string;        // canonical handle (no leading @)
  userId: string;        // numeric ID, resolved at save time
}

export interface RunSubmitTwitterConfig {
  listIds: string[];
  users: RunSubmitTwitterUser[];
  maxTweetsPerSource?: number;  // 1..500
  sinceHours?: number;          // 1..168
}

// extend existing RunCollectorsPayload:
export interface RunCollectorsPayload {
  hn?: RunSubmitHnConfig;
  reddit?: RunSubmitRedditConfig;
  web?: RunSubmitWebConfig;
  twitter?: RunSubmitTwitterConfig;  // NEW
}
```

```ts
// packages/pipeline/src/types.ts (add)
import type { RunSubmitTwitterConfig } from "@newsletter/shared";
export type TwitterCollectConfig = RunSubmitTwitterConfig;
```

```ts
// packages/shared/src/db/schema.ts (extend userSettings)
twitterConfig: jsonb("twitter_config").$type<RunSubmitTwitterConfig | null>(),
```

**What to test:**
- Type-only: TypeScript compiles, `RunSubmitTwitterConfig` is importable from `@newsletter/shared`.
- Migration round-trip:
  1. `pnpm --filter @newsletter/shared db:generate` produces a single new file.
  2. `pnpm --filter @newsletter/shared db:migrate` applies it cleanly.
  3. A repeat `db:generate` produces no further diff (drift check).
- Repository: `getSettingsRepo().get()` returns `twitterConfig: null` on a row that hasn't set it; `upsert({...twitterConfig: <value>})` round-trips it. Use the existing settings repo unit-test fixture.

**Traces to:** REQ-020, REQ-021, REQ-030, REQ-031.

**Commit:** `feat(VER-XX): add twitter_config column and shared types`
(VER-XX TBD — query Linear if a ticket exists for this work).

## Done when

- [ ] `pnpm typecheck` passes across all packages.
- [ ] `pnpm --filter @newsletter/shared db:generate` shows zero new diff after the migration is applied.
- [ ] `pnpm --filter @newsletter/shared test:unit` passes with the new repo round-trip test.
- [ ] One commit, scope `(VER-XX)` or `(twitter)` if no Linear ticket.

## Notes

- Postgres must be running locally (`pnpm infra:up`) for `db:migrate` to succeed.
- Do NOT hand-edit the generated SQL file beyond the comment header. Drizzle owns it.
- Skipping `SourceType` enum change if `"twitter"` already present (per CLAUDE.md it is).
