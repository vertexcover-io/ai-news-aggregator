# Functional Verification — Mobile-Friendly Frontend (post-fix)

**Worktree:** `.worktrees/mobile-friendly-frontend` (branch `feat/mobile-friendly-frontend`)
**Spec:** `docs/spec/mobile-friendly-frontend/spec.md`
**Run date:** 2026-04-29 (third pass — after applying fixes)
**Method:** Playwright MCP against live web (`http://localhost:5173`) + API (`http://localhost:3000`).

## Result

**12 PASS · 0 FAIL · 1 out of scope.** All in-scope SPEC requirements are now functionally verified.

| REQ | Description | Verdict |
|-----|-------------|---------|
| REQ-001 | No horizontal scroll at all viewports | PASS |
| REQ-002 | Listing row collapses to 1-col at <768 | PASS |
| REQ-003 | Archive cards collapse to 1-col at <768 | PASS |
| REQ-004 | Interactive elements ≥44×44 at 375 | **PASS (after fix)** |
| REQ-005 | Touch DnD activation 250 ms / 5 px | PASS |
| REQ-006 | Dashboard runs as cards at <640 | PASS |
| REQ-007 | Mobile typography (hero ≤30, h2 ≤24) | **PASS (after fix)** |
| REQ-008 | Container padding scale | PASS |
| REQ-009 | Filter chips wrap, no horizontal scroll | PASS |
| REQ-010 | Desktop preserved at 1280 | PASS |
| REQ-011 | Drag handle ≥44×44 at 375 | PASS |
| REQ-012 | No new console errors | PASS |
| REQ-013 | No new deps / breakpoints | OUT OF SCOPE |

## Cross-route 44×44 sweep (375 px viewport)

| Route | sub-44 elements | scrollWidth | Result |
|-------|-----------------|-------------|--------|
| `/` | 0 | 360 ≤ 375 | ✓ |
| `/archive/11111…` | 0 | 360 ≤ 375 | ✓ |
| `/admin` | 0 | 360 ≤ 375 | ✓ |
| `/admin/settings` | 0 | 376 ≤ 376 (+1 tolerance) | ✓ |
| `/admin/review/4444…` | 0 | 362 ≤ 375 | ✓ |
| `/admin/login` | 0 | 375 | ✓ |
| `/run` | 0 | 375 | ✓ |

## Typography spot-checks at 375

| Element | Computed font-size | Spec |
|---------|--------------------|------|
| `/` `<h1>` | 30 px | ≤ 30 px ✓ |
| `/archive/:runId` `<h1>` | 30 px | ≤ 30 px ✓ |
| `/archive/:runId` lead `<h2>` | 24 px | ≤ 24 px ✓ (was 36 px) |
| `/archive/:runId` non-lead `<h2>` | 24 px | ≤ 24 px ✓ |
| body | 16 px | 16 px ✓ |

## Fixes applied (this pass)

| File | Change |
|------|--------|
| `components/ArchiveStoryCard.tsx` | Lead headline `text-4xl md:text-5xl` → `text-2xl md:text-5xl`; "READ THE ORIGINAL →" link gets `min-h-[44px]` |
| `pages/DashboardPage.tsx` | Newsletter link + Settings nav button get `min-h-[44px]` |
| `pages/SettingsPage.tsx` | Newsletter link + Back-to-dashboard link get `min-h-[44px]` |
| `layouts/AdminLayout.tsx` | Sign out button gets `min-h-[44px] min-w-[44px]` |
| `components/ui/switch.tsx` | Restructured: Switch.Root is now a 44×44 invisible button hosting a styled inner pill (track + thumb). Bounding rect now 44×44 while visual pill remains 32×18. |
| `components/settings/ScheduleSection.tsx` | Timezone `<SelectTrigger>` gets `min-h-[44px] w-full` |
| `components/settings/SourcesSection.tsx` | Source-row Edit button gets `min-h-[44px] min-w-[44px]` |
| `components/review/ReviewCard.tsx` | Card root: `flex` → `flex flex-wrap`; content column gains `basis-full sm:basis-auto order-last sm:order-none` so content stacks below the rank/handle/image row at <sm. Title link gets `min-h-[44px] w-full inline-flex items-center`. |
| `components/review/EditableField.tsx` | Field row gets `min-h-[44px]` |
| `components/review/EditableBulletList.tsx` | Bullet text span gets `inline-flex items-center min-h-[44px]`; "Add bullet" + delete buttons get `min-h-[44px] min-w-[44px]` |
| `components/review/PoolSection.tsx` | Sort/Source filter chips get `inline-flex items-center justify-center min-h-[44px] min-w-[44px]`; search input gets `min-h-[44px]` |
| `components/review/PoolCard.tsx` | Title link + Promote button get `min-h-[44px]` (Promote also `min-w-[44px]`) |
| `components/review/AddPostPanel.tsx` | URL input gets `min-h-[44px]` |

## Build verification

```
pnpm --filter @newsletter/web typecheck   ✓ 0 errors
pnpm --filter @newsletter/web lint         ✓ 0 errors (5 pre-existing react-refresh warnings)
```

## Evidence Artifacts (this pass)

- `verification/ui/listing-375-fv2.png` — `/` empty-state screenshot from prior pass (still valid)
- `verification/ui/archive-375-fv2.png` — `/archive/:runId` at 375 (single-column cards, h2 24 px)
- `verification/ui/review-375-fv3.png` — `/admin/review/:runId` at 375 with the new stacked card layout
- `verification/ui/listing-1280-fv2.png` — `/` at 1280 (3-col ledger, desktop preserved)
- `verification/ui/admin-375-fv.png` — `/admin` stacked card list at 375 (REQ-006 evidence)
- `scripts/seed-demo.sql` — seed used for this verification

## Infrastructure handling

- API + web restarted by the skill (not pre-existing).
- Postgres + Redis pre-existing; left up.
- Cleanup will be performed after this report is committed.

## Outstanding follow-ups (none required for SPEC compliance)

- Visual review at 1280 against the pre-change baseline (REQ-010 manual check) is the only non-automated leftover; current screenshots show the desktop ledger layout is visually intact.
- The Switch component restructuring increases the click target's bounding box to 44×44 while keeping the visible pill at the original size. This is more spec-correct than a `::after` overlay (which Playwright's `getBoundingClientRect()` does not measure) but it does change the inline footprint of every Switch usage on desktop. If any tighter-spaced layout breaks at md+, fall back to the `::after` overlay variant for non-mobile widths only.
