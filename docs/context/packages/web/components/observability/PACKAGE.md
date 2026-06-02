---
governs: packages/web/src/components/observability/
last_verified_sha: 5a2ff20
key_files: [RunFunnel.tsx, StageTimingRail.tsx, CostStrip.tsx, DebugTimeline.tsx, FailuresList.tsx, SourceTelemetryTable.tsx, EnrichmentStrip.tsx, LiveStatusPill.tsx, SourceItemsPanel.tsx, LifecycleTrail.tsx, format.ts]
flow_fns: [RunFunnel.tsx::RunFunnel, DebugTimeline.tsx::DebugTimeline, SourceTelemetryTable.tsx::SourceTelemetryTable]
decisions: [D-015, D-016]
status: active
---

# components/observability/ — per-run telemetry dashboard

## Purpose

A set of display components that compose the run observability page (`/admin/runs/:runId`). Each component renders a section of the telemetry payload returned by `GET /api/admin/runs/:runId/observability`. The page supports both live (~2s poll) and historical (persisted `run_archives`) modes.

## Public surface

| Component | Effect |
|---|---|
| `RunFunnel({ funnel, topN })` | 4-row proportional bar chart: Collected → Deduped → Shortlisted → Ranked with drop annotations (e.g., "−12 duplicates removed (14.3%)") and hatched "pending" bar for null stages |
| `StageTimingRail({ stages })` | Per-stage timing: done/running/pending glyphs from stage `startedAt`/`completedAt` timestamps |
| `CostStrip({ cost, live })` | Running total USD + per-stage tokens/cost; graceful null when `cost` is null |
| `SourceTelemetryTable({ runId, sources })` | Per-source table: status badge (healthy/idle/failing), items/retries/duration, inline failed-error note; expandable per-source items drawer |
| `EnrichmentStrip({ enrichment })` | Link enrichment stats: attempted/ok/failed/skipped/avg-fetch-ms; all-zeros display when null |
| `FailuresList({ failures })` | Error-level log cards with context tags and truncate/expand for long messages |
| `DebugTimeline({ logs })` | All/Info/Warn/Error level filter; error rows in red style with expandable stack trace block; distinct empty states for "no logs" vs "no entries at this level" |
| `LiveStatusPill({ status, stage, live })` | Colored pill showing `status · stage` with `data-live` attribute and pulsing animation when live |
| `SourceItemsPanel({ runId, sourceKey, open, onClose })` | Dialog showing per-source raw items (lazy-loaded via `useRunSourceItems`) |
| `LifecycleTrail({ logs })` | Compact lifecycle event trail (simplified timeline variant) |
| `format.ts` | `formatDuration`, `formatCount`, `formatElapsed`, `formatClock` — formatting utilities |
| `SourceItemRow.tsx` / `SourceLogStrip.tsx` | Sub-components for source items and log strips |

## Depends on / used by

- **Uses:** `hooks/useRunSourceItems`, `@newsletter/shared/types` (RunObservability, RunFunnel, etc.)
- **Used by:** `pages/RunObservabilityPage.tsx`

## Data flows

```
RunFunnel({ funnel, topN }):
  funnel: { collected, deduped, shortlisted, ranked } (each number | null)
    → 4 rows: Collected / Deduped / Shortlisted / Ranked
       ├─ isPending (value === null) → hatched bar background + "— / topN" label
       ├─ max = funnel.collected, widthPct = value/max * 100 (min 4%, max 100%)
       ├─ dropAnnotation(from, to): from - to > 0 → "↓ −N duplicates removed (X.X%)" annotation
       └─ dropNouns: ["duplicates removed", "below shortlist cut", "not surfaced"]

DebugTimeline({ logs }):
  State: filter ∈ { all, info, warn, error }
    → Filter chip row → filteredLogs = logs.filter(matchesFilter)
       ├─ filteredLogs.length === 0
       │    ├─ logs.length === 0 → "No run logs recorded." (no-logs empty state)
       │    └─ logs.length > 0 → "No entries at this level." (filter empty state)         (D-015)
       └─ LogRow for each entry:
            ├─ isError → red background, red text, expandable stack trace toggle
            └─ !isError → normal grid: timestamp | level dot | event name | message

SourceTelemetryTable({ runId, sources }):
  sources: SourceTelemetryEntry[]
    → Table rows: Source Name | Status (glyph: healthy/idle/failing) | Items | Retries | Duration | Error
       └─ Row click → setExpanded(sourceKey) → SourceItemsPanel dialog (lazy-loaded items via useRunSourceItems)
            ├─ failed/cancelled AND itemCount===0 → row disabled (no items collected)     (D-016)
            └─ otherwise → clickable row
```

## Gotchas / landmines

- **Distinct empty states in DebugTimeline** (D-015): Two different messages: "No run logs recorded." (genuinely no logs at all) vs "No entries at this level." (logs exist but none match the current filter). A single empty state would confuse operators who filter to "Error" on a run that had no errors.
- **SourceTelemetryTable row disabled for failed/cancelled runs with no items** (D-016): When `itemCount === 0` and the run is failed/cancelled, the row is non-clickable. This prevents opening an empty items dialog for runs that never collected anything. The same guard exists in the dashboard's "Sources" button.

## Decisions

### D-015: DebugTimeline dual empty states

**Why:** "No logs at all" and "no logs matching this filter" are semantically different. The first means the run never emitted logs (legacy run, or logging failed). The second means logs exist but none match the current filter level — the operator should try a different filter.

**Tradeoff:** Slightly more complex component. The clarity gain for debugging is worth it.

**Governs:** `components/observability/DebugTimeline.tsx`

### D-016: Source telemetry row disabled for failed/cancelled + zero items

**Why:** Opening a source items dialog for a source that collected zero items shows an empty state message. It's better to prevent the click entirely.

**Tradeoff:** The operator can't confirm that zero items were collected (they have to trust the 0 in the Items column). Acceptable — the per-source error message in the row provides the failure reason.

**Governs:** `components/observability/SourceTelemetryTable.tsx`
