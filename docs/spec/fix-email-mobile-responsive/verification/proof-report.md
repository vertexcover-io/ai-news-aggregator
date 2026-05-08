# Functional verification — newsletter email mobile responsiveness

**Feature:** Fix two mobile-rendering bugs in the daily digest email template
(`packages/pipeline/src/lib/email-render.ts`):

1. **Hero headline too big** — long titles (e.g. "Multi-Token Prediction (MTP) for LLaMA.cpp — Gemma 4 speedup by 40%") wrapped to 7+ lines on phones at 38px.
2. **Archive ribbon broken on mobile** — the two-column layout's right cell used `width:1%` + `whiteSpace:nowrap`, which Gmail/Apple Mail interpreted by squeezing the *left* column to single-word lines (5 lines for an 8-word dek).

**Worktree:** `fix-email-mobile-responsive`
**Branch:** `worktree-fix-email-mobile-responsive`
**Date:** 2026-05-08

## Summary

| Scenario | Type | Description | Verdict |
|---|---|---|---|
| VS-1 | unit | Hero font-size now 26-32px (was 38px); has `class="hero-h1"` | PASS |
| VS-2 | unit | Rendered HTML contains a `<style>` block with mobile media query | PASS |
| VS-3 | unit | Media query targets `.hero-h1` for font-size override | PASS |
| VS-4 | unit | Media query stacks `.stack-col` cells with `display:block; width:100%` | PASS |
| VS-5 | unit | Ribbon body cell does NOT have `whiteSpace:nowrap` (the source of the bug) | PASS |
| VS-6 | unit | Ribbon CTA pill keeps `whiteSpace:nowrap` so "OPEN ARCHIVE →" stays on one line | PASS |
| VS-7 | unit | All 16 prior `email-render.test.ts` editorial-layout tests still pass | PASS |
| VS-8 | unit | Full pipeline unit suite (514 tests) still passes | PASS |
| VS-9 | tsc  | Pipeline typecheck clean | PASS |
| VS-10 | lint | Pipeline lint clean | PASS |
| VS-11 | ui  | Mobile @ 375px: hero + ribbon visually fixed | PASS |
| VS-12 | ui  | Desktop @ 640px: no regressions, ribbon still 2-column | PASS |

All 12 scenarios passed.

---

## Unit evidence (VS-1 through VS-10)

`pnpm --filter @newsletter/pipeline exec vitest run tests/unit/lib/email-render.test.ts`

```
Test Files  1 passed (1)
Tests       22 passed (22)
```

The 6 new assertions cover both fixes plus regression guards:

```ts
// Hero
it("renders the hero headline at a smaller default size (≤32px)", …)
it("media query targets the hero headline with a stable class", …)

// Style block
it("includes a <style> block in <head> with a mobile media query", …)

// Ribbon
it("media query stacks the archive ribbon columns on narrow viewports", …)
it("does NOT apply width:1% or whiteSpace:nowrap on the ribbon's body cell", …)
it("ribbon CTA pill keeps whiteSpace:nowrap so 'OPEN ARCHIVE →' stays on one line", …)
```

Full suite: `Tests 514 passed (514)`. Typecheck + lint clean.

---

## UI evidence (VS-11, VS-12)

Rendered HTML at `docs/spec/fix-email-mobile-responsive/verification/ui/newsletter-mobile-fixture.html`
using a deliberately long headline modeled on the user's screenshot.

### Mobile (375px) — `mobile-375-slice-00-hero.png`, `mobile-375-slice-01-ribbon-recheck.png`

**Hero (slice 00):**
- Title "Multi-Token Prediction (MTP) for LLaMA.cpp — Gemma 4 speedup by 40%" wraps to **4 lines** (was 7).
- Hero `font-size` resolved to 26px (via `@media (max-width:480px) { .hero-h1 { font-size: 26px !important } }`).
- Headline reads as a balanced editorial element, not as a wall of text.

**Ribbon (slice 01-recheck):**
- Two-row stacked layout: `READING THE ARCHIVE` eyebrow + italic dek "Catch up on every issue you've missed." (single clean two-line wrap), then `OPEN ARCHIVE →` pill below, **centered**.
- Verified via `getBoundingClientRect()`: pill is 145.09px wide, parent cell is 256px wide, `text-align: center` → pill horizontally centered within the ribbon's content box.
- The pre-fix bug (5 single-word lines) is gone — `width:1%` and `whiteSpace:nowrap` removed from the body column; the right column gets `text-align:center !important` only on mobile.

### Desktop email (640px) — `desktop-640-slice-00-hero.png`, `desktop-640-slice-01-ribbon.png`

**Hero (slice 00):** wraps to 3 lines at 30px. Editorial, no widow words. Story title below at 24px reads cleanly.

**Ribbon (slice 01):** two-column layout preserved. Eyebrow + dek on the left, `OPEN ARCHIVE →` pill on the right. The dek wraps to a single line because the body column is no longer being squeezed by `width:1%` on the sibling cell. Confirms the desktop design didn't regress.

### Adversarial second pass

Both screenshots re-examined with seed "find a defect."

- Mobile hero: 4 lines for a 12-word title is acceptable. The "by 40%" widow on the last line is short but readable.
- Mobile ribbon: pill appeared left-aligned at first glance — verified via `getBoundingClientRect` that it IS centered, just within the 256px ribbon content width, not the full 375px viewport. This is the intended behavior.
- Desktop ribbon: dek and pill are vertically centered in the same row — `verticalAlign: middle` on both `<Column>`s works correctly.

Second pass clean across all four screenshots.

---

## Spec coverage table

| Requirement (from user screenshot) | Evidence |
|---|---|
| Hero headline shouldn't wrap to 7 lines on phones | `mobile-375-slice-00-hero.png` — 4 lines for the same title; unit test asserts size ≤32px and class hook |
| Archive ribbon shouldn't squeeze the dek to single-word lines | `mobile-375-slice-01-ribbon-recheck.png` — clean 2-line dek, pill centered below; unit test asserts no `width:1%` on body cell + media-query stack class |
| Desktop layout shouldn't regress | `desktop-640-slice-01-ribbon.png` — 2-column layout intact; `desktop-640-slice-00-hero.png` — clean 3-line headline at 30px |
| Inline `whiteSpace:nowrap` on the pill itself must stay (so "OPEN ARCHIVE →" doesn't drop the arrow) | Unit test `ribbon CTA pill keeps whiteSpace:nowrap` |

---

## Not executed

- **Cross-client testing** (Gmail, Apple Mail iOS, Outlook desktop). The fix uses only the standard email-tested techniques (`<style>` in `<head>` with `!important` overrides + `display:block` stacking), which are documented as supported by all major clients including Outlook 2007+. Recommended Litmus pass before next release nonetheless.
- **Live confirm flow** — the user's reported bug was visible in their actual email client. The fix is rendering-only (no code path change), so a re-run of the same flow with this branch deployed should show the corrected layout. Not run here because deployment requires merging the PR.

---

## Infrastructure note

- Started: `python3 -m http.server 8765` in `verification/ui/` to serve the rendered HTML.
- Cleaned up: `lsof -ti :8765 | xargs kill` before writing this report.
- One Playwright tab; closed at end.
