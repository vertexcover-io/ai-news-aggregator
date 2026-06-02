---
governs: packages/web/src/api/
last_verified_sha: 5a2ff20
key_files: [client.ts, admin.ts, archives.ts, runs.ts, settings.ts, eval.ts, socialCredentials.ts, sources.ts, subscribe.ts, home.ts, must-read.ts, analytics.ts, analyticsConfig.ts, health-check.ts]
flow_fns: [client.ts::apiFetchAdmin, eval.ts::runEval]
decisions: [D-008]
status: active
---

# api/ — typed HTTP client layer

## Purpose

One file per backend API domain. Every function calls the base wrappers `apiFetch` (public) or `apiFetchAdmin` (admin-gated with auto-redirect on 401). Components never call `fetch` directly.

## Public surface

| fn | Effect |
|---|---|
| `apiFetch(path, init?)` → `Response` | Base fetch: adds `Content-Type: application/json` + `credentials: include` |
| `apiFetchAdmin(path, init?)` → `Response` | Same as `apiFetch` but 401 redirects to `/admin/login?next=<current>` |
| `admin.ts::login(body)` | POST `/api/admin/login` → `AdminLoginResponse`, throws `LoginFailedError` on 401 |
| `admin.ts::logout()` | POST `/api/admin/logout` |
| `admin.ts::fetchMe()` | GET `/api/admin/me` → throws `UnauthenticatedError` on 401 |
| `runs.ts::submitRun(payload)` | POST `/api/runs` via `apiFetchAdmin` (non-admin paths use `apiFetchAdmin` for error handling) |
| `runs.ts::getRun(runId)` | GET `/api/runs/:runId` → `RunStateResponse \| null` (404 → null) |
| `runs.ts::getArchive(runId)` | GET `/api/archives/:runId` → public, no admin redirect |
| `runs.ts::getAdminArchive(runId)` | GET `/api/admin/archives/:runId` → admin-gated |
| `runs.ts::listRuns(limit?)` | GET `/api/runs` → `RunSummary[]` |
| `runs.ts::triggerRunNow(opts?)` | POST `/api/runs/now` with optional `{ dryRun: true }` |
| `runs.ts::triggerSocialPost(runId, channel)` | POST `/api/runs/:runId/post/:channel` |
| `runs.ts::cancelRun(runId)` | POST `/api/runs/:runId/cancel` → `{ status: "ok" }` or `{ status: "already-terminal" }` (409 → not an error) |
| `runs.ts::getRunObservability(runId)` | GET `/api/admin/runs/:runId/observability` → `RunObservability \| null` |
| `runs.ts::getRunSourceItems(runId, sourceKey)` | GET `/api/admin/runs/:runId/sources/:key/items` |
| `archives.ts::listArchives()` | GET `/api/archives` → public, `ArchiveListResponse` |
| `archives.ts::searchArchives(query)` | GET `/api/archives/search?q=&from=&to=` → FTS search |
| `archives.ts::patchArchive(runId, body)` | PATCH `/api/admin/archives/:runId` |
| `archives.ts::addPost(runId, body)` | POST `/api/admin/archives/:runId/add-post` → `RankedItem` |
| `archives.ts::getPool(runId, query)` | GET `/api/admin/archives/:runId/pool?...` → `PoolResponse` |
| `archives.ts::promoteItem(runId, body)` | POST `/api/admin/archives/:runId/promote` → `RankedItem` |
| `archives.ts::regenerateDigestMeta(runId, items)` | POST `/api/admin/archives/:runId/regenerate-digest-meta` → `DigestMeta` |
| `archives.ts::getSourceFacets(runId)` | GET `/api/admin/archives/:runId/source-facets` → grouped `SourceFacetGroup[]` |
| `archives.ts::deleteArchive(runId)` | DELETE `/api/admin/archives/:runId` |
| `settings.ts::getSettings()` | GET `/api/settings` → `UserSettings \| null` |
| `settings.ts::putSettings(input)` | PUT `/api/settings` → throws `SettingsApiError` with `.failures` on 422 |
| `sources.ts::fetchSourcesSummary(opts?)` | GET `/api/sources/summary?from=&to=` → public |
| `eval.ts::getEvalFixture(id)` | GET `/api/admin/eval/fixtures/:id` |
| `eval.ts::listEvalFixtures()` | GET `/api/admin/eval/fixtures` |
| `eval.ts::saveGroundTruth(fixtureId, gt)` | POST `/api/admin/eval/groundtruth/:id` |
| `eval.ts::runEval(body)` → `EvalRunStream` | SSE stream: POST `/api/admin/eval/run`, returns `{ progress: AsyncIterable, abort: () => void }` |
| `eval.ts::listCalendarRuns(date)` | GET `/api/admin/eval/calendar-runs?date=` |
| `eval.ts::listEvalRuns(params)` | GET `/api/admin/eval/runs?page=&mode=&status=` |
| `socialCredentials.ts::useSocialCredentialsStatus()` | React Query hook for social credential status |
| `socialCredentials.ts::startLinkedInOAuth()` | POST `/api/admin/social-credentials/linkedin/oauth/start` → `{ authorizeUrl }` |
| `socialCredentials.ts::fetchLinkedInOAuthStatus()` | GET `/api/admin/social-credentials/linkedin/oauth/status` |
| `subscribe.ts::postSubscribe(email)` | POST `/api/subscribe` → `{ ok: true }` or `{ error: string }` |
| `health-check.ts::triggerHealthCheck(collectorType)` | POST `/api/admin/health-check/:collectorType` → `{ jobId, collector }` |
| `health-check.ts::triggerHealthCheckAll()` | POST `/api/admin/health-check` → `{ jobId, collectors: [...] }` |

## Depends on / used by

- **Uses:** `api/client.ts` (fetch wrappers)
- **Uses:** types from `@newsletter/shared` (via subpath imports)
- **Used by:** hooks/, pages/, components/

## Data flows

```
apiFetchAdmin(path, init?) → Response:
  apiFetch(path, init) → Response
    ├─ res.status === 401 AND location starts with "/admin"
    │    → encodeURIComponent(location) → window.location.assign("/admin/login?next=...")        (D-002)
    └─ otherwise → return res

runEval(body) → EvalRunStream:
  fetch("/api/admin/eval/run", { method: "POST", body: JSON, signal: AbortSignal }) → ReadableStream
    → TextDecoder → SSE parser loop
       ├─ Parse "event:" / "data:" lines from "\n\n"-delimited chunks
       ├─ JSON.parse data → queue.push({ event, data })
       └─ abort() closes the queue + controller.abort()
  { progress: AsyncEventQueue (AsyncIterable), abort: () => void }
```

## Gotchas / landmines

- **`cancelRun` treats 409 as success** (returns `{ status: "already-terminal" }`) — any other non-2xx throws. The caller must handle both shapes.
- **`getRunObservability` returns null on 404** — this is the expected behaviour when a run has no archive yet AND no Redis live state. Callers treat null as "not found."
- **`socialCredentials.ts` exports React hooks** — unlike other api/ files which are pure functions, this file provides `useSocialCredentialsStatus`/`useSaveLinkedInCredentials` etc. because the mutation invalidation is tightly coupled to the API calls.
- **`eval.ts::runEval` uses raw `fetch`** (not `apiFetch`) because SSE streams need direct access to `ReadableStream` via `response.body.getReader()`.

## Decisions

### D-008: SSE eval stream uses raw fetch

**Why:** `apiFetch` returns a full `Response` but SSE needs direct `ReadableStream` access for `getReader()`. Using `apiFetch` would still work but the pattern is to have `runEval` own its fetch call since it's the only SSE consumer in the codebase.

**Tradeoff:** Bypasses the 401 auto-redirect from `apiFetchAdmin`. If the SSE stream token expires mid-stream, the error surfaces as a stream error, not a redirect. Acceptable for a short-lived eval run.

**Governs:** `api/eval.ts::runEval`
