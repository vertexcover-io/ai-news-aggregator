# Design: Recap-Style Archive Page for Runs (VER-65)

**Date:** 2026-04-13  
**Linear:** VER-65  
**Status:** Approved for implementation

---

## Problem Statement

After a successful run, users have no way to view results in a readable, scannable format. The current `/run` page shows a raw ranked list with scores and rationale, but it's not publishable or archive-worthy. The user wants a **recap-style archive page** — similar to [recap.aitools.inc](https://recap.aitools.inc/p/openai-issues-code-red-over-gemini-3) — that presents each run's results as a curated, scannable AI news digest. A button on the run results should navigate to this archive page.

---

## Context

### Reference Analysis: recap.aitools.inc

The reference site uses a **newsletter-post layout** with:

1. **Page header** — H1 title (edition name), H2 subtitle (secondary stories), author + date, share buttons
2. **Intro box** (rounded border card) — greeting paragraph, 2-3 sentence context, bullet TOC of stories
3. **Story sections** — for each story:
   - `H1` headline
   - **"The Recap:"** — 1-sentence summary of the story
   - **"Unpacked:"** — 3-5 bullet points with inline source links
   - **"Bottom line:"** — 1-sentence strategic takeaway
4. **"Keep reading" section** — 3 related post cards with thumbnail image, headline, subtitle, author/date
5. **Layout** — centered ~640px column, clean white bg, minimal sans-serif typography, generous whitespace

### What We Have

| Field | Source | Available? |
|-------|--------|-----------|
| `title` | `raw_items.title` | ✅ |
| `url` | `raw_items.url` | ✅ |
| `sourceType` | `raw_items.sourceType` | ✅ |
| `publishedAt` | `raw_items.publishedAt` | ✅ |
| `author` | `raw_items.author` | ✅ |
| `engagement` | `raw_items.engagement` | ✅ (points, commentCount) |
| `content/body` | `raw_items.content` | ✅ stored, not yet sent to frontend |
| `rationale` | Redis ranked item ref | ✅ LLM ranking explanation |
| `score` | Redis ranked item ref | ✅ |

### What We're Missing

| Field | Gap | Mitigation |
|-------|-----|-----------|
| `summary` | "The Recap:" 1-liner per story | Generate via LLM during ranking, or derive from `rationale` |
| `imageUrl` | Thumbnail for story card | Not scraped — use OG image scraping, or placeholder by source |
| `bulletPoints` | "Unpacked:" detail bullets | Generate via LLM, or parse from `content` |
| `bottomLine` | Strategic takeaway sentence | Generate via LLM |
| `tags/category` | Story categorization | Optional — can derive from sourceType |

**MVP decision:** For this PR, we will:
- Reuse `rationale` as "The Recap:" summary (already LLM-generated, purpose-similar)
- Skip `imageUrl` for now — use source type icons/badges instead (no scraping infra yet)
- Skip `bulletPoints` and `bottomLine` — format as single summary card, not full recap format
- The UI gets the full recap visual style/layout even with reduced content

**This is explicitly a UI/frontend feature.** No new pipeline stages, no new LLM calls, no schema changes for this PR.

---

## Requirements

### Functional

- **REQ-01:** After a run completes, a "View Archive" button appears in the results UI
- **REQ-02:** The button navigates to `/archive/:runId`
- **REQ-03:** The archive page fetches run state via `GET /api/runs/:runId` (existing endpoint)
- **REQ-04:** The archive page renders each `RankedItem` as a story card in recap style
- **REQ-05:** Each story card shows: rank, source badge, title (linked), author, date, engagement (points/comments), and rationale as summary
- **REQ-06:** The page has a header with run metadata: date, item count, profile name
- **REQ-07:** The page is accessible from a direct URL (shareable link)
- **REQ-08:** If run is not found or still running, show appropriate state (loading / not found / still running)
- **REQ-09:** `content` field should be passed through to the frontend (currently stripped in hydration) so future iterations can use it

### Non-functional

- **REQ-10:** Page renders correctly on desktop (primary) and is readable on mobile
- **REQ-11:** No new API endpoints needed — reuse `GET /api/runs/:runId`
- **REQ-12:** No new pipeline stages or LLM calls
- **REQ-13:** Uses existing Tailwind CSS classes from the web package

### Out of Scope (Future)

- Image URL scraping / OG image extraction
- LLM-generated bullet points ("Unpacked:") and "Bottom line:"
- Email delivery of the archive format
- Public sharing / anonymous access (currently auth is minimal, but this is internal)
- Pagination of items on the archive page

---

## Architectural Challenges

### 1. `content` field not currently forwarded to frontend

`RankedItem` (the hydrated type in `@newsletter/shared`) does not include `content`. The `hydrateRankedItems()` function in the API queries `raw_items` but doesn't select `content`. Future iterations need it for bullet point generation.

**Decision:** Add `content?: string | null` to `RankedItem` and select it in `hydrateRankedItems()`. This is a non-breaking additive change.

### 2. Route structure

The archive page is a new route `/archive/:runId`. It needs to be added to the React Router config in `App.tsx`.

**Decision:** Add `ArchivePage` component at `/archive/:runId`. Reuse `useRunPolling` hook or a simpler one-shot fetch since we only need the final state.

### 3. Recap visual structure with limited content

The reference site has rich content (intro paragraph, bullets, bottom line) per story. We only have `title`, `rationale`, `url`, `engagement`, `sourceType`, `author`, `publishedAt`.

**Decision:** Map our fields to a simplified recap card:
- Card header: source badge + date + author + engagement
- Card title: linked H2
- Card body: rationale as "The Recap:" paragraph
- Card footer: "Read more →" link

The visual design mimics recap style (card borders, typography scale, layout) even if content depth is lower.

---

## High-Level Design

### New Files

```
packages/web/src/
  pages/
    ArchivePage.tsx          — Main archive page component
  components/
    ArchiveStoryCard.tsx     — Individual story card (recap style)
    ArchivePageHeader.tsx    — Page header (run date, count, profile)
```

### Modified Files

```
packages/web/src/
  App.tsx                    — Add /archive/:runId route
  pages/RunPage.tsx          — Add "View Archive" button after run completes
packages/shared/src/
  types/run.ts               — Add content?: string | null to RankedItem
packages/api/src/
  services/rank-hydration.ts — Select content field in DB query
```

### Data Flow

```
RunPage (completed)
  → "View Archive" button click
  → navigate to /archive/:runId

ArchivePage mounts
  → useRunState(runId) — one-shot GET /api/runs/:runId
  → if loading: spinner
  → if running: "Run still in progress" message with back link
  → if not found: "Run not found" message
  → if completed: render ArchivePageHeader + list of ArchiveStoryCard
```

### `ArchiveStoryCard` anatomy

```
┌─────────────────────────────────────────────────┐
│  [HN] · Apr 13, 2026 · by author · ▲ 342 · 💬 45│  ← metadata row
│                                                   │
│  ## Title of the Article                          │  ← linked H2
│                                                   │
│  The Recap: LLM rationale text as summary...      │  ← rationale
│                                                   │
│  Read more →                                      │  ← source link
└─────────────────────────────────────────────────┘
```

### `ArchivePageHeader` anatomy

```
┌─────────────────────────────────────────────────┐
│  AI Newsletter                                   │
│  April 13, 2026 · 10 stories · profile: default  │
│                          [← Back to Run]         │
└─────────────────────────────────────────────────┘
```

---

## Approaches Considered

### A: Full recap format with LLM-generated content
Generate `summary`, `bulletPoints`, `bottomLine` per item during ranking.
- **Pros:** Full visual parity with reference, rich content
- **Cons:** New LLM calls, changes to pipeline, schema changes, out of scope for VER-65
- **Verdict:** Future work (VER-66 or similar)

### B: Simplified recap layout with existing data (chosen)
Use `rationale` as summary, skip bullets/bottom-line, use source badges instead of images.
- **Pros:** No pipeline changes, no new LLM calls, ships quickly, correct visual framing
- **Cons:** Less content depth per card
- **Verdict:** ✅ Correct scope for VER-65

### C: Embed recap view inline on RunPage
Show recap layout directly on the run results page.
- **Pros:** No new route, simpler
- **Cons:** Breaks current UX (run page serves a different purpose), not shareable URL
- **Verdict:** ❌ Rejected — archive should be a distinct, shareable page

---

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| `content` field select breaks hydration query | Low | Low | Additive query change, no schema change |
| Archive page loaded for in-progress run | Medium | Low | Explicit "still running" state with back link |
| Run state expires in Redis before user views archive | Medium | Medium | Not addressed in this PR; future: persist to DB |
| TypeScript type mismatch from adding `content` to `RankedItem` | Low | Low | Update shared type + grep all consumers |

---

## Open Questions

1. Should the "View Archive" button open in a new tab or same tab? → Same tab (consistent with SPA navigation)
2. Should we show a "Copy link" button on the archive page? → No for now, out of scope
3. What's the page title for the archive route? → "AI Digest — {date}" or "Run {runId shortened}"

---

## Assumptions

- No auth is required for the archive page (internal tool, same as current)
- `GET /api/runs/:runId` is sufficient — no new endpoint needed
- The `content` field in `raw_items` may be null for many items (HN titles don't have body); graceful null handling required
- The visual design uses Tailwind CSS only — no new CSS files
