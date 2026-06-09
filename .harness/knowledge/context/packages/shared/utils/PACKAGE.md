---
governs: packages/shared/src/utils/
last_verified_sha: f7d27361d5e1390adf9561d55d413e75457b584c
key_files: [prompt-hash.ts, reading-time.ts, timezone-date.ts, utm.ts]
flow_fns: [timezone-date.ts::startOfDateInTimezone]
decisions: [D-121]
status: active
---

# utils/ — small utilities: prompt hashing, reading time, timezone date formatting, UTM tagging

## Purpose
Small, self-contained utility functions: SHA-256 prompt fingerprinting for eval cache keys, reading-time estimation, timezone-aware date formatting, and UTM source tagging for archive links.

## Public surface
- hashPrompt(prompt) → string — SHA-256 first 16 hex chars
- readingTimeMinutes(stories) → number — word count / 200 WPM, floored to 1
- safeTimezone(tz) → string — validates tz, returns "UTC" on invalid
- formatDateInTimezone, formatDateTimeInTimezone, startOfDateInTimezone, endOfDateInTimezone
- withUtmSource(url, source: UtmSource) → string — appends/overwrites `utm_source` on an absolute URL using the URL API (no string concat); pure, never throws
- UtmSource — `"email" | "linkedin" | "twitter"` — fixed typed set for all channel values

## Depends on / used by
Uses: node:crypto (prompt-hash.ts)
Used by: api (timezone formatting, reading time), pipeline (prompt hashing, web reading time), pipeline notifiers (email-render.ts, linkedin/notifier.ts, twitter/notifier.ts — all call withUtmSource)

## Decisions
- **D-121**: Single shared `withUtmSource` helper for all notifiers. Why: three notifiers each build an archive URL with per-channel attribution. A shared helper (using `URL.searchParams.set`) is the single source of truth — prevents per-notifier string-concat drift and ensures correct handling of trailing slashes, existing params, and encoding. Pure, synchronous, side-effect-free — it cannot fail a publish job. Tradeoff: all three channels must import from shared/utils (minor cross-package dep already present). Governs: `packages/shared/src/utils/utm.ts`, `packages/pipeline/src/lib/email-render.ts`, `packages/pipeline/src/social/linkedin/notifier.ts`, `packages/pipeline/src/social/twitter/notifier.ts`.
