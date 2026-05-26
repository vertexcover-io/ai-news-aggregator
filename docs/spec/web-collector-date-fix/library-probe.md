# Library Probe — web-collector-date-fix

> **Run at:** 2026-05-26 12:25
> **Verdict:** PASS

## Summary
| Library | Health | Smoke | Final |
|---|---|---|---|
| chrono-node@2.9.1 | trusted (0/5 thresholds) | VERIFIED (4/4 use cases) | SELECTED |

## Selected
- **chrono-node@2.9.1** for relative + natural-language date resolution.
  Evidence: `.harness/web-collector-date-fix/probes/chrono-node/probe.log`

## Health detail
- License MIT, **zero runtime dependencies**, ships own TS types.
- GitHub `wanasit/chrono`: not archived/disabled, last push 2026-05-06, 5246 stars,
  133 open issues.
- npm weekly downloads: **3,194,633** (≫ 1000 threshold).
- Latest version published 2026-05-06 (this month).

## Smoke test (use cases from design doc)
Reference instant `2026-05-26T12:00:00.000Z`:
1. **Relative past** — `4 hours ago` → `08:00`, `2 days ago` → `05-24`,
   `3 weeks ago` → `05-05`, `yesterday` → `05-25`. ✓
2. **Natural absolute** — `May 25, 2026` / `25 May 2026` → `2026-05-25`. ✓
3. **ISO passthrough** — `2026-05-25T09:00:00.000Z` → exact same instant. ✓
4. **Garbage / empty** — `null`, no throw. ✓

## Notes for planning / spec
- chrono returns local-timezone-anchored times for **date-only** inputs (no time of
  day in the string). For publish dates this is acceptable (the calendar date is the
  signal). `resolvePublishedDate` must pass an explicit `referenceDate` so relative
  resolution is deterministic and tied to collection time.
- The **structured-signal** fix (JSON-LD / meta / `<time>`) uses the already-present
  `jsdom` — no new dependency and not gated on chrono. chrono only handles the
  residual relative / natural-language LLM-string fallback.

## Pivot Log
None — primary library verified on first probe.

## Setup Needed
None — chrono-node requires no credentials.

<!-- LP:VERDICT:PASS -->
