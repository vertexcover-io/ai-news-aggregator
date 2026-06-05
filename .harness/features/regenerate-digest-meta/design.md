# Design: Regenerate Digest Meta on Review Page

## Problem

The digest-level fields `headline`, `summary`, `hook`, `twitterSummary` are generated **once**, during the
stage-2 rerank LLM call (`packages/pipeline/src/processors/rank.ts`), as part of the same `generateObject`
response that produces the ranked ordering and per-story recaps. They are persisted to `run_archives`
columns `digest_headline`, `digest_summary`, `hook`, `twitter_summary`.

During manual review (`/admin/review/:runId`), the operator can reorder, remove, add posts, and inline-edit
per-story recap fields. But the four digest meta fields are frozen at their rank-time values — they do not
reflect the operator's curation. A heavily-edited ranked list ships with a headline written for the original
LLM ordering. These fields feed real surfaces: `headline`/`summary` drive the public archive listing + detail
+ search FTS; `hook` is the LinkedIn post body; `twitterSummary` is the X post body (falls back to `hook`).

## Goal

Add a control on the review page that, in one click, regenerates `{ headline, summary, hook, twitterSummary }`
from the **current** ranked items (post-curation, including edits/reorders/removals). The four values become
**editable** text fields in the UI, persist with the review save, and survive reload. When **auto-review** is
enabled, the existing rank-time generation + save is unchanged.

## User-confirmed decisions

1. **Regen behavior:** Always overwrite all four fields with fresh LLM output (operator can re-edit after).
2. **Persistence:** Persist as part of `PATCH /api/admin/archives/:runId`, alongside the `rankedItems` overrides.
3. **Field scope:** All four are digest-level, stored on `run_archives` (`digest_headline`, `digest_summary`,
   `hook`, `twitter_summary`). Confirmed by codebase inspection — no per-item involvement.
4. **LLM reuse:** Extract the digest-meta generation into a reusable, digest-only function + shared prompt
   block, exposed via a new admin endpoint. Guarantees parity with auto-review output.

## Current state (verified against code)

- **Generation:** `rank.ts:78-83` `digestSchema`; `rank.ts:230-254` `generateRanked`; `rank.ts:380-383` extracts
  the four fields into `RankResult`.
- **Digest prompt text:** lives inline in `DEFAULT_RANKING_PROMPT` (`packages/shared/src/constants/ranking-prompt.ts:82-101`).
- **Persistence (pipeline):** `RunArchiveUpsertInput` (`packages/pipeline/src/repositories/run-archives.ts:16-34`)
  carries `hook` / `twitterSummary`; `upsert` writes all four (insert + onConflictDoUpdate).
- **Schema:** `packages/shared/src/db/schema.ts:62-65` — `digest_headline`, `digest_summary`, `hook`, `twitter_summary` (all `text`, nullable).
- **Review save route:** `PATCH /api/admin/archives/:runId` (`packages/api/src/routes/archives.ts:201-270`),
  body validated by `archivePatchSchema` (`packages/api/src/lib/validate.ts:383-402`) — currently accepts ONLY
  `rankedItems[]` with per-item recap overrides. **Does not touch digest meta.**
- **Web review page:** `packages/web/src/pages/ReviewPage.tsx`; `AddPostPanel` renders ~line 250; `ReviewList`
  immediately after. "Below Add a post" = after the AddPostPanel block.
- **Web API client:** `packages/web/src/api/archives.ts` — `PatchArchiveBody` (lines 8-18), `patchArchive` (64-76).
- **Consumers:** `hook` → LinkedIn body (`social/linkedin/notifier.ts`), `twitterSummary` → X body with `hook`
  fallback (`social/twitter/notifier.ts`, `social/compose.ts`).
- **twitterSummary length cap:** `TWITTER_SUMMARY_MAX_CHARS = 180` (`rank.ts:34`), with a one-shot retry if over.

## Approach

### 1. Shared digest-only generator (pipeline)

Extract the digest instruction block currently embedded in `DEFAULT_RANKING_PROMPT` into a named, exported
constant `DIGEST_META_INSTRUCTIONS` in `@newsletter/shared/constants` and reference it from the ranking prompt
(no behavior change to the existing prompt text — same string, just composed). Add a new pure-ish processor
function in pipeline:

```
generateDigestMeta(items: DigestMetaInput[], options): Promise<DigestMeta>
```

- Input: the **current ranked items** in order — minimally `{ rank, title, summary, bottomLine }` (the curated,
  possibly-edited recap fields). No re-ranking, no body loading — this is a digest-only synthesis call.
- LLM call: `generateObject` with `digestSchema` (the existing 4-field zod schema, also moved to shared so the
  API can validate the response shape) + `DIGEST_META_INSTRUCTIONS` as system prompt + the items as the user
  prompt. Reuse the `TWITTER_SUMMARY_MAX_CHARS` over-budget retry behavior.
- Cost tracked under a `digest` stage via the existing `CostTracker` (optional `tracker` param), consistent
  with the other LLM call sites.

This is consumed by the new API endpoint. The existing rerank path is **unchanged** — it still produces the
digest inline during ranking (so auto-review keeps working exactly as today). The shared constant is the only
thing the two paths now have in common.

### 2. New admin endpoint (API)

`POST /api/admin/archives/:runId/regenerate-digest-meta` (admin-gated, mirrors other `/api/admin/archives/*`):

- Loads the archive's current ranked items (hydrated, so edits already saved are reflected). For unsaved
  in-progress edits, the **client sends the current ranked item set in the request body** so regeneration runs
  against exactly what the operator sees (not just last-saved state).
- Calls `generateDigestMeta(...)` (invoked **per request**, reading the live ranking prompt/model — no cached
  deps, honoring the "takes effect without restart" project convention).
- Returns `{ headline, summary, hook, twitterSummary }` — **does NOT persist**. Persistence happens on the
  subsequent review save (decision #2). This keeps regenerate idempotent and lets the operator edit before saving.
- 404 if run not found; 409 if dry-run / not in a reviewable state; 502 on LLM failure with a typed message.

### 3. Extend review save (API + schema)

Add four optional fields to `archivePatchSchema`: `digestHeadline`, `digestSummary`, `hook`, `twitterSummary`
(each `string` nullable/optional, with a max length; `twitterSummary` ≤ `TWITTER_SUMMARY_MAX_CHARS` is **not**
hard-enforced server-side to avoid blocking a manual edit, but the UI shows a counter). The `patchArchive`
service writes these to the `run_archives` columns when present, leaving them untouched when absent (so older
clients / saves that don't send them don't wipe existing values). Mirror the writer in the API run-archives
repository (currently only the pipeline repo writes these columns).

### 4. Web UI (web)

Below `AddPostPanel` in `ReviewPage.tsx`, add a `DigestMetaPanel` component:

- Four labeled, editable fields: Headline (input), Summary (textarea), Hook (textarea, ≤140 char counter),
  Twitter Summary (textarea, ≤180 char counter).
- A **"Regenerate"** button that calls the new endpoint with the current ranked set, then overwrites all four
  field values with the response (decision #1 — always overwrite). Loading + error states.
- Field values are held in the review page's form state and included in the `patchArchive` body on Save.
- Initial values seed from the archive's existing `digestHeadline`/`digestSummary`/`hook`/`twitterSummary`
  (the detail/review API response must expose them — verify the review hydration payload includes them; add if
  missing, admin-only).

## External Dependencies & Fallback Chain

No **new** external dependencies. The feature reuses the already-vetted, in-stack libraries:

| Dependency | Use | Already in stack? | Fallback |
|-----------|-----|-------------------|----------|
| `ai` (Vercel AI SDK) `generateObject` | digest-only LLM call | Yes — used by `rank.ts`, `recap.ts`, `shortlist.ts` | None needed (core ranking dep; if it fails, ranking is already broken) |
| `@ai-sdk/anthropic` | Anthropic model binding | Yes — same call sites | None needed |
| `zod` | validate LLM digest response + API request body | Yes — used everywhere for both | None needed |
| Hono | new route handler | Yes — the API framework | None needed |
| react-query + react-hook-form | UI mutation + field state | Yes — used across the web app | None needed |

**Library-probe applicability:** The only external service touched is the Anthropic API via the AI SDK, which
is already exercised by the existing rank/recap/shortlist call sites and validated by their tests. The new code
introduces no new SDK surface, no new auth, no new endpoint shape — it calls `generateObject` with the same
`digestSchema` that ranking already uses successfully every run. Therefore library-probe is **NOT_APPLICABLE**
for new dependencies; the AI SDK digest-call shape is already proven in production by the rerank path.

## Out of scope

- Re-ranking or re-summarizing individual stories (this regenerates only the 4 digest-level fields).
- Changing auto-review behavior (explicitly preserved).
- Persisting on the regenerate call itself (persistence is on Save, per decision #2).
- Adding digest meta to public archive routes (these fields' public exposure is unchanged).
