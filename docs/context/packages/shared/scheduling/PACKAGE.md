---
governs: packages/shared/src/scheduling/
last_verified_sha: 5a2ff20
key_files: [tz.ts, published-at.ts, immediate-publish.ts, job-ids.ts]
flow_fns: [tz.ts::dateAtTzTime, tz.ts::publishDateForWindow, published-at.ts::resolveScheduledPublishAt, immediate-publish.ts::selectImmediatePublishChannels]
decisions: []
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
- jobIdFor(channel, runId) → string — "{channel}:{runId}"
- HEALTH_CHECK_SCHEDULER_KEY → string — "health-check" constant for BullMQ job scheduler name
- DAILY_RUN_SCHEDULER_KEY → string — "daily-run" constant for BullMQ job scheduler name
- SOCIAL_HEALTH_SCHEDULER_KEY → string — "social-health" constant for BullMQ job scheduler name

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

## Gotchas / landmines
1. publishDateForWindow throws on publishTime === pipelineTime (ambiguous moment). Callers catch and gracefully degrade.
2. dateFromTzParts uses iterative convergence for DST transitions.
