# Phase 6: Frontend date-range chip (react-day-picker)

> **Status:** pending

## Overview

Add the `DateRangeChip` next to the `SearchBar`. Clicking the chip opens a popover with a 2-month `react-day-picker` v9 in `mode="range"`, preset chips (Last 7/30/90 days, This year, All time), Clear and Apply buttons. Apply writes `from`/`to` to the URL; Clear removes them. Chip label updates to reflect the current range.

## Implementation

**Files:**
- Modify: `packages/web/package.json` — add `react-day-picker@9.x` as a dependency (exact version, per project's "no `^`/`~`" rule). Reuses existing `date-fns@4`.
- Create: `packages/web/src/components/archive-listing/DateRangeChip.tsx`
- Create: `packages/web/src/components/archive-listing/DateRangePopover.tsx`
- Create: `packages/web/src/lib/dateRange.ts` — pure helpers: `formatRangeLabel`, `presetRange(name)`, `parseRangeFromParams`, `serializeRangeToParams`
- Modify: `packages/web/src/pages/ArchiveListingPage.tsx` — render `<DateRangeChip/>` next to `<SearchBar/>` (Phase 5 wiring)
- Modify: `packages/web/src/index.css` — import `react-day-picker/style.css` once, then append a small Tailwind/CSS layer to map rdp's classes to the Ledger palette (rust accent, warm yellow in-range, mono day labels)
- Test: `packages/web/tests/unit/lib/dateRange.test.ts`
- Test: `packages/web/tests/unit/components/archive-listing/DateRangeChip.test.tsx`
- Test: `packages/web/tests/unit/components/archive-listing/DateRangePopover.test.tsx`

**Library:** `react-day-picker` v9.14.0 (verified via library-probe, see `docs/spec/add-archive-keyword-search/probes/react-day-picker/`).

**Install command:** `pnpm --filter @newsletter/web add react-day-picker@9.14.0`

**What to test:**
- `formatRangeLabel(from, to)` returns `"APR 8 – MAY 6, 2026"` (matches mock).
- `formatRangeLabel(undefined, undefined)` returns `"ALL TIME"`.
- `presetRange("last-30-days")` returns `{ from: today-30, to: today }`.
- DateRangeChip closed: shows current label, no popover in DOM.
- Chip click: popover opens.
- Popover renders 2 month grids (`getAllByRole('grid').length === 2`).
- Preset click → calendar reflects new range (selected dates).
- Apply: popover closes, URL params updated.
- Clear: popover closes, URL params removed.
- Custom range: click two days → both highlight as edges.

**Traces to:** REQ-016, 017, 018, 019, EDGE-014, 015.

**Component sketch:**

```tsx
// DateRangeChip.tsx
export function DateRangeChip({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const label = formatRangeLabel(value?.from, value?.to);
  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)} className="...chip styles...">
        <span>DATE:</span>
        <span className="value">{label}</span>
        <span className="caret">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <DateRangePopover
          value={value}
          onApply={(r) => { onChange(r); setOpen(false); }}
          onClear={() => { onChange(undefined); setOpen(false); }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

// DateRangePopover.tsx (excerpt — wires DayPicker)
import { DayPicker, type DateRange } from 'react-day-picker';
import 'react-day-picker/style.css'; // safe — Vite handles CSS

export function DateRangePopover({ value, onApply, onClear, onClose }: Props) {
  const [range, setRange] = useState<DateRange | undefined>(value);
  return (
    <div ref={useClickOutside(onClose)} className="...popover styles...">
      <div className="range-head">
        <span>SELECT RANGE</span>
        <span className="selected">{range?.from && range?.to ? formatRangeLabel(range.from, range.to) : '—'}</span>
      </div>
      <DayPicker
        mode="range"
        numberOfMonths={2}
        defaultMonth={range?.from ?? new Date()}
        selected={range}
        onSelect={setRange}
        classNames={LEDGER_CLASSNAMES /* maps rdp's class slots to Tailwind classes */}
      />
      <div className="range-presets">
        {PRESETS.map(p => (
          <button key={p.id} onClick={() => setRange(presetRange(p.id))}>{p.label}</button>
        ))}
      </div>
      <div className="range-actions">
        <button onClick={onClear} className="clear">Clear</button>
        <button onClick={() => onApply(range)} className="apply" disabled={!range?.from || !range?.to}>Apply</button>
      </div>
    </div>
  );
}
```

**Styling note:** `react-day-picker` v9 ships its own minimal CSS at `react-day-picker/style.css` and exposes class slot names via `classNames` prop. The Ledger overrides are CSS-only (rust edges, warm yellow in-range, hairline borders) and live in `index.css` under `@layer components`. No runtime CSS-in-JS.

**Done when:**
- [ ] All unit tests green
- [ ] `pnpm --filter @newsletter/web build` succeeds (bundle includes rdp)
- [ ] Manual sanity: chip opens, range select works, Apply updates URL, refresh restores chip label
- [ ] `pnpm test:unit` clean
- [ ] No new lint warnings beyond baseline

**Commit:** `feat(VER-XX): add date-range chip with react-day-picker on archive listing`
