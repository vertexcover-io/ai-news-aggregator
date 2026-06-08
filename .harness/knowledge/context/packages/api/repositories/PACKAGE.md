---
governs: packages/api/src/repositories/
last_verified_sha: 8f2bc3411177651bbd5e223a7aba4b77be130474
key_files: [run-archives.ts, raw-items.ts, subscribers.ts, social-credentials.ts, social-tokens.ts, user-settings.ts, must-read.ts, eval-runs.ts, email-sends.ts, ses-events.ts, analytics.ts, review-edits.ts, run-logs.ts, incidents.ts]
flow_fns: [run-archives.ts::searchReviewed, raw-items.ts::listRawItemsForRunWithEnrichment]
decisions: [D-003, D-005, D-006, D-011, D-012, D-115, D-118]
status: active
---

# repositories/ — Drizzle DB access layer

## Purpose

One repository factory per DB table or logical domain group. Every repository is a factory function that accepts a `Pick<AppDb, ...>` slice and returns a typed interface. This is the ONLY layer allowed to import `drizzle-orm` or `@newsletter/shared/db` (enforced by `newsletter/enforce-repository-access`). Routes and services import only repository interfaces.

## Public surface

- `createRunArchivesRepo(db) → RunArchivesRepo` — finds, lists, searches, updates archives; manages Slack/email/social markers; pool queries; source facets; telemetry aggregation
- `createRawItemsRepo(db) → RawItemsRepo` — finds by IDs, lists for a run window, aggregates by source+identifier; exposes `deriveRawItemIdentifierSql()`
- `createSubscribersRepo(db) → SubscribersRepo` — CRUD on subscribers; `updateStatus` returns `{ changed, next, row }` via `WHERE status != $newStatus`
- `createSocialCredentialsRepo(db, cipher) → SocialCredentialsRepo` — encrypts/decrypts credentials; upsert via `onConflictDoUpdate`
- `createSocialTokensRepo(db, cipher) → SocialTokensRepo` — saves/reads/deletes OAuth tokens (encrypted at rest)
- `createUserSettingsRepo(db) → UserSettingsRepo` — `get()` reads singleton; `upsert()` via `onConflictDoUpdate`
- `createMustReadRepo(db) → MustReadRepo` — full CRUD + `findRandom()` via `ORDER BY random()`
- `createEvalRunsRepo(db) → EvalRunsRepo` — insert/updateFinish/updateFailed/getById/list
- `createEmailSendsRepo(db) → EmailSendsRepo` — create, find sent subscriber IDs, find by message ID
- `createSesEventsRepo(db) → SesEventsRepo` — upsert SES event (idempotent on messageId+eventType)
- `createAnalyticsRepo(db) → AnalyticsRepo` — aggregated metrics in date range
- `createReviewEditsRepo(db) → ReviewEditsRepo` — `replaceForRun()` (delete-all + insert batch), `listForRun()`
- `createRunLogRepo(db) → RunLogRepo` — `listForRun()` ordered by id ASC
- `createIncidentsRepo(db) → IncidentRepository` — `upsertByFingerprint` (ON CONFLICT fingerprint, returns `{ incident, shouldNotify }` with pre-update `notified_at` check; D-118), `markDelivered`, `incrementDeliveryAttempts`, `listUndelivered`, `list` (with status/severity filter), `setStatus`

## Depends on / used by

**Uses:** `@newsletter/shared/db` (schema tables), `drizzle-orm`, `@newsletter/shared` (types), `@newsletter/shared/services` (deriveRawItemIdentifier, credential-cipher)
**Used by:** routes, services, index.ts (bootstrap)

## Data flows

```
searchReviewed(input) → SearchReviewedResult:
  q? undefined (no FTS) → filter reviewed=true + is_dry_run=false + date range
    → order by coalesce(published_at, completed_at) DESC
    → limit capped at 50
    → hydrateListItems (joins top-3 ranked item IDs to raw_items)
    → count query for total
  q? present (FTS) → websearch_to_tsquery('english', immutable_unaccent(q))
    → filter reviewed + not dry-run + date range + search_tsv @@ tsquery
    → order by ts_rank_cd DESC, then coalesce(published_at, completed_at) DESC

listRawItemsForRunWithEnrichment(runId, deps) → RawItemWithEnrichment[]:
  → resolveRunWindow
  → first try: WHERE run_id = $runId (exact attribution, D-005)
    ├─ rows found → map to RawItemWithEnrichment
    └─ no rows → fallback to time-window query (pre-migration archives)
```

## Gotchas / landmines

- **Postgres `DERIVED_IDENTIFIER_SQL` must mirror JS `deriveRawItemIdentifier` exactly.** The SQL `CASE` expression is a hand-maintained mirror. Backslashes are doubled (`\\\\.`) so Postgres receives `\\.`; `(?i)` inline flag makes POSIX regex case-insensitive. (D-011)
- **`findById` on run_archives rejects non-UUID strings with a regex guard.**
- **`updateStatus` uses `WHERE status != $newStatus` to detect changes.** (D-006)

## Decisions

- **D-011:** SQL `DERIVED_IDENTIFIER_SQL` is a hand-maintained mirror of JS `deriveRawItemIdentifier`. **Why:** SQL aggregation needs the same identifier derivation for GROUP BY. Drizzle migrations don't support UDFs cleanly. **Tradeoff:** Duplication risk mitigated by e2e cross-check tests. **Governs:** `raw-items.ts`.
- **D-012:** Credential repos use `CredentialCipher` for AES-256-GCM encryption at rest. **Why:** DB-stored credentials must not be plaintext. **Tradeoff:** Rotating `SESSION_SECRET` invalidates all encrypted credentials. **Governs:** `social-credentials.ts`, `social-tokens.ts`.
