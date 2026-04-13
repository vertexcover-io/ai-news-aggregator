# Recap Archive V2: Rich Content, Images, and Recap-Style UI — Design

## Problem Statement

The archive page (shipped in VER-65 phase 1) renders a simplified card layout with title, source badge, engagement, and a plain-text `rationale` as "The Recap:". The reference site (recap.aitools.inc) has a much richer structure per story: hero/inline images, a 1-2 sentence summary ("The Recap:"), detailed analysis bullets ("Unpacked:"), a strategic takeaway ("Bottom line:"), and embedded markdown links. The current archive looks like a listing page rather than a curated newsletter digest.

This iteration closes the gap by:
1. Extracting images from each source (Reddit thumbnails, web collector markdown images, OG images for HN)
2. Generating structured recap content via the ranking LLM (summary, unpacked bullets, bottom line)
3. Redesigning the archive UI to match the recap.aitools.inc visual structure

## Context

### What exists today

| Component | Current state |
|-----------|--------------|
| `raw_items` schema | Has `content` (text body), `engagement` (jsonb), `metadata` (jsonb with `comments` only) |
| `RankedItem` type | Has `score`, `rationale` (plain string), `content` (body text) |
| `RankedItemRef` | Stored in Redis: `{ rawItemId, score, rationale }` |
| Ranking prompt | Returns `{ id, score, rationale }` per item — rationale is a single sentence naming scoring axes |
| HN collector | Fetches from Algolia API — no image fields in response |
| Reddit collector | Type definition missing `thumbnail`/`preview` fields (API returns them) |
| Web collector | Jina markdown preserves `![alt](url)` image syntax in `content` field but no extraction |
| Archive UI | Simple card: rank badge, source badge, title link, rationale as "The Recap:", "Read more" link |

### What the reference site has per story

1. **Image** — hero or inline illustration per story
2. **"The Recap:"** — 1-2 sentence summary of the news
3. **"Unpacked:"** — 3-5 bullet points with analysis
4. **"Bottom line:"** — 1-sentence strategic takeaway
5. **Typography** — centered ~640px column, generous whitespace, clear section hierarchy

## Requirements

### Functional Requirements

- **FR-01:** Add `imageUrl` column to `raw_items` table (nullable text)
- **FR-02:** Reddit collector extracts `thumbnail` or `preview.images[0].source.url` from API response and stores as `imageUrl`
- **FR-03:** Web collector uses the existing detail-extraction LLM call to select the most relevant image from the post markdown and stores as `imageUrl` (at detail level, not listing level)
- **FR-04:** HN collector fetches OG image (`og:image` meta tag) from the linked article URL and stores as `imageUrl`
- **FR-05:** Extend `RawItemMetadata` to include optional `recap` object: `{ summary, bullets, bottomLine }`
- **FR-06:** Modify ranking prompt to return structured recap content per item: `summary` (1-2 sentences), `bullets` (3-5 analysis points), `bottomLine` (1-sentence takeaway)
- **FR-07:** Store recap content in `metadata.recap` on the `raw_items` row after ranking completes
- **FR-08:** Extend `RankedItemRef` to carry `recap` data (or hydrate it from `raw_items.metadata` during API response)
- **FR-09:** Extend `RankedItem` type to include `imageUrl` and `recap` fields
- **FR-10:** Redesign `ArchiveStoryCard` to show image, "The Recap:", "Unpacked:" bullets, "Bottom line:"
- **FR-11:** Archive page layout: centered column (~640px), recap-style typography, story images
- **FR-12:** Graceful handling when `imageUrl` is null (card renders without image, no broken layout)
- **FR-13:** Graceful handling when `recap` is null (fall back to current rationale display)

### Non-Functional Requirements

- **NFR-01:** OG image fetch for HN should not block the collector pipeline — use a timeout (5s) and skip on failure
- **NFR-02:** Expanded ranking prompt should not significantly increase LLM cost — keep within Claude Haiku tier
- **NFR-03:** No new LLM calls beyond the existing ranking step — recap content generated in the same `generateObject` call
- **NFR-04:** DB migration must be additive (new nullable column, no breaking changes)

### Edge Cases and Boundary Conditions

- **EDGE-01:** HN story URL points to a PDF or non-HTML resource — OG fetch returns no image, skip gracefully
- **EDGE-02:** Reddit post has `thumbnail: "self"` or `thumbnail: "default"` — these are not real URLs, skip
- **EDGE-03:** Web collector markdown has no images — `imageUrl` is null
- **EDGE-04:** LLM returns malformed recap content — validate with zod schema, fall back to simple rationale if structured output fails
- **EDGE-05:** Existing raw_items rows have no `imageUrl` or `recap` in metadata — archive page handles null gracefully
- **EDGE-06:** Image URL is broken/404 — frontend should handle with `onError` fallback or CSS placeholder

## Key Insights

1. **Reddit API already returns image data** — the `RedditPostData` type just doesn't capture `thumbnail` and `preview` fields. Adding them to the type definition is trivial.

2. **Jina markdown preserves images** — `![alt](https://...)` syntax is already in the `content` field for web-collected items. A simple regex extraction gets the first image URL.

3. **OG image for HN is the only source requiring new HTTP requests** — all other image sources are already available in existing API responses or markdown.

4. **Expanding the ranking prompt is lower-risk than adding a new pipeline step** — it's a single `generateObject` call with a richer zod schema. No new queue, no new worker, no new processing stage.

5. **Storing recap content in `metadata` jsonb avoids a schema-heavy migration** — the column already exists with a flexible jsonb type. Extending the TypeScript interface is sufficient.

## Architectural Challenges

### 1. Expanding the ranking prompt output without breaking existing validation

The current `rankedResponseSchema` validates `{ ranked: [{ id, score, rationale }] }`. Adding `summary`, `bullets`, `bottomLine` fields changes this schema. Existing rationale validation (axis mention check) needs to work with or without the new fields.

**Decision:** Extend the zod schema with new required fields. The axis validation still applies to `rationale`. The new fields (`summary`, `bullets`, `bottomLine`) are validated by zod's type system.

### 2. Writing recap content back to raw_items after ranking

The ranking step happens in the pipeline worker. It currently writes `RankedItemRef[]` to Redis. Now it also needs to update `raw_items.metadata` with recap content and `raw_items.imageUrl` is set during collection (before ranking). The recap content (summary/bullets/bottomLine) is set during ranking — this means the pipeline worker needs to write back to the DB after ranking.

**Decision:** After ranking, the run-process worker updates `raw_items.metadata` for each ranked item with the recap content from the LLM. This is a batch update, not per-item.

### 3. OG image fetching for HN items

HN items link to external articles. Fetching the OG image requires an HTTP request to each article URL, parsing the HTML `<meta>` tags. This adds latency to the HN collector.

**Decision:** Fetch OG image in the HN collector after fetching story data. Use a short timeout (5s). Parse `<meta property="og:image">` from the HTML head. Store in `imageUrl` column. On failure, leave `imageUrl` null.

### 4. Frontend handling of missing content

Not all items will have images or structured recap content (especially existing items from before this change, or items where LLM output is partial).

**Decision:** Archive card renders conditionally — image shown only if `imageUrl` is present, recap sections shown only if `recap` object exists, otherwise fall back to current rationale display.

## Approaches Considered

### Approach A: Separate summarize step (new pipeline stage)

Add a dedicated `summarize` worker that runs after ranking, takes the top-N items, and generates recap content via a separate LLM call.

- **Pros:** Clean separation, can use different model/temperature, doesn't bloat ranking prompt
- **Cons:** New queue, new worker, more infrastructure, doubles LLM cost per run
- **Verdict:** Overengineered for current needs

### Approach B: Expand ranking prompt (chosen)

Modify the existing ranking prompt to return structured recap content alongside score.

- **Pros:** Single LLM call, no new infrastructure, content generated with full ranking context
- **Cons:** Larger prompt output, ranking step takes slightly longer
- **Verdict:** Right complexity for the scope

### Approach C: Client-side generation

Generate recap content on-demand when viewing the archive page.

- **Pros:** No pipeline changes, content always fresh
- **Cons:** Slow page loads (LLM call per view), requires API key exposure or proxy, bad UX
- **Verdict:** Wrong architecture for this use case

## Chosen Approach

**Approach B: Expand ranking prompt.** The ranking LLM already has the article body, comments, and scoring context. Asking it to also produce a structured summary, analysis bullets, and bottom line is a natural extension. The zod schema validates the output structure. No new pipeline stages or workers needed.

## High-Level Design

### Data Flow

```
Collection (per source):
  HN collector → fetch stories → fetch OG image from article URL → store imageUrl
  Reddit collector → extract thumbnail/preview from API response → store imageUrl  
  Web collector → LLM selects best image from post markdown (detail level) → store imageUrl

Ranking (existing step, expanded):
  Load candidates → build prompt → generateObject with expanded schema
  → LLM returns { id, score, rationale, summary, bullets, bottomLine }
  → Store RankedItemRef in Redis (score, rationale)
  → Update raw_items.metadata.recap with { summary, bullets, bottomLine }

API hydration (existing, expanded):
  hydrateRankedItems() → select imageUrl + metadata from raw_items
  → Build RankedItem with imageUrl and recap fields

Archive UI (redesigned):
  ArchiveStoryCard → render image, "The Recap:", "Unpacked:" bullets, "Bottom line:"
  → Fallback to current layout if recap data missing
```

### Schema Changes

```
raw_items table:
  + imageUrl TEXT (nullable) — new column via Drizzle migration

RawItemMetadata type:
  { comments: RawItemComment[], recap?: RecapContent }

RecapContent type:
  { summary: string, bullets: string[], bottomLine: string }

RankedItem type:
  + imageUrl: string | null
  + recap: RecapContent | null
```

### Ranking Prompt Changes

Current output schema: `{ ranked: [{ id, score, rationale }] }`

New output schema: `{ ranked: [{ id, score, rationale, summary, bullets, bottomLine }] }`

Where:
- `summary`: 1-2 sentence news summary (what happened)
- `bullets`: 3-5 analysis points (why it matters)
- `bottomLine`: 1-sentence strategic takeaway

### Archive UI Structure (per story card)

```
┌─────────────────────────────────────────────────┐
│  [IMAGE]                                        │  ← imageUrl (if present)
│                                                 │
│  ## Story Title                                 │  ← linked H2
│  [HN] · Apr 13, 2026 · by author · ▲ 342       │  ← metadata row
│                                                 │
│  The Recap: Summary text here...                │  ← recap.summary
│                                                 │
│  Unpacked:                                      │  ← recap.bullets
│  • Bullet point 1                               │
│  • Bullet point 2                               │
│  • Bullet point 3                               │
│                                                 │
│  Bottom line: Strategic takeaway here.           │  ← recap.bottomLine
│                                                 │
│  Read more →                                    │  ← source link
└─────────────────────────────────────────────────┘
```

## Open Questions

1. **Token budget for expanded ranking output** — the current prompt sends truncated bodies. The recap output is ~150-200 extra tokens per item. With 10 items that's ~2K extra output tokens. Should be fine for Haiku but worth monitoring.
2. **OG image quality** — some sites return low-res or placeholder OG images. No filtering for now; can add min-size check later.

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Expanded prompt makes ranking unreliable | Low | High | Validate with zod; fall back to simple rationale if structured output fails |
| OG image fetch slows HN collector | Medium | Low | 5s timeout per item, parallel fetches, skip on failure |
| Reddit thumbnail URLs are low quality | Medium | Low | Prefer `preview.images[0].source.url` over `thumbnail` |
| Existing runs have no recap data | Certain | Low | Frontend conditional rendering; graceful null handling |
| LLM generates inaccurate summaries | Medium | Medium | User reviews results before sharing; this is an internal tool |

## Assumptions

- Claude Haiku can reliably produce structured recap content within the existing ranking call
- The `metadata` jsonb column can hold the additional recap data without performance issues
- OG image fetching is acceptable latency overhead for HN items (5s timeout)
- The archive page is internal-only; no SEO or public access considerations
