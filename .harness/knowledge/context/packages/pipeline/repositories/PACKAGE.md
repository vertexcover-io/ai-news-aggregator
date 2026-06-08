---
governs: packages/pipeline/src/repositories/
last_verified_sha: 8f2bc3411177651bbd5e223a7aba4b77be130474
key_files: [raw-items.ts, run-archives.ts, candidates.ts, run-logs.ts, eval-exports.ts, social-credentials.ts, social-tokens.ts, subscribers.ts, email-sends.ts, user-settings.ts, incidents.ts]
flow_fns: [run-archives.ts::createRunArchivesRepo.upsert, eval-exports.ts::createEvalExportsRepo.getCompletedRunDetail]
decisions: [D-060, D-061, D-115, D-118]
status: active
---

# repositories/ — Drizzle DB wrappers providing typed data access for the pipeline

## Purpose
Factory functions that create repository objects wrapping Drizzle ORM calls. Each factory takes `db: Pick<AppDb, ...>` (minimum required slice). All DB access from pipeline workers flows through these repos — direct `@newsletter/shared/db` imports outside `repositories/` are forbidden by `newsletter/enforce-repository-access`.

## Public surface
- `createRawItemsRepo(db)` → `RawItemsRepo` — upsertItems, findExistingExternalIds, findBySourceAndExternalId, findByIds, updateRecapData
- `createRunArchivesRepo(db)` → `RunArchivesRepo` — upsert (INSERT ON CONFLICT), findById, findLatestTerminal, markEmailSent, markLinkedInPosted, markTwitterPosted, markNotification, recordSocialFailure, setCostBreakdown, getCostBreakdown, getPublishedCanonicalUrls
- `createCandidatesRepo(db)` → `CandidatesRepo` — findSince (by collectedAt + sourceTypes)
- `createRunLogRepo(db)` → `RunLogRepo` — append (pure INSERT, no precondition)
- `createEvalExportsRepo(db)` → `EvalExportsRepo` — listCompletedArchives, findRawItemsInWindow, findRawItemsByDate, listCompletedRunsByDate, getCompletedRunDetail
- `createSocialCredentialsRepo(db, cipher)` → `SocialCredentialsRepo` — getLinkedIn, getTwitter, getTwitterCollector, upsert*, delete (encrypted at rest via AES-256-GCM)
- `createSocialTokensRepo(db, cipher)` → `SocialTokensRepo` — getToken, saveToken, withTokenLock (FOR UPDATE row-level lock)
- `createPipelineSubscribersRepo(db)` → `PipelineSubscribersRepo` — listConfirmed, findByIds, countConfirmed
- `createPipelineEmailSendsRepo(db)` → `PipelineEmailSendsRepo` — create, findSentSubscriberIds
- `createUserSettingsRepo(db)` → `UserSettingsRepo` — get (singleton row)
- `createIncidentsRepo(db)` → `IncidentRepository` — same interface as api/repositories/incidents.ts; concrete Drizzle implementation for the pipeline context (D-116)

## Depends on / used by
- Uses: `drizzle-orm`, `@newsletter/shared/db` (schema, types), `@newsletter/shared/services/credential-cipher`
- Used by: all workers, services

## Data flows

### upsert(input) → void (run-archives.ts)
  input → INSERT INTO run_archives ... ON CONFLICT (id) DO UPDATE
    → set clause uses sql.raw(`excluded.<column>`) for all fields
    → preReviewSnapshot: COALESCE(existing, excluded) — first write wins (REQ-008)
  (single upsert handles both insert and update; no separate INSERT/UPDATE paths)
  (sets all fields including runFunnel, publishedAt, shortlistedItemIds, preReviewSnapshot)

### getCompletedRunDetail(runId) → CalendarRunDetail | null (eval-exports.ts)
  runId → SELECT run_archives WHERE status='completed' AND id=runId
    → loadDedupedPool:
      ├─ SELECT raw_items WHERE run_id = archive.id (exact attribution)
      ├─ if 0 rows → fallback: SELECT raw_items WHERE collectedAt BETWEEN startedAt AND completedAt
      └─ dedupCandidates on FixtureItems → survivors
    → buildPreviousRanking: map rankedItems over sourcePool (cross-reference by rawItemId)
    → CalendarRunDetail { runId, itemCount: sourcePool.length, previousRanking, sourcePool, ... }
  (itemCount from deduped pool, consistent with listCompletedRunsByDate)

## Gotchas / landmines
- **`setCostBreakdown` is bare UPDATE**: No INSERT fallback. Callers must guarantee the archive row exists first. Failure paths in `run-process.ts` insert a partial archive before calling `setCostBreakdown`. (D-060)
- **`getPublishedCanonicalUrls` loads all reviewed archives**: Scans every reviewed, non-dry-run, completed archive to build the covered-link set. Could be slow with thousands of archives — currently acceptable for the MVP dataset size.
- **`upsertItems` deduplicates in-batch**: Postgres rejects `INSERT ... ON CONFLICT` with duplicate conflict targets in the same batch (error 21000). The repo collapses duplicates by `(sourceType, externalId)` before insert, last write wins. (D-061)
- **`withTokenLock` uses SELECT ... FOR UPDATE**: Row-level lock inside a transaction for token-refresh racing. Caller must not hold the lock across external API calls (notifier follows this pattern).

## Decisions
- **D-060**: `setCostBreakdown` is UPDATE-only. Why: cost is always written after archive row creation on every path (success, failure, cancel). Tradeoff: new callers must follow the upsert-before-update pattern. Governs: `repositories/run-archives.ts`.
- **D-061**: In-batch dedup in `upsertItems`. Why: Postgres constraint prevents duplicate conflict targets in a single INSERT. Collapsing in JS before the insert is simpler than splitting into per-row statements. Tradeoff: last-write-wins semantics within the batch (acceptable — duplicates from same collector run are semantically identical). Governs: `repositories/raw-items.ts`.
