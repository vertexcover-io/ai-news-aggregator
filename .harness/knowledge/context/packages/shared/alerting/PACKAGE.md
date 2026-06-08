---
governs: packages/shared/src/alerting/
last_verified_sha: 8f2bc3411177651bbd5e223a7aba4b77be130474
key_files: [index.ts, dispatcher.ts, fingerprint.ts, run-health.ts]
flow_fns: [dispatcher.ts::createAlertDispatcher.capture]
decisions: [D-115, D-116, D-118]
status: active
---

# alerting/ — incident capture dispatcher, fingerprinting, and run-health evaluator

## Purpose
The alerting subpackage is the cross-cutting incident-capture facade used by both `api` and `pipeline`. It provides:

1. `createAlertDispatcher` — the durable-first, never-throws capture orchestrator (D-116/NF1).
2. `fingerprintFor` — deterministic `category:domain:signature` fingerprint for dedup (D-115).
3. `evaluateRunHealth` — evaluates a completed run's collector outcomes and fires `capture` for any failures or degradations.
4. `AlertChannel` / `SlackAlertChannel` — interface + Slack implementation for delivery.

**Critical constraint (D-116):** this subpackage has **zero drizzle-orm imports**. `IncidentRepository` is a plain TypeScript interface; concrete implementations live in `api/repositories/incidents.ts` and `pipeline/repositories/incidents.ts`. Any drizzle import here would break the Vite browser bundle (same root-barrel issue as D-100).

## Public surface

- `createAlertDispatcher(deps: AlertDispatcherDeps)` → `AlertDispatcher` — durable-first capture facade (D-116/NF1). `deps`: `{ repo: IncidentRepository, channels: AlertChannel[], logger?, clock? }`
- `fingerprintFor(category, source, signature?)` → `string` — `category:domain:signature` (D-115); source normalised to `new URL(source).hostname`, signature defaults to `""`.
- `evaluateRunHealth(runId, collectorOutcomes, { alertDispatcher, logger })` → `Promise<void>` — called from `finalizeRun`; fires `capture` for failed/degraded collectors; errors are swallowed (D-116)
- `AlertChannel` interface — `{ enabled: boolean; send(incident: Incident): Promise<boolean> }`
- Re-exports from `types/incident.ts`: `IncidentSeverity`, `IncidentCategory`, `IncidentStatus`, `IncidentRepository`, `Incident`, `CaptureIncidentInput`, `UpsertResult`

## Depends on / used by
- Uses: `types/incident.ts`, `constants/index.ts` (INCIDENT_ALERT_COOLDOWN_MS), `logger.ts`; **NO drizzle-orm, NO postgres**
- Used by: `pipeline/src/services/finalize-run.ts` (evaluateRunHealth), `pipeline/src/workers/alert-delivery.ts` (AlertDispatcher), `api/src/app.ts` (AlertDispatcher wired at bootstrap), `web` (type imports via subpath only)

## Data flows

### createAlertDispatcher(deps).capture(input) → void
  input: CaptureIncidentInput { category, source, signature?, severity, title, message, runId?, context? }
    → repo.upsertByFingerprint(input, COOLDOWN_MS) → PostgreSQL incidents (ON CONFLICT fingerprint)
        (returns UpsertResult { id, shouldNotify, status, occurrences, deliveryAttempts })
        shouldNotify = (preUpdateNotifiedAt === null || now − preUpdateNotifiedAt >= COOLDOWN_MS) (D-118)
      ├─ severity === "info" → return  (REQ-012)
      ├─ status === "muted" → return  (REQ-022)
      ├─ !shouldNotify → return  (cooldown; REQ-010)
      ├─ no enabled channels → return  (REQ-019)
      └─ channel.send(incident)
          ├─ ok → repo.markDelivered(id, now) (advances notified_at)
          └─ fail → repo.incrementDeliveryAttempts(id)
    catch any error → logger.fatal + return  (NEVER throws; D-116/NF1)

## Gotchas / landmines
1. **Zero drizzle-orm imports.** Any accidental `import from "drizzle-orm"` or `@newsletter/shared/db` breaks the Vite browser bundle. The lint rule `newsletter/enforce-repository-access` does NOT enforce this; it is maintained by convention + code review. (D-116)
2. **`shouldNotify` is authoritative from the repo.** The dispatcher treats `UpsertResult.shouldNotify` as final — it never recomputes from the returned `notified_at`. The pre-update value in the repo is the correct gate (D-118).
3. **capture never throws.** Every call site may omit `await` if fire-and-forget is acceptable; the returned promise always resolves (never rejects). Do not change the try/catch to rethrow. (D-116/NF1)

## Decisions
- D-115: Fingerprint = category:domain:signature. Full body in root DECISIONS.md
- D-116: Interface injection + no drizzle-orm. Full body in root DECISIONS.md
- D-118: Pre-update notified_at for shouldNotify. Full body in root DECISIONS.md
