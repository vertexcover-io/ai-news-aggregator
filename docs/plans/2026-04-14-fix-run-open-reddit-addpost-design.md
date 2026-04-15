# Design — Fix run-open, reddit images, add-post UX, and user-added artifacts

**Date:** 2026-04-14
**Worktree:** `.worktrees/fix-run-open-reddit-addpost` (branch `fix/run-open-reddit-addpost`, off `899d2fc`)
**Pencil mockups:** `/pencil-new.pen` (single canvas: runs-table action states + Add Post before/after)

## Problem statement

Four small, mostly-independent fixes for the AI Newsletter app:

1. Clicking **Open** on a still-running run from the dashboard navigates to `/archive/:runId`, which 404s and shows "Run not found — it may have expired." The user wants no destination at all while the run is in progress — the button should be disabled until the run completes.
2. Some Reddit images don't render. DB inspection shows ~half of `image_url` values for `source_type='reddit'` still contain literal `&amp;` HTML entities (e.g. `?width=140&amp;height=90&amp;auto=webp&amp;...`), which browsers reject as malformed query strings. The collector decodes the entity on the `preview.images` extraction path but not on the `thumbnail` fallback path.
3. The review-page **Add Post** panel exposes three collector tabs (HN/Reddit/Web). User wants only the URL field — no collector selection — and the backend should also lock to web-only so other collectors can't be invoked through this entry point.
4. User-added posts (via Add Post) sometimes lack an image. DB inspection shows the only existing user-added row was a 429 error page where the LLM extracted no image. Need a fallback chain (og:image → twitter:image → favicon) that fires when the LLM doesn't return an image URL, so most real article URLs end up with an image.

## Context

- **Run state lives in two places.** Live state is a Redis blob `run:${runId}` (3600s TTL) served by `GET /api/runs/:runId`. Completed state is the Postgres `run_archives` table served by `GET /api/archives/:runId`. The dashboard's "Open" link points at `/archive/:runId` regardless of status.
- **Source vs. collector vs. variant.** `RunState.sources` already tracks per-source status (hn / reddit / blog) but not per-feed/per-subreddit variant. The user explicitly opted out of any per-source UI for now — the fix is purely "block navigation while running, show the existing archive when done."
- **Add Post is fully wired backend-side.** `POST /api/archives/:runId/add-post` calls `addPostToArchive` → `hydrateAddedPost` → dispatches to `fetchHnPost` / `fetchRedditPost` / `fetchWebPost` based on `sourceType`, then runs `generateRecap` synchronously before returning a fully-hydrated `RankedItem`. Locking to web-only means dropping the dispatch table and the zod field.
- **Web collector image extraction goes through Jina markdown + LLM.** `processOnePost` calls `fetchMarkdown` (Jina) then `extractPostFields` (LLM). The LLM returns `image_url` from whatever it sees in the markdown — but Jina strips `<head>` meta tags, so og:image / twitter:image are never visible. To add a fallback chain we need a second HTTP fetch of the raw HTML and a small parser. This is a real new code path, not just a tweak.
- **`source_type='blog'` is what the web collector writes** (not `'web'`). The schema does not have a `'web'` source type. User-added posts therefore land in `raw_items` with `source_type='blog'` plus `metadata.addedInReview = true`.
- **Reddit thumbnail fallback path.** `extractRedditImageUrl` at `packages/pipeline/src/collectors/reddit.ts:51-62`: returns `previewUrl.replaceAll("&amp;", "&")` on the preview path, but the `thumbnail` fallback returns the raw value verbatim — and Reddit's listing JSON sometimes has thumbnails as preview-style URLs with HTML entities. Fix is one line.

## Requirements

### Functional (per issue)

**Issue #1 — disable Open while running**
- The "Open" button on a running-status row in the dashboard's `RunsTable` MUST be visually disabled (greyed out, non-clickable, no navigation).
- The button MUST become a clickable "View archive" link the moment the run reaches `completed` status (existing behavior).
- The "Retry" button on `failed` rows is unchanged.

**Issue #2 — reddit images render**
- `extractRedditImageUrl` MUST decode `&amp;` → `&` on every code path, not just `preview.images[0].source.url`.
- All `<img>` tags in the web UI that render `item.imageUrl` (in `ArchiveStoryCard.tsx`, `ReviewCard.tsx`, and any other surface that displays a recap item's image) MUST set `referrerPolicy="no-referrer"`.

**Issue #3 — add-post URL-only**
- The `AddPostPanel` UI MUST render only a URL input + Add post button. No collector tabs, no source-type selector.
- The frontend MUST submit `{ url }` only.
- The backend zod schema for `POST /api/archives/:runId/add-post` MUST accept `{ url }` only — no `sourceType` field.
- The backend dispatch logic MUST always invoke the web collector path (`fetchWebPost` → `generateRecap`). The HN-single and Reddit-single collectors MUST NOT be reachable through the add-post route.
- `hydrateAddedPost` may keep its `sourceType` parameter for testability, but the route handler MUST always pass `'web'`.

**Issue #4 — image fallback chain for user-added posts**
- When `processOnePost` (or `fetchWebPost`) finishes and `image_url` is still null/empty, the collector MUST attempt a fallback fetch: read the raw HTML of the page and look for, in order:
  1. `<meta property="og:image" content="…">`
  2. `<meta name="twitter:image" content="…">` (and `twitter:image:src`)
  3. `<link rel="icon" href="…">` or `<link rel="shortcut icon" href="…">` (resolved against the page's base URL)
- The first non-empty value MUST be normalized to an absolute URL and stored.
- Fallback fetch MUST be subject to the existing `signal: AbortSignal` timeout.
- A failed fallback fetch MUST NOT fail the whole add-post — the post is stored without an image.

### Non-functional

- No new third-party deps for the og:image/twitter:image/favicon parser. A small regex-based extractor is fine — we don't need a full HTML DOM.
- The fallback fetch in #4 is on the add-post hot path (synchronous, user is waiting). Cap it at the existing add-post timeout (already 30s in the API service); the fetch itself should reuse the existing `fetchFn` injection point so it's testable and can be aborted.
- All four fixes need unit-test coverage (the project mandates TDD per CLAUDE.md). The reddit-image and add-post backend changes especially must have regression tests because both have user-visible failure modes that escaped review the first time.

### Edge cases

- **Reddit thumbnail returns `"self"`, `"default"`, `"nsfw"`, or empty string.** These are sentinel values. `extractRedditImageUrl` already tolerates them (returns null), but the entity-decode change must not introduce a regression where an empty-but-non-null sentinel becomes truthy. Test: assert null return for each sentinel.
- **`referrerPolicy="no-referrer"` on a CDN that requires the referrer.** Reddit's `i.redd.it` and `preview.redd.it` accept missing referrers (verified by the linked images in the DB which work today when entities are decoded). HN/blog images may have other CDNs. Apply globally — if it breaks one, we have the entity-decode safety net for reddit specifically.
- **`og:image` that's a relative URL.** Resolve against the page's `<base href="…">` if present, else against the request URL. Don't store relative URLs.
- **`og:image` is a data: URI.** Skip — we don't want multi-MB inline base64 in the DB. Only accept `https?://` scheme.
- **Page returns non-200.** `fetchMarkdown` already retries 3× before the LLM step. The fallback HTML fetch is best-effort — if it 404s/timeouts/non-200s, just leave imageUrl null. Don't retry.
- **Disabled Open button is still focusable for screen readers.** Use a button (not anchor) with `aria-disabled="true"` and a tooltip explaining why; do not navigate `onClick`.
- **Run transitions completed→running mid-render.** React Query polling will refresh the row within a poll interval. The disabled state is derived from `run.status` so it'll flip automatically.

## Key insights

1. **Three of the four issues are tiny.** #1 is one render-path change in `RunsTable.tsx`. #2 is one line in the collector + an HTML attribute on two `<img>` tags. #3 is a UI removal + a few backend lines. Only #4 has real new code (raw-HTML fetch + meta extractor).
2. **`source_type='web'` doesn't exist in the schema.** The web collector emits `'blog'`. The previous explorer's claim that user posts get `source_type='web'` was wrong. No schema change is needed for #4.
3. **The "Run not found" error was always reachable, not a new bug.** The dashboard always linked Open → `/archive/:runId`, which only serves completed runs. The user saw it the first time they clicked Open during a still-running job.
4. **Issue #4's "missing artifacts" perception is mostly the Jina pipeline losing meta tags.** Article body and recap work fine; only the image suffers.

## Architectural challenges

- **#4 introduces a new HTTP fetch path inside the web collector.** It must be:
  - Reusing the same `fetchFn` injection point as the rest of the collector for testability.
  - Honoring the same `AbortSignal` so timeouts cancel cleanly.
  - Not invoked when the LLM already returned a usable image URL (cost optimization — most pages have a primary image the LLM extracts from markdown).
  - Located close to `processOnePost` (in `web.ts` or a sibling file in `collectors/`), not in `services/`, because it's collector-specific HTML parsing.

- **The add-post backend lock-down is a wire-shape change.** Per the `wire-shapes-live-in-shared-not-zod` learning, the `AddPostPayload` type in `@newsletter/shared` and the zod schema in `packages/api/src/lib/validate.ts` must change together. The frontend client `packages/web/src/api/archives.ts` and the `AddPostPanel` component must update their submit shape in lockstep.

- **`hydrateAddedPost` has a `sourceType` parameter consumed by `dispatchFetch`.** Two clean options: (a) keep the parameter, hard-code `'web'` at the route handler — minimal change; (b) drop the parameter and inline the web call — cleaner long-term. The user's directive ("backend should treat source link as web only, user should not be able to add any other source") is satisfied either way at the wire level. Option (a) is recommended because the testing surface is already established and `hydrateAddedPost` may grow other use cases later. Worth re-asking only if the planner sees a reason to prefer (b).

## Approaches considered

For each issue I considered the alternatives during the brainstorm questions; the chosen approaches are documented above. The notable rejections:

- **Issue #1: a real status page with per-source progress.** Rejected by user — too much surface area for the value, and the data is granular enough today via the existing endpoint if/when it becomes worth showing.
- **Issue #2: image-proxy endpoint.** Rejected. Decode + referrerPolicy fixes the observed broken URLs without adding a server hop.
- **Issue #3: keep backend dispatch flexible.** Rejected by user — backend must hard-lock to web.
- **Issue #4: stop using Jina and switch the whole web collector to raw HTML.** Out of scope and too invasive. The fallback chain only fires when the LLM fails to find an image, so we keep Jina's markdown for the primary path.

## Chosen approach (high-level design)

### #1 — Disable Open while running

- File: `packages/web/src/components/dashboard/RunsTable.tsx` (the `Action` cell renderer at line ~119).
- Change: replace the `<Button asChild><Link to="/archive/...">Open</Link></Button>` for the "running" branch with a non-`asChild` `<Button disabled aria-disabled="true">Open</Button>` and add a tooltip via the existing shadcn Tooltip primitive: "Available when the run completes."
- No backend or routing change. No `ArchivePage` change.

### #2 — Reddit image rendering

- File: `packages/pipeline/src/collectors/reddit.ts` — `extractRedditImageUrl`. Apply `replaceAll("&amp;", "&")` to the thumbnail fallback path as well. Centralize with a small `decodeAmp(url: string | null): string | null` helper inside the same file to avoid drift.
- Files: `packages/web/src/components/ArchiveStoryCard.tsx` and `packages/web/src/components/review/ReviewCard.tsx` — add `referrerPolicy="no-referrer"` to each `<img>` rendering an item image.
- Migration consideration: existing `raw_items` rows with `&amp;` URLs in the DB will remain broken until they're reprocessed by a fresh collector run. Acceptable — the issue is about new runs going forward.

### #3 — Add Post URL-only

- Frontend: `packages/web/src/components/review/AddPostPanel.tsx` — strip the tabs UI, render a single labeled URL input + submit button. Submit `{ url }` only.
- Frontend client: `packages/web/src/api/archives.ts` — adjust `addPost(runId, payload)` shape.
- Shared types: `packages/shared/src/types/...` — `AddPostPayload` becomes `{ url: string }` (drop `sourceType`).
- API zod: `packages/api/src/lib/validate.ts` — `addPostSchema` becomes `z.object({ url: z.string().url() })`.
- API route: `packages/api/src/routes/archives.ts` (handler at line ~103) — pass hard-coded `'web'` to `addPostToArchive` (or update its signature to drop the param entirely if we go with option (b) above).
- Backend service: `packages/api/src/services/review.ts` `addPostToArchive` — accept `{ url }`, hard-code `'web'` to `hydrateAddedPost`.
- Tests: existing add-post tests that exercise the HN/Reddit branches must be updated. The HN-single and Reddit-single collectors stay in place (they're unused but harmless; do not delete in this PR — out of scope).

### #4 — Image fallback chain

- New helper, colocated with the collector: `packages/pipeline/src/collectors/web-image-fallback.ts` exporting `extractFallbackImage(html: string, baseUrl: string): string | null`. Pure function. Uses regexes for `<meta>` and `<link>` tags. Resolves relative URLs against the base.
- Caller change in `packages/pipeline/src/collectors/web.ts` `processOnePost`:
  - After `extractPostFields` returns, if `mergedFields.image_url` is empty/null, fetch the raw HTML via `fetchFn(post.url, { signal })` (note: NOT through Jina), parse with `extractFallbackImage`, and use the result as the image URL.
  - Wrap the fallback fetch in try/catch — on any error, leave `image_url` null.
- New unit-test file: `packages/pipeline/tests/unit/collectors/web-image-fallback.test.ts` covering og:image, twitter:image, favicon, relative URL resolution, data: URI rejection, missing tags returning null.
- Update existing `packages/pipeline/tests/unit/collectors/web.test.ts` to assert the fallback fetch is invoked when LLM returns no image AND skipped when it does.

## Open questions

1. **`hydrateAddedPost` shape:** keep `sourceType: 'hn' | 'reddit' | 'web'` parameter (option a), or drop it (option b)? Recommend (a) for minimal disruption; planner can revisit during planning.
2. **Tooltip on disabled Open button:** the project uses shadcn/ui — there's a Tooltip primitive in `packages/web/src/components/ui/`. Confirm during planning that it's available without adding new deps. Otherwise, fall back to the native `title` attribute.
3. **`referrerPolicy` scope:** apply only to item images (recap/archive/review) or to all `<img>` tags in the web app? Scope to item images for now; widening is a future concern.

## Risks and mitigations

- **Risk:** disabling the Open button breaks an existing e2e test that asserts navigation on click.
  **Mitigation:** grep for tests against the runs table; update assertions during TDD.
- **Risk:** `referrerPolicy="no-referrer"` breaks images on a CDN we currently rely on.
  **Mitigation:** the broken-image set today is dominated by reddit URLs that will be entity-decoded. If a non-reddit CDN regresses, narrow the policy to reddit URLs only or drop the attribute and rely on the decode fix alone.
- **Risk:** fallback HTML fetch in #4 is slow or hangs on JS-heavy pages.
  **Mitigation:** the existing add-post timeout already wraps the whole pipeline call (30s in the API service). The fallback fetch reuses the same signal so it's bounded.
- **Risk:** the og:image regex misses unusual but valid HTML (single quotes, attributes in unusual order).
  **Mitigation:** unit-test the helper against several real-world HTML samples (Anthropic blog, OpenAI blog, a generic medium post). Accept that exotic cases may fail — those pages just get no image, which is the existing behavior.

## Assumptions

- The user's claim that "user-added posts lack image/content/metadata/recap" is satisfied entirely by the image fallback chain (#4). DB inspection shows content, metadata, and recap are already populated correctly when the URL is good.
- We do NOT need to backfill existing `raw_items` rows with `&amp;` URLs — the user's complaint is about new runs, not historical data.
- The `source_type='blog'` naming for user-added posts is acceptable. We will not introduce a new `'web'` source_type.
- Existing 7 commits ahead of `main` (the in-flight UI overhaul) are the correct integration point. The branch will merge into the same line of work.
