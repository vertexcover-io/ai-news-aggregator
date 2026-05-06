# VER-94 — UI/UX polish on archive pages

**Linear:** [VER-94](https://linear.app/vertexcover/issue/VER-94/uiux-issues-on-the-archive-page)
**Status:** Implemented (PR [#92](https://github.com/vertexcover-io/ai-news-aggregator/pull/92))
**Branch:** `ver-94-uiux-archive-fixes`

This is a **retrospective** design doc — backfilled after implementation as part of the orchestrate audit trail.

## Problem

Four user-reported UI/UX issues on the public archive surface (`/` listing and `/archive/:runId` post page):

1. The month-filter pill row at the top of `/` was visual noise. Users land on "newest first" and scroll; the chips weren't earning their space.
2. The brand was the placeholder string `"AI Newsletter"` and the listing-page subheadline (`"A hand-curated daily digest of what's actually moving in AI."`) made a claim ("hand-curated") that's both technically false (the ranker is an LLM) and the most overused phrase in newsletter-land. There was no link from `news.vertexcover.io` to `blog.vertexcover.io`, missing a free distribution channel.
3. The post page (`/archive/:runId`) showed redundant rank/source metadata: each story article had a left rail with `N° / 01` (big serif rank) **and** a right rail with `01 / 12` (rank-of-total) **and** a truncated host badge (e.g. `x.com`). Meanwhile the eyebrow line already showed the source label (`TWITTER`). Three places saying the same two things.
4. The site name in the header was a static `<span>`, so clicking it on `/archive/:runId` did nothing. Users expect the brand to act as the home link.

## Goals

- Strip noise without breaking the Ledger aesthetic.
- Pick a brand name that names what the product *does* differently, not what it *is generically*.
- Replace the auto-feeling subheadline with copy a human would write.
- Make every story metadata bit appear exactly once on the post page.
- Brand wordmark links home everywhere.

## Non-goals

- Redesign the page layouts. Typography, spacing, and color (`#FAFAF7` bg, `#8C3A1E` rust accent, Newsreader serif, Geist Mono eyebrows) all stay.
- Touch the admin/`/admin/*` surfaces. The fixes are all on public pages.
- Add a logo asset. The wordmark stays as text-only.
- Change anything in the ranking pipeline, API, or DB schema.

## Decisions

### Decision 1: Brand → "Sieve"

Rejected alternatives, with reasoning:

| Candidate | Why rejected |
|---|---|
| Vertexcover AI Digest | Too long; reads like an enterprise white-paper title |
| Vertexcover Daily | Couples too tightly to parent brand; loses distinct product identity |
| Signal Ledger | "Signal" is the most overused word in the AI/tech space; can't claim it |
| Compute Daily | Generic; doesn't say what makes us different |
| Frontier Notes | Cute but vague; doesn't describe the function |
| The Stack | Conflicts with the existing tech publication of the same name |

**Picked:** **Sieve**. One-word descriptor of the product's mechanic — sift ~200 sources daily down to ~10 stories. The word itself is a mini-pitch. "Hand-curated" is a crowded, false claim; "sieved by an agent" is distinctive and honest.

### Decision 2: Drop the right rail entirely (post page)

The duplication trio was: left-rail rank + right-rail rank + host badge.

Options considered:

- **A.** Keep right rail; drop the host badge only. Still has duplicate rank.
- **B.** Drop right rail entirely. Simplest change; grid 3→2 cols.
- **C.** Drop left rail; keep right rail with rank-of-total. Loses the big serif numeral that's part of the Ledger feel.
- **D.** Merge "01 / 12" into the left rail beneath N°. Adds visual weight to the left rail; mobile reflow gets cluttered.

**Picked:** B. The big serif rank in the left rail is the design moment; the "of-total" framing isn't load-bearing (the total story count is already in the page header: *"7 stories"*). Removing the right rail also kills the host/source duplication for free. Cleanest cut, smallest blast radius.

### Decision 3: New listing copy — "The Daily Read" / "AI news worth your morning."

Rejected:
- *"Today in AI" / "The day's signal, separated from the noise."* — "signal" is overused.
- *"Field Notes" / "What shipped, what shifted, what matters."* — three-beat rhythm, too clever.
- *"What ~200 AI thinkers wrote today, ranked by an agent."* — too long for a hero subheadline; works better as a sub-paragraph.

**Picked:** "The Daily Read" / "AI news worth your morning." Compact, conversational, doesn't lie.

### Decision 4: Month-filter chips — full removal vs. keep behind a "Filter" disclosure

Considered tucking them behind a `<details>` so the option remained without the visual cost. **Rejected** — adds machinery for a behavior nobody is using. If month filtering becomes a real ask, it can come back as a single dropdown later.

## External Dependencies & Fallback Chain

**None.** The fix touches only existing dependencies (React, react-router-dom, Tailwind, vitest, @tanstack/react-query). No new packages, no external APIs, no LLM calls. The library-probe stage is therefore N/A for this work.

## Risk

Low. All changes are public-page render-tier; no data-flow changes, no API changes, no DB changes. The unit test suite covers all four behavior changes. Worst case is a copy regret — easy to revert in a one-line PR.

## Backfill caveat

This document was produced **after** the implementation landed in PR #92. The decisions section is genuine — the alternatives were considered with the user during the upfront Q&A — but the document didn't exist before code was written. Future similar tasks should run brainstorm → spec → plan → code first.
