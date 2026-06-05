# SPEC — Twitter collector cookies in admin settings

**Source design:** `docs/spec/twitter-cookies-admin-settings/design.md`
**Library probe:** `docs/spec/twitter-cookies-admin-settings/library-probe.md` (PASS, no new deps)
**Date:** 2026-05-21

## Summary

Move the Twitter (X) collector's base64 cookie blob from the `RETTIWT_API_KEY` env var into the admin settings dashboard. Cookies are stored encrypted in `social_credentials` under a new `twitter_collector` platform key, resolved per pipeline job (DB-first, env-fallback) so admin edits land on the next run without a worker restart. When cookies are missing or invalid, the Twitter collector fails individually and the failure is surfaced in the Slack run-summary message; the surrounding run continues.

## Requirements

### REQ-001 — Storage schema

The system SHALL accept `"twitter_collector"` as a value of `socialCredentials.platform` in `packages/shared/src/db/schema.ts`, and SHALL define an interface `TwitterCollectorEncryptedFields { apiKey: EncryptedBlob }` exported from `@newsletter/shared/db`.

The system SHALL widen the union type of `socialCredentials.encryptedFields` to include `TwitterCollectorEncryptedFields`.

A Drizzle migration SHALL be generated. The migration's SQL diff is allowed to be empty (the `platform` column is already `text`), but the snapshot under `packages/shared/drizzle/meta/` MUST be regenerated so future migrations are based on the current schema.

### REQ-002 — Repository upsert + read

`packages/api/src/repositories/social-credentials.ts` and `packages/pipeline/src/repositories/social-credentials.ts` SHALL each export:

- `upsertTwitterCollector(input: { apiKey: string }): Promise<{ updatedAt: string }>` (api side) / `Promise<void>` (pipeline side, matching existing shape)
- `getTwitterCollector(): Promise<{ apiKey: string; updatedAt: Date } | null>` (pipeline side; the api side does not need a getter beyond the existing `getStatus`)
- Existing `delete("twitter_collector")` MUST work via the existing union widening.
- Existing `getStatus()` SHALL return a third field `twitterCollector: { configured: boolean; updatedAt: string | null }`.

Encrypt with the existing `CredentialCipher.encrypt`; decrypt with `.decrypt`. Reuse the existing `EncryptedBlob` shape.

### REQ-003 — Validator

`packages/api/src/lib/validate-social-credentials.ts` SHALL export `twitterCollectorUpsertSchema = z.object({ apiKey: z.string().trim().min(1) })` plus its inferred type `TwitterCollectorUpsertBody`.

### REQ-004 — API route

`packages/api/src/routes/admin-social-credentials.ts` SHALL handle:

- `PUT /api/admin/social-credentials/twitter-collector` — body validated by `twitterCollectorUpsertSchema`. On success returns `{ ok: true, configured: true, updatedAt }`. On invalid body returns `400 { error: "invalid_body", issues }`.
- `DELETE /api/admin/social-credentials/twitter-collector` — returns `{ ok: true, removed: boolean }`.

The existing `DELETE /:platform` route SHALL accept `"twitter-collector"` (kebab-case URL → `"twitter_collector"` storage key) **OR** the route MUST be extended explicitly — implementer's choice, but both API paths must work consistently with the existing LinkedIn/Twitter routes.

The existing `GET /api/admin/social-credentials` SHALL include the `twitterCollector` status field.

All these routes are protected by the existing `requireAdmin` middleware (no change needed — the router is already mounted under `/api/admin/...`).

### REQ-005 — Pipeline credential resolver

`packages/pipeline/src/services/credential-resolver.ts` SHALL export:

```ts
export interface TwitterCollectorCookie {
  apiKey: string;
}
export function resolveTwitterCollectorCookie(
  deps: CredentialResolverDeps,
): Promise<TwitterCollectorCookie | null>;
```

Semantics (verbatim, mirrors `resolveTwitterOAuth1Credentials`):

1. Read DB row via `deps.repo.getTwitterCollector()`. Catch any error → log `credential.resolver.db_read_failed { platform: "twitter_collector" }` and return `null` (do NOT fall through to env).
2. If row present and decrypts: return `{ apiKey: row.apiKey }`.
3. If row absent: read `deps.env.RETTIWT_API_KEY`; if present and non-empty, return `{ apiKey: env }`. Otherwise return `null`.

### REQ-006 — Per-job wiring (no worker-startup cache)

In `packages/pipeline/src/workers/processing.ts` and `packages/pipeline/src/workers/run-process.ts`, the construction of the `twitterClient` SHALL be moved **inside the per-job handler** (after the job ID is known), and the `Rettiwt` constructor SHALL receive the value resolved by `resolveTwitterCollectorCookie` (or `undefined` when null).

The current module-level / worker-startup `new Rettiwt({ apiKey: process.env.RETTIWT_API_KEY })` SHALL be removed from any code path that handles a run.

### REQ-007 — Collector failure isolation

When the resolved cookie is null, the Twitter collector SHALL still run but its first authenticated rettiwt call WILL fail; the existing error handling in `packages/pipeline/src/collectors/twitter/index.ts` SHALL classify this as an `auth` error code in the returned `TwitterCollectorFailure`, with the message `"missing or invalid cookies"`.

The collector SHALL NOT throw; it SHALL return a `CollectorResult` whose source-unit results carry the failure. The surrounding `Promise.allSettled` in `run-process.ts` (where collectors fan out) SHALL continue with other sources, and the run SHALL reach the `review-pending` state as long as ≥1 collector succeeds (existing behaviour, not changed by this spec).

### REQ-008 — Slack notification labelling

The Slack `notifyReviewPending` message builder SHALL render Twitter `auth` failures with the labelled text `twitter: skipped (missing cookies — set them at /admin/settings)` in the per-source telemetry block. The labelling is a pure render-layer change in `packages/shared/src/slack/builders/review-pending.ts` (or whichever builder owns the per-source line — implementer should find the right call site); no notifier interface change is required.

For any other collector that emits an `auth`-class failure (Reddit, etc.) the same labelling pattern SHALL apply: `<source>: skipped (<message>)`. This generalises the formatting; storage moves are explicitly out of scope.

### REQ-009 — Web admin panel

`packages/web/src/api/socialCredentials.ts` SHALL export:

- `TwitterCollectorStatus { configured: boolean; updatedAt: string | null }`
- `SocialCredentialsStatus` extended with `twitterCollector: TwitterCollectorStatus`
- `TwitterCollectorUpsertInput { apiKey: string }`
- `putTwitterCollectorCookie(input)` calling `PUT /api/admin/social-credentials/twitter-collector`
- `useSaveTwitterCollectorCookie()` mutation hook
- The `deleteSocialCredentials` hook MUST accept `"twitter-collector"` in addition to `"linkedin" | "twitter"`.

`packages/web/src/components/SocialCredentialsPanel.tsx` SHALL render a third card "Twitter collector cookies" with:

- Status pill (`Not configured` / `Configured (updated …)`).
- A single textarea field labelled "Base64 cookie blob".
- A short helper paragraph explaining the source of the value (paraphrased from `.env.example`).
- Save and Delete buttons wired to the new hooks.
- `data-testid="twitter-collector-card"` for the Playwright e2e to target.

### REQ-010 — Env-var fallback preserved

`RETTIWT_API_KEY` SHALL continue to work when no DB row exists. `.env.example` SHALL be updated to note "deprecated — prefer setting via /admin/settings"; the variable is NOT removed.

### REQ-011 — CLAUDE.md sync

The "Required env vars" paragraph in `CLAUDE.md` SHALL be updated to add `RETTIWT_API_KEY` to the optional set (it is currently absent from the listed envs) AND to note that it can be managed via `/admin/settings` like the LinkedIn/Twitter posting creds.

## Edge cases

| # | Case | Required behaviour | Verified by |
|---|---|---|---|
| EC-1 | Admin saves cookies for the first time, then triggers a run | Next run uses the DB value | VS-2 |
| EC-2 | Admin updates cookies between runs | Second run uses the new value (no restart) | VS-3 |
| EC-3 | Admin deletes cookies; env var still set | Resolver falls back to env | VS-2 |
| EC-4 | Admin deletes cookies AND env unset | Resolver returns null; collector emits `auth` failure; run continues | VS-4 |
| EC-5 | `SESSION_SECRET` rotated after row written | Resolver logs `db_read_failed` once, returns null, does NOT fall through to env | VS-6 |
| EC-6 | Cookies present but X invalidates them | Rettiwt throws on first request; collector returns `auth` failure | VS-4 (proxy) |
| EC-7 | Whitespace-padded paste | Zod `.trim().min(1)` strips and validates | VS-1 |
| EC-8 | Concurrent saves from two admin tabs | Last write wins via `onConflictDoUpdate` | covered by existing repo behaviour |
| EC-9 | Slack labels the Twitter auth failure clearly in the review-pending message | Builder emits the labelled line | VS-5 |

## Verification Scenarios

Folded from design.md §"Verification scenarios". These will be re-proven by `functional-verify` against live services.

### VS-0 — Library probe replays
Not applicable — library-probe.md verdict is PASS with no live probe scripts. The relevant library boundaries were exercised by earlier specs (`add-twitter-x-collector`, `admin-social-config`).

### VS-1 — Persist + resolve round-trip (unit + e2e)
**Given** a `SocialCredentialsRepo` backed by Postgres and a `CredentialCipher` keyed on `SESSION_SECRET`,
**When** the route `PUT /api/admin/social-credentials/twitter-collector` is called with `{ apiKey: "<base64>" }`,
**Then** `getStatus().twitterCollector.configured === true` and `resolveTwitterCollectorCookie({ repo, env: {} })` returns `{ apiKey: "<base64>" }`.

### VS-2 — DB-first, env-fallback (unit)
**Given** a clean DB,
**When** `RETTIWT_API_KEY=env-value`, resolver returns `{ apiKey: "env-value" }`.
**When** then `upsertTwitterCollector({ apiKey: "db-value" })` is invoked, resolver returns `{ apiKey: "db-value" }`.
**When** the DB row is then deleted (env still set), resolver returns `{ apiKey: "env-value" }`.
**When** env is also unset, resolver returns `null`.

### VS-3 — No-restart freshness (integration / e2e)
**Given** a worker that has handled at least one job with cookie value `v1`,
**When** the DB row is updated to `v2`,
**Then** the *next* job's `resolveTwitterCollectorCookie` returns `v2`. This proves the cookie is NOT resolved at worker startup. The test asserts via the resolver, not by spinning up the full BullMQ loop — but the assertion is at the call site that the worker uses (the per-job handler).

### VS-4 — Collector failure does not fail the run (e2e or scripted)
**Given** a run with Twitter enabled and no cookies (DB empty, env unset),
**When** the run is processed,
**Then** the Twitter source yields a `TwitterCollectorFailure { code: "auth" }`, at least one other collector (e.g. HN with a stub or recorded fixture) succeeds, and the run reaches the `review-pending` status. The aggregate `CollectorResult` for Twitter MUST be present in the run state's source results.

### VS-5 — Slack labels the Twitter failure (unit on the builder)
**Given** a review-pending payload whose per-source telemetry includes a Twitter `auth` failure with message `"missing or invalid cookies"`,
**When** the Slack message is built,
**Then** the rendered text contains the substring `twitter: skipped (missing cookies — set them at /admin/settings)`.

### VS-6 — decrypt-failed path (unit)
**Given** a row whose `encryptedFields.apiKey` was written with a different KEK (simulate by mutating the row's nonce or by encrypting with a one-off cipher),
**When** the resolver calls `getTwitterCollector()`,
**Then** the resolver returns `null` AND emits a log line `credential.resolver.db_read_failed { platform: "twitter_collector" }` AND does NOT read `RETTIWT_API_KEY`.

### VS-7 — Admin UI smoke (Playwright MCP)
**Given** the admin is authenticated and lands on `/admin/settings`,
**When** they expand `[data-testid="twitter-collector-card"]`, paste a base64 string into the textarea, and click Save,
**Then** the status pill changes from `Not configured` to `Configured`. On page reload the pill remains `Configured`. On Delete, it reverts to `Not configured`.

### VS-8 — `.env.example` and CLAUDE.md updated
**Given** the patch is applied,
**Then** `grep -n "RETTIWT_API_KEY" .env.example` finds a "deprecated — prefer /admin/settings" comment, and the Required env vars paragraph in `CLAUDE.md` mentions the variable + the admin route.

## Verification Matrix

| Req | Verified by | Type |
|---|---|---|
| REQ-001 | drizzle generate (snapshot diff), VS-1 | static + e2e |
| REQ-002 | VS-1, VS-2 | unit |
| REQ-003 | VS-1 (route hit with bad body returns 400) | unit |
| REQ-004 | VS-1, VS-7 | integration + e2e |
| REQ-005 | VS-2, VS-6 | unit |
| REQ-006 | VS-3 | integration |
| REQ-007 | VS-4 | scripted e2e |
| REQ-008 | VS-5 | unit |
| REQ-009 | VS-7 | Playwright e2e |
| REQ-010 | VS-2 (env-fallback branch) + VS-8 | unit + grep |
| REQ-011 | VS-8 | grep |
