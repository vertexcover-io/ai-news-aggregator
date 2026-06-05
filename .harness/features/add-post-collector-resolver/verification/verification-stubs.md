# Verification Stubs (from Library Probe)

These scenarios MUST be exercised by `functional-verify` against a live system. They are derived from `library-probe.md`.

## VS-0-1: Twitter Add Post — happy path against live cookie

**Setup:** `.env` has a valid `RETTIWT_API_KEY` (or `social_credentials.twitter_collector` has a row).

**Action:** Open `/admin/review/<some-runId>`, paste `https://x.com/jack/status/20` into the Add Post form, click Add Post.

**Expected:**
- Toast/UI shows pending card, then resolves.
- A new card appears at the bottom of the ranked list with the tweet text (≤80 chars title) and `@jack` author.
- DB: a new `raw_items` row exists with `source_type = 'twitter'`, `external_id = '20'`, `metadata.addedInReview = true`, `metadata.recap` populated.

## VS-0-2: Twitter Add Post — invalid/deleted tweet ID

**Setup:** Same cookie.

**Action:** Add Post with `https://x.com/i/status/1` (returns `undefined` from rettiwt).

**Expected:**
- API responds with non-2xx (502 with message like "Tweet not found, deleted, or protected: 1" — or 404 if route is later upgraded to special-case).
- Frontend shows the error message in the form's error region.
- No new row in `raw_items`.

## VS-0-3: Twitter Add Post — stale CSRF (cookie present, refresh required)

**Setup:** Same cookie that hasn't been used in a while (the production-realistic state).

**Action:** Add Post with `https://x.com/jack/status/20` immediately on cold start.

**Expected:**
- The collector internally refreshes CSRF and retries; the operator-visible result is the same as VS-0-1 (success).
- Log line `collector.twitter.csrf_refresh.completed` appears in the API/pipeline logs.
- If credential source is `db`, the `social_credentials.twitter_collector` row is updated with the rotated `apiKey`.

## VS-0-4: Twitter Add Post — cookie missing entirely

**Setup:** Both `RETTIWT_API_KEY` env and `social_credentials.twitter_collector` row are absent.

**Action:** Add Post with any twitter URL.

**Expected:**
- API responds 502 with message `"Twitter cookies not configured — set them at /admin/settings"` (or similar; the message MUST mention `/admin/settings`).
- Frontend toast/error region displays the message.

## VS-0-5: URL detection coverage

**Action:** Call `detectAddPostSourceType` directly (unit-level — included here for completeness) with:
- `https://x.com/jack/status/20` → `"twitter"`
- `https://twitter.com/jack/status/20` → `"twitter"`
- `https://www.x.com/jack/status/20` → `"twitter"`
- `https://mobile.twitter.com/jack/status/20` → `"twitter"`
- `https://x.com/jack/status/20?ref_src=abc` → `"twitter"`
- `https://x.com/jack/status/20/photo/1` → `"twitter"`
- `https://x.com/jack` → `"web"` (no /status/<id>)
- `https://news.ycombinator.com/item?id=42` → `"hn"` (regression check)
- `https://reddit.com/r/test/comments/abc/foo` → `"reddit"` (regression check)
- `https://example.com/post` → `"web"` (regression check)

## VS-0-6: Regression — HN Add Post still works

**Action:** Add Post with `https://news.ycombinator.com/item?id=1`.

**Expected:** Card added successfully with `source_type = 'hn'`. (Sanity check that the new code path didn't break the existing dispatch.)
