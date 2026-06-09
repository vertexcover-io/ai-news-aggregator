# PostHog Dashboard — Engagement Source Tracking

The dashboard lives in PostHog's own UI (no in-app code). Create it once; it then
auto-populates as tagged links drive traffic. No new capture code is needed — `posthog-js`
already auto-captures `utm_*` on every `$pageview` (verified by the VS-0 probe).

## Insight 1 — Archive traffic by channel (the core view)

- **Type:** Trends
- **Event:** `$pageview`
- **Filter:** `$pathname` ∋ `/archive` (optional — narrows to digest landings; drop it to include the home page)
- **Breakdown by:** event property `utm_source`
- **Result buckets:** `linkedin`, `twitter`, `email`, and `(none)` = **direct**
- **Suggested:** display as a bar chart, date range "Last 30 days", interval daily/weekly.

## Insight 2 — Per-digest performance (free, no extra tagging)

- **Type:** Trends
- **Event:** `$pageview`
- **Breakdown by:** `$pathname`  (each `/archive/<uuid>` is one digest issue)
- Optionally add a secondary `utm_source` breakdown or filter to compare channels within a digest.

> Per-digest attribution needs **no** `utm_campaign` — the run UUID is already in the path,
> so `$pathname` distinguishes issues for free. That's why campaign tagging was dropped.

## What the links look like (what feeds these insights)

```
LinkedIn: https://newsletter.vertexcover.io/archive/<uuid>?utm_source=linkedin
X:        https://newsletter.vertexcover.io/archive/<uuid>?utm_source=twitter
Email:    https://newsletter.vertexcover.io/archive/<uuid>?utm_source=email   (ribbon CTA + "Browse every issue" home CTA)
Direct:   https://newsletter.vertexcover.io/archive/<uuid>                     (no utm → (none))
```

## Prerequisite (already wired)

Production capture requires `POSTHOG_ENABLED=true` + `POSTHOG_PROJECT_TOKEN` (served via
`/api/public/analytics-config`, DB-first then env). These are existing settings — out of
scope for this change.
