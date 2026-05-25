# Verification Stubs

These scenarios are folded into the spec's Verification Scenarios and re-run by functional-verify.

## VS-1 — Card removed
The rendered block contains **no** `§` cover-plate element (`role="img"` cover plate gone).

## VS-2 — Whole block is one link
The eyebrow, headline, and dek are all inside a single anchor whose href is `/archive/<runId>`.
Clicking anywhere on the block (headline text, dek text, a story title) navigates to the issue.

## VS-3 — Running order with source tags
When `topItems` is non-empty, each top item renders as a numbered row with its title and a
source label derived from `sourceType` (e.g. `hn → Hacker News`, `twitter → X`).

## VS-4 — Read affordance reflects remaining count
When `storyCount > shownCount`, the read line shows `+ N more inside →` where N =
`storyCount - shownCount`. When `storyCount <= shownCount`, it shows `Read today's issue →`.

## VS-5 — Graceful degradation
- `topItems = []` → no running-order list renders; block still shows eyebrow + headline + read line.
- `digestSummary = null` → no dek renders.
- `digestHeadline = null` → headline falls back to `topItems[0].title`, else `"Today's issue"`.

## VS-6 — Mobile friendly (explicit user requirement)
At a 390px viewport: the headline does not overflow; running-order titles are not crushed into a
one-word-per-line column (source tag stacks beneath the title at `<sm`); the whole block remains a
single tappable link. Captured as a Playwright screenshot.

## VS-7 — Theme preserved
Colors remain the Ledger tokens (`#fafaf7` / `#14110d` / `#8c3a1e` / `#6b6557` / `#e7e2d6`);
typography remains Newsreader serif + Geist Mono.
