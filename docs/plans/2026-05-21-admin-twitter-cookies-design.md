# Design — Twitter collector cookies in admin settings

**Status:** Approved
**Date:** 2026-05-21
**Author:** orchestrate pipeline

## Problem

The Twitter (X) collector authenticates against the `rettiwt-api` SDK using a base64-encoded session cookie blob passed through the `RETTIWT_API_KEY` env var. To rotate cookies today, an admin must shell into the host, edit `.env`, and restart the pipeline worker. Cookies expire frequently (X invalidates them within days/weeks), so this turns a routine refresh into a deploy-style operation.

Goal: let an admin paste a fresh base64 cookie blob into `/admin/settings`, save it, and have the **next pipeline run** pick it up — no worker restart, no env edit. When cookies are missing or invalid, the Twitter collector should fail individually and the failure should surface in the Slack run-summary notification, but the surrounding pipeline run (other collectors, dedup, rank, archive) must continue.

## Goals

1. Store the base64 cookie blob encrypted at rest in `social_credentials`, alongside the existing LinkedIn/Twitter posting credentials.
2. Expose a Twitter-collector card on `/admin/settings` that wraps the existing `SocialCredentialsPanel` pattern: status pill, paste-and-save form, delete button.
3. Resolve the cookie blob per pipeline job (DB-first, env-fallback) so admin edits land on the next run without a worker restart.
4. When cookies are missing or decrypt-fails, the Twitter collector returns a failure result — never throws — and the run continues with the other sources.
5. The Slack run-summary message (already posted at review-completion) lists the per-source telemetry it already lists; we extend it so a Twitter-cookie failure is clearly labelled (e.g. `twitter: failed (missing cookies)` rather than a generic crash trace).

## Non-goals

- We do NOT generalise to "all collectors store creds in DB now." Other collectors (HN, Reddit, web-search) keep their current env-only configuration; only the Twitter cookie blob moves. (The Slack-message formatting change for per-collector failure messages is reusable across collectors, but the storage move is scoped.)
- We do NOT add a cookie-validation probe (no live ping to X to check freshness). If cookies are invalid, the failure surfaces on the next run via the existing collector-failure path.
- We do NOT change the `RETTIWT_API_KEY` env var name, behaviour, or `.env.example` text beyond marking it deprecated. Env still works as a fallback so existing prod deployments don't break the moment this lands.
- We do NOT remove the existing X/Twitter **posting** OAuth-1 credentials (`socialCredentials.platform = "twitter"`) — they remain. We need a *separate* platform key because the same DB row cannot hold both kinds of secrets for the same `platform` primary key.

## Architecture

### Storage — extend `social_credentials.platform` enum

The `social_credentials` table today keys on `platform: "linkedin" | "twitter"` where `"twitter"` means *X OAuth-1 posting credentials*. The collector cookies are a different secret (a base64 cookie blob, not OAuth-1 tokens), so we add a new platform key rather than overload the existing row.

```ts
// packages/shared/src/db/schema.ts
export const socialCredentials = pgTable("social_credentials", {
  platform: text("platform").primaryKey()
    .$type<"linkedin" | "twitter" | "twitter_collector">(),
  encryptedFields: jsonb("encrypted_fields")
    .notNull()
    .$type<
      | LinkedInEncryptedFields
      | TwitterEncryptedFields
      | TwitterCollectorEncryptedFields
    >(),
  // ...unchanged
});

export interface TwitterCollectorEncryptedFields {
  apiKey: EncryptedBlob;   // the base64 cookie blob, encrypted via existing CredentialCipher
}
```

**Why a new row, not a new column or table:**
- A new column would force every existing read site to know about it and would break the symmetry of the cipher/repo pattern.
- A new table would duplicate the cipher resolver scaffolding for a single field — three lines of code is better than a premature abstraction.
- A new platform key reuses the existing cipher, repo, route shape, and panel UI with minimal new code.

### Migration

Drizzle migration: no DDL needed (the `platform` column is already `text`; the `.$type<...>()` change is compile-time only). The migration is a no-op at the SQL level, but we still generate one to keep the snapshot consistent.

### Resolver — `resolveTwitterCollectorCookie`

Mirror the existing `resolveTwitterOAuth1Credentials` shape in `packages/pipeline/src/services/credential-resolver.ts`:

```ts
export interface TwitterCollectorCookie {
  apiKey: string; // base64 cookie blob (rettiwt's `apiKey` constructor arg)
}

export async function resolveTwitterCollectorCookie(
  deps: CredentialResolverDeps,
): Promise<TwitterCollectorCookie | null> {
  const dbRead = await safeGetDbRow(
    () => deps.repo.getTwitterCollector(),
    "twitter_collector",
  );
  if (dbRead.ok === "decrypt_failed") return null;
  const dbRow = dbRead.ok;
  if (dbRow) return { apiKey: dbRow.apiKey };
  const env = (deps.env ?? {}).RETTIWT_API_KEY;
  if (!present(env)) return null;
  return { apiKey: env };
}
```

Semantics match the LinkedIn/Twitter pattern:
- DB row present + decrypts → use it.
- DB row present + decrypt fails → log + return null (operator intent is the admin UI; do NOT silently fall through to env).
- DB row absent → env fallback.
- Neither → return null; collector becomes a no-op for the run.

### Per-job wiring — no worktime cache

In `packages/pipeline/src/workers/processing.ts` and the equivalent fallback path in `workers/run-process.ts`, the existing line:

```ts
const twitterClient = createRettiwtClient({
  rettiwt: new Rettiwt({ apiKey: process.env.RETTIWT_API_KEY }),
});
```

…resolves the cookie **once at worker startup**. This violates the freshness promise we're making to the admin (see `.claude/rules/learnings/cache-vs-spec-promise-review.md`). We move client construction into a per-job closure, mirroring how the LinkedIn/X *posting* notifiers are built today:

```ts
// inside handleRunProcessJob (per job)
const cookie = await resolveTwitterCollectorCookie({ repo, env: process.env });
const twitterClient = createRettiwtClient({
  rettiwt: new Rettiwt({ apiKey: cookie?.apiKey }),
});
```

`Rettiwt` accepts `undefined` (guest mode) — the collector itself already guards against unauthenticated calls (see comment at `run-process.ts:888`), so a missing cookie means the collector runs and fails fast on its first authenticated request rather than crashing the worker.

### Collector failure isolation — surface it in Slack

The collector pattern already returns `CollectorResult` (success/failure structured). The Twitter collector currently logs auth errors and returns a `TwitterCollectorFailure` with an error code (`auth`, `not_found`, `rate_limit`, `schema`, `unknown`). On the cookie-missing path, we return `auth` with a stable message like `missing or invalid cookies`.

The Slack notifier already builds a per-source-telemetry block in the review-pending message. We extend the per-source rendering so a Twitter `auth` failure is labelled clearly: `twitter: skipped (missing cookies — set them at /admin/settings)` — actionable, not a stack trace. The same formatter change benefits other collectors with `auth`-class failures (e.g. Reddit if its creds become invalid in the future).

### Admin UI

The existing `SocialCredentialsPanel` already renders the LinkedIn + Twitter-posting cards. We add a **third card** for "Twitter collector cookies":

- Single textarea labelled "Base64 cookie blob" with a short paragraph explaining how to obtain it (mirror the wording from `.env.example`).
- Save → `PUT /api/admin/social-credentials/twitter-collector`.
- Delete → `DELETE /api/admin/social-credentials/twitter-collector`.
- Status pill: "Configured (updated <time>)" or "Not configured".

API route mirrors the existing `/api/admin/social-credentials/twitter` route; the web client adds `useSaveTwitterCollectorCookie` + `useDeleteSocialCredentials` (existing hook generalises with a new union variant).

## External Dependencies & Fallback Chain

This feature uses **only libraries already verified in earlier specs**:

| Dependency | Purpose | Status | Fallback |
|---|---|---|---|
| `rettiwt-api` | Twitter collector client | Already in use (verified in `docs/spec/add-twitter-x-collector/probes/`) — accepts undefined `apiKey` for guest mode | N/A (no swap) |
| `@newsletter/shared/services/credential-cipher` (AES-256-GCM via HKDF over `SESSION_SECRET`) | Encrypt cookie blob at rest | In use for LinkedIn + Twitter posting creds; same cipher, same KEK | N/A |
| Hono + Drizzle | API route + repo | In use across the project | N/A |
| react-hook-form + sonner + shadcn/ui | Admin panel UI | In use in `SocialCredentialsPanel` today | N/A |

No new dependencies. Library probe is N/A — every external integration this feature touches has been probed by an earlier spec (`add-twitter-x-collector` and `admin-social-config`).

## Edge cases

| Case | Behaviour |
|---|---|
| Admin saves cookies for the first time | DB row inserted, env-var (if set) is shadowed on the next run |
| Admin updates cookies mid-day | Next pipeline run sees the new value (no worker restart) |
| Admin deletes cookies, env var still set | Falls through to env (so prod doesn't break) |
| Admin deletes cookies AND env unset | Collector returns `auth` failure; Slack run-summary shows the message; run continues |
| `SESSION_SECRET` rotates after a row was written | Resolver logs `credential.resolver.db_read_failed` once and returns null. Collector treats it as "not configured" → `auth` failure → Slack notice. No silent fallback to env. |
| Cookies are present but X invalidated them | Rettiwt throws an auth error on first request; collector catches and returns `auth` failure; Slack run-summary shows it |
| User pastes whitespace-padded cookies | Zod schema `.trim().min(1)` strips it (same validator pattern as existing routes) |
| Concurrent saves from two admin tabs | Last write wins (`onConflictDoUpdate`, same pattern as existing routes) |

## Verification scenarios (will be folded into spec.md by spec-gen)

1. **Persist + resolve round-trip:** save base64 blob via `PUT /api/admin/social-credentials/twitter-collector`; resolver returns the decrypted value.
2. **DB-first, env-fallback:** save creds → resolver returns DB value; delete creds with `RETTIWT_API_KEY` env set → resolver returns env value; delete + unset env → resolver returns null.
3. **No-restart freshness:** start a run with DB-stored cookies; mutate the DB row; start a second run; second run uses the new cookies (proves the per-job resolver isn't cached at worker boot).
4. **Collector failure does not fail the run:** with cookies unset and env unset, trigger a run with Twitter enabled — Twitter source yields `auth` failure, other collectors succeed, run reaches review-pending status.
5. **Slack notice labels the Twitter failure:** when the Twitter source returns `auth` failure, the review-pending Slack message includes the labelled line (test the message builder directly).
6. **decrypt-failed path:** simulate a row encrypted with an old KEK (write a row with `cipher.encrypt(...)` then mutate `SESSION_SECRET` for the resolver test) — resolver returns null and logs the error; collector does NOT fall through to env.
7. **Admin UI smoke (Playwright):** load `/admin/settings`, see the new Twitter-collector card with `Not configured` pill; paste a value, save; see `Configured` pill; reload page; status survives. Delete; pill reverts.
