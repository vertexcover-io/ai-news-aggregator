# Calendar Report Redesign Verification

## Verdict

PASSED for the redesigned calendar report modal and shared drawer report renderer.

## Evidence

| Check | Evidence | Verdict |
|---|---|---|
| Desktop modal uses the intended wide layout | Playwright bounding box for `[data-testid="calendar-report-dialog"]`: `x=16`, `y=45`, `width=1248`, `height=810` at a `1280x900` viewport. Screenshot: `verification/screenshots/calendar-report-desktop.png`. | PASSED |
| Ranking titles wrap instead of truncating | Playwright inspected `calendar-report-title-draft-1`: class name was `break-words text-[15px] font-semibold leading-snug text-neutral-950`; no `truncate` class. Rect: `x=713.5`, `y=343.5`, `width=489.5`, `height=41.25`. | PASSED |
| Report body scrolls inside the modal instead of overflowing the dialog shell | Playwright inspected `calendar-report-layout`: `scrollHeight=704`, `clientHeight=665`, computed `overflowY=auto`. | PASSED |
| Mobile reflows ranking columns vertically | At `390x844`, previous and draft ranking cards both had `x=45`, `width=285`, with the draft card below the previous card (`top=973.82` after previous `top=487.70`). Screenshot: `verification/screenshots/calendar-report-mobile.png`. | PASSED |

## Commands

```bash
pnpm --filter @newsletter/web exec vitest run --project unit tests/unit/EvalIndexPage.test.tsx tests/unit/RunDetailDrawer.test.tsx
pnpm --filter @newsletter/web typecheck
pnpm --filter @newsletter/web lint
```

## Noted Warnings

`pnpm --filter @newsletter/web lint` exited with code 0 and reported 15 existing warnings in unrelated files for React Fast Refresh / hook dependency rules.
