---
governs: packages/shared/src/utils/
last_verified_sha: ad0153a
key_files: [prompt-hash.ts, reading-time.ts, timezone-date.ts]
flow_fns: [timezone-date.ts::startOfDateInTimezone]
decisions: []
status: active
---

# utils/ — small utilities: prompt hashing, reading time, timezone date formatting

## Purpose
Small, self-contained utility functions: SHA-256 prompt fingerprinting for eval cache keys, reading-time estimation, and timezone-aware date formatting.

## Public surface
- hashPrompt(prompt) → string — SHA-256 first 16 hex chars
- readingTimeMinutes(stories) → number — word count / 200 WPM, floored to 1
- safeTimezone(tz) → string — validates tz, returns "UTC" on invalid
- formatDateInTimezone, formatDateTimeInTimezone, startOfDateInTimezone, endOfDateInTimezone

## Depends on / used by
Uses: node:crypto (prompt-hash.ts)
Used by: api (timezone formatting, reading time), pipeline (prompt hashing), web (reading time)
