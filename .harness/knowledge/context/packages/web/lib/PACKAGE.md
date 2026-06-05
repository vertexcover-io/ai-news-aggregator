---
governs: packages/web/src/lib/
last_verified_sha: 5a2ff20
key_files: [analytics.ts, dateRange.ts, formatTimestamp.ts, highlightTerms.tsx, meta.ts, readingTime.ts, shareLinks.ts, sourceDisplay.ts, subscriptionStorage.ts, utils.ts, dateSelectorTimezone.ts]
flow_fns: [analytics.ts::initBrowserAnalytics]
decisions: [D-024]
status: active
---

# lib/ — pure utility functions

## Purpose

Stateless utility functions for formatting, analytics initialization, date math, share link construction, and type-safe class merging. No React hooks, no side effects (except `analytics.ts` which initializes PostHog and `subscriptionStorage.ts` which writes to localStorage).

## Public surface

| Export | Effect |
|---|---|
| `cn(...inputs: ClassValue[])` → `string` | Merges Tailwind classes with conflict resolution via `clsx` + `tailwind-merge` |
| `initBrowserAnalytics()` → `Promise<boolean>` | Fetches config from API, initializes PostHog if enabled. Returns `true` if initialized. |
| `captureBrowserEvent(event, properties?)` | Captures a PostHog event if analytics is initialized. No-op if not. |
| `resetBrowserAnalyticsForTest()` | Resets analytics state (test-only). |
| `formatTimestamp(iso: string \| null)` → `string` | Formats ISO timestamp as `YYYY-MM-DD HH:MM:SS` or `"—"` for null |
| `formatRangeLabel(from, to)` → `string` | Formats date range for display: "ALL TIME", "JAN 15, 2026", "JAN 1 – JAN 15, 2026" |
| `presetRange(name: PresetName)` → `DateRangeValue \| undefined` | Computes date range for preset names (last-7-days, etc.) |
| `parseRangeFromParams({ from?, to? })` → `DateRangeValue` | Parses `YYYY-MM-DD` strings from URL params |
| `serializeRangeToParams(range)` → `{ from?, to? }` | Serializes date range to URL param format |
| `highlightTerms(text, terms[])` → `ReactNode[]` | Splits text by search terms, wraps matches in `<mark>` with `archive-search-mark` class |
| `setMeta(key, content)` | Sets `<meta>` tag in document head (creates if missing, updates if exists). Uses `property=` for `og:*`, `name=` otherwise. |
| `readingTimeMinutes(items: readonly RankedItem[])` → `number` | Wraps `@newsletter/shared/utils/reading-time` |
| `truncateForX(text, reservedForUrl: 24)` → `string` | Truncates text to fit 280-char tweet limit |
| `buildLinkedInShareUrl(archiveUrl)` → `string` | Builds LinkedIn share URL |
| `buildXShareUrl(archiveUrl, shareText)` → `string` | Builds X/Twitter share URL with truncated text |
| `SOURCE_LABELS`, `SOURCE_BADGE_CLASSES`, `SOURCE_ORDER` | SourceType → display label / Tailwind badge classes / canonical ordering |
| `markSubscribed()` | Writes `"1"` to localStorage `newsletter_subscribed` key, dispatches `newsletter-subscription-change` event |
| `readSubscribed()` → `boolean` | Reads localStorage `newsletter_subscribed` flag |
| `configuredTimezone(tz)` → `string` | Wraps `safeTimezone` from shared |
| `todayInTimezone(tz)` → `string` | Formats today as `YYYY-MM-DD` in given timezone |
| `addDaysToIsoDate(dateISO, days)` → `string` | Adds days to `YYYY-MM-DD` date string |
| `formatDateTimeForTimezone(value, tz)` → `string` | Formats datetime in configured timezone or returns `"—"` for null |

## Depends on / used by

- **Uses:** `@newsletter/shared/utils/reading-time`, `@newsletter/shared/utils/timezone-date`, `date-fns`, `posthog-js`, `api/analyticsConfig`
- **Used by:** components/, pages/, hooks/

## Data flows

```
initBrowserAnalytics() → boolean:
  fetchAnalyticsConfig() → { posthogEnabled, posthogProjectToken, posthogHost }
    ├─ !posthogEnabled || !posthogProjectToken || !posthogHost → return false
    ├─ initialized && initKey === nextKey → return true (no re-init)              (D-024)
    └─ posthog.init(projectToken, { api_host, autocapture: true, disable_session_recording: true, mask_all_element_attributes: true, property_denylist: ["email", "password"] })
       → initialized = true → return true
```

## Gotchas / landmines

- **PostHog re-init guard** (D-024): `initBrowserAnalytics` checks if already initialized with the same config before calling `posthog.init` again. This prevents duplicate initialization which would create multiple PostHog instances.
- **highlightTerms regex**: Builds a regex from escaped terms. If all terms are empty after trimming, returns the original text as a single-element array. The regex alternation `(term1|term2|...)` is case-insensitive (`gi`).
- **setMeta creates tags**: If a `<meta>` tag doesn't exist for a given key, `setMeta` creates one. This means repeated calls with different `og:*` tags accumulate elements. The archive page sets both `og:title` and `description`.

## Decisions

### D-024: PostHog init dedup by config key

**Why:** `initBrowserAnalytics` is called from `AnalyticsProvider` in `main.tsx` via `useEffect`. In React 19 Strict Mode, effects double-fire. Re-initializing PostHog would create duplicate instances and send duplicate events.

**Tradeoff:** If the config changes between renders (e.g., token rotated), the second call re-initializes. The `initKey` comparison catches unchanged config and returns early.

**Governs:** `lib/analytics.ts`
