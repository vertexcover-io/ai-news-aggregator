# Eval UI · Redesign mocks

HTML mocks for the eval admin pages redesign. Open each file directly in a browser — no build step.

## Direction

Editorial admin — restrained, dense, hairlines and monospace. The current admin uses uncustomized shadcn neutrals; this redesign keeps that base but lightly adopts the brand:

- **Serif (Newsreader)** on H1 page titles only — borrowed from the public archive.
- **Mono (Geist Mono)** for every ID, timestamp, hash, count, eyebrow, and table cell that carries data.
- **Sans (Inter)** for body, controls, lede.
- **Rust accent (#8C3A1E)** is the only saturated color — reserved for the primary CTA and a single status (running pulse). Tier colors stay semantic green/amber/stone.
- **Borders are hairline neutral-200** everywhere. Almost no shadows; a `1px 4px` lift only on the primary CTA.
- **No cream background.** Admin stays on white / neutral-50. Cream is a public-archive signal, not an admin one.

## Files

| # | File | Description |
|---|------|-------------|
| – | [`_theme.css`](_theme.css) | Shared design tokens, typography scale, all component primitives (panels, chips, tables, buttons). |
| 01 | [`01-eval-index.html`](01-eval-index.html) | `/admin/eval` — prompt editor goes full-width with controls docked to a right rail; aggregate hero strip above the per-fixture results table; sourcing report uses stacked source bars. |
| 02 | [`02-eval-grade.html`](02-eval-grade.html) | `/admin/eval/grade/:fixtureId` — flat cluster rows (no card-on-card), 3px rust left rail for selection, keycap-tile label buttons, conic-gradient progress ring + tier bars. |
| 03 | [`03-eval-fixture-new.html`](03-eval-fixture-new.html) | `/admin/eval/fixtures/new` — textarea-first composer with valid/invalid counter; compact invalid-line indicator below; pipeline preview rail explains what runs on submit. |
| 04 | [`04-eval-runs.html`](04-eval-runs.html) | **NEW** `/admin/eval/runs` — persisted run history. Filter bar, dense table with checkboxes, rust "Compare prompts" CTA when 2 rows selected, pagination. |
| 05 | [`05-states.html`](05-states.html) | Component states sheet: prompt diff modal at 3 sizes (empty/small/large), run-detail drawer (snapshot + breakdowns), runs-page empty state. |

## Design-notes panel

Each file has an amber notes panel at the top that explains **what changed vs the current build and why**. Those notes are the artifact for the design review — they're not part of the final implementation, just rationale for the reviewer.

## Reflow

All mocks designed at 1440px primary. Each `notes` section calls out the < 768px reflow behavior in one line. No standalone mobile mock at this stage — the reflow rules in the notes are sufficient input for the Stage C implementer.

## Out of scope

- Dark mode.
- Mode B (calendar) detailed redesign — only the tab is shown on 01. The Mode B results panel keeps its current shape.
- The /admin login redesign.
- Public-side (`/`, `/archive/:runId`) redesign — these stay on the Ledger cream/serif theme.
