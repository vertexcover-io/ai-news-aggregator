---
governs: packages/shared/src/scheduling/
last_verified_sha: ad0153a
key_files: [tz.ts, published-at.ts, immediate-publish.ts, job-ids.ts]
flow_fns: [tz.ts::dateAtTzTime, tz.ts::publishDateForWindow, published-at.ts::resolveScheduledPublishAt, immediate-publish.ts::selectImmediatePublishChannels]
decisions: [D-108, D-112]
status: active
---

# scheduling/ — timezone-aware publish scheduling and immediate-publish logic

## Purpose
Pure functions for resolving publish dates from user-configured HH:MM times in named IANA timezones, selecting past-due channels for immediate publish after late review saves, and generating stable BullMQ job IDs.

## Public surface
- dateAtTzTime(tz, hhmm, now?) → Date — wall-clock HH:MM → next occurrence in timezone
- publishDateForWindow(input) → Date — resolves next publish moment; throws if publishTime === pipelineTime
- resolveScheduledPublishAt(input) → Date | null — computes scheduled publish datetime; returns null on missing/malformed settings
- selectImmediatePublishChannels(input) → PublishChannel[] — returns past-due channels (now > scheduled moment)
- jobIdFor(channel, runId) → string — "{channel}-{runId}" (dash, NOT colon — see Gotchas)

## Depends on / used by
Uses: Intl.DateTimeFormat (pure TypeScript, no dependencies)
Used by: api (immediate-publish on late review save), pipeline (publish date resolution, job IDs)

## Data flows
dateAtTzTime(tz, hhmm, now?) → Date:
  hhmm → parseHHMM → validate HH:MM regex
  now → formatterFor(tz) → partsInTimezone → current date parts
  → dateFromTzParts(tz, { ...currentParts, hour, minute })
     → iterative convergence (max 4 iterations) to handle DST transitions

resolveScheduledPublishAt(input) → Date | null:
  missing settings → null
  try publishDateForWindow({ timezone, pipelineTime, publishTime: emailTime, completedAt })
    ├─ success → return Date
    └─ throws → return null (never throws)

selectImmediatePublishChannels(input) → PublishChannel[]:
  !scheduleEnabled → []
  for each channel (email, linkedin, twitter):
    ├─ !enabled → skip
    ├─ bad time or channelTime === pipelineTime → skip
    └─ now > scheduledMoment → push channel

publishDateForWindow(input) → Date:
  publishMinutes === pipelineMinutes → throw
  completedParts = partsInTimezone(formatter, completedAt)   # day anchored on completion instant
  sameDay = dateFromTzParts(tz, { ...completedParts, hour, minute })
  ├─ sameDay >= completedAt → return sameDay   (D-108: first publishTime at-or-after completion)
  └─ else → return sameDay + 1 local day

## Gotchas / landmines
1. publishDateForWindow throws on publishTime === pipelineTime (ambiguous moment). Callers catch and gracefully degrade.
2. dateFromTzParts uses iterative convergence for DST transitions.
3. **publishDateForWindow anchors the publish DAY on the run-completion instant, not on a publishTime-vs-pipelineTime comparison.** The old heuristic (`publishMinutes < pipelineMinutes ? +1 day`) double-counted the midnight rollover when a late-night run (e.g. pipelineTime 23:59) crossed midnight before finishing — `completedParts` had already rolled to the next calendar day — and scheduled the digest a full day late. Now it picks the first occurrence of publishTime at-or-after `completedAt`. (D-108)
4. **jobIdFor uses a `-` delimiter, NOT `:`.** bullmq ≥5.x `validateOptions` rejects custom job ids containing `:` (the Redis key delimiter). The scheduler KEY constants (`*_SCHEDULER_KEY`) still contain `:` — they are exempt because BullMQ generates their job ids internally as `repeat:<key>:<ts>`; only the custom `jobIdFor` ids passed to `Queue.add` are constrained. (D-112)

## Decisions
### D-108 — publishDateForWindow anchors the publish day on the completion instant
**Why:** Deriving the publish day from a `publishTime < pipelineTime` comparison double-counts the midnight rollover for a late-night run that crosses midnight before finishing (completedParts already on the next day), scheduling the digest a day late. Anchoring on the completion instant and picking the first `publishTime` occurrence at-or-after `completedAt` is rollover-safe.
**Tradeoff:** Computes one `dateFromTzParts` for the same-day candidate before deciding +1 day; marginally more work than the old arithmetic comparison, but correct across DST/midnight.
**Governs:** packages/shared/src/scheduling/tz.ts (`publishDateForWindow`)

D-112 (job-id dash delimiter) is cross-package — full body in root DECISIONS.md.
