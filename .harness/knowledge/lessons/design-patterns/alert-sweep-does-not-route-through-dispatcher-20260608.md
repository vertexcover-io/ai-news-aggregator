---
title: "Alert delivery sweep calls markDelivered directly — never routes through dispatcher.capture"
date: 2026-06-08
category: design-patterns
tags: [alerting, incident, dispatcher, sweep, bullmq, durable-delivery]
component: pipeline/workers/alert-delivery
severity: high
status: implemented
applies_to: ["packages/pipeline/src/workers/alert-delivery.ts", "packages/shared/src/alerting/**/*.ts"]
stage: [code, review]
evidence_count: 1
last_validated: 2026-06-08
source: hard-won-success@centralized-observability
related: [".harness/knowledge/context/packages/pipeline/workers/PACKAGE.md", ".harness/knowledge/context/DECISIONS.md"]
---

# Alert delivery sweep calls `markDelivered` directly — never routes through `dispatcher.capture`

## Problem

The alert-delivery sweep (`runAlertDeliverySweep`) retries incidents that were captured but not yet delivered to Slack. An early draft routed retries through `dispatcher.capture(input)`, which calls `repo.upsertByFingerprint` before attempting delivery. This produced a subtle bug: `upsertByFingerprint` returned the canonical DB id for the fingerprint, which could differ from the `incident.id` stored in the sweep's `listUndelivered()` result if the row had been touched between reads. `markDelivered` was then called with the wrong id.

## Insight

**`dispatcher.capture` is for NEW incidents, not retries.** The two paths have fundamentally different responsibilities:

| Path | Owns | Does NOT own |
|------|------|--------------|
| `dispatcher.capture(input)` | upsert → dedup → cooldown → notify | retry logic for existing rows |
| `runAlertDeliverySweep(deps)` | retry undelivered rows | upsert, cooldown check |

The sweep already has the fully-hydrated `Incident` from `listUndelivered()`. It just needs to attempt delivery and record the outcome. Re-entering through `capture` means re-running dedup, cooldown, and upsert — all of which are wrong for a retry.

**The concrete rule:** the sweep calls `channel.send(incident)` using the `incident.id` from `listUndelivered()`, then calls `markDelivered(incident.id, now)` or `incrementDeliveryAttempts(incident.id)` — directly, not via the dispatcher.

## Solution

```ts
// file: packages/pipeline/src/workers/alert-delivery.ts

// WRONG — re-routes through capture, upserts again, may produce wrong id:
await alertDispatcher.capture({
  category: incident.category,
  source: incident.source ?? undefined,
  severity: incident.severity,
  title: incident.title,
  message: incident.message ?? undefined,
});

// CORRECT — uses the row id from listUndelivered directly:
const ok = await channel.send(incident);
if (ok) {
  await incidentsRepo.markDelivered(incident.id, new Date());
} else {
  await incidentsRepo.incrementDeliveryAttempts(incident.id);
}
```

## Prevention / Reuse

- **The rule:** `dispatcher.capture` = new incident ingestion. Sweep = retry existing rows. Never mix them.
- **Any code that calls `listUndelivered()` and then routes through `capture` is wrong** — it re-upserts instead of retrying.
- **The sweep must use `Promise.allSettled`** so one failed delivery doesn't abort the rest of the batch.
- **The sweep must never throw** — wrap the whole loop in try/catch. A sweep failure that crashes the worker means no retries until the next sweep cycle.

## Related

- `D-117` in root DECISIONS.md — alert-delivery queue design rationale
- `D-116` — dispatcher is never-throws/NF1; sweep inherits the same contract
