# add-post-collector-resolver

**Title:** Add Post — Twitter/X Collector Resolver
**Verdict:** ✅ PASSED (see [`verification/proof-report.md`](./verification/proof-report.md))
**PR:** _(filled in after open)_

## Summary

Extends the admin "Add Post" feature on `/admin/review/:runId` so that pasting a Twitter/X status URL fetches the single tweet via `rettiwt-api` (already in the repo, used by the bulk Twitter collector), persists it as a `raw_items` row with `source_type = 'twitter'`, and surfaces it on the review page exactly like an HN or Reddit add. The user's task description assumed HN was missing — it wasn't; the actual gap was Twitter only. Web search is explicitly excluded from add-post (link-based feature).

## Artifacts

| File | What it is |
|---|---|
| [`design.md`](./design.md) | Brainstorm output — problem, approaches, chosen approach, fallback chain |
| [`library-probe.md`](./library-probe.md) | Live verification that `rettiwt.tweet.details(id)` works (after CSRF refresh) and the response shape matches what `denormalize()` expects |
| [`spec.md`](./spec.md) | 16 REQs in EARS format + verification matrix |
| [`plan.md`](./plan.md) | Single-phase implementation plan |
| [`verification/proof-report.md`](./verification/proof-report.md) | 6/6 VS-0 scenarios passed (4 against live Twitter API, 2 via unit suite) |
| [`verification/adversarial-findings.md`](./verification/adversarial-findings.md) | Step 5 role-swap pass — no new defects |
| [`verification/live-probe.log`](./verification/live-probe.log) | Captured output from the live integration probe |
| [`learnings.md`](./learnings.md) | 6 generalisable learnings (most notable: verify user assumptions before scoping, symlink-vs-tracked-file trap) |

## Library selection

`rettiwt-api@7.0.3` — selected, verified.

Alternatives considered (per [`library-probe.md`](./library-probe.md) and `design.md` fallback chain):
1. **Primary:** `rettiwt-api` (already in `dependencies`, reused from bulk collector).
2. **If cookies break:** typed actionable 502 error to the operator, telling them to rotate at `/admin/settings`.
3. **Long-term build-our-own:** swap inner client to the paid X API v2 `GET /2/tweets/:id` endpoint with the same outer contract. Not exercised in this spec.

## Key implementation details

- `parseTweetIdFromUrl(url)` recognises `x.com`, `twitter.com`, `mobile.twitter.com`, `www.*.com` with `/status/<digits>` (trailing `/photo/N`, `?ref_src=…`, `#m` accepted).
- `fetchTwitterPost(url, deps)` resolves cookies **per-call** via `resolveTwitterCollectorCookie` (DB-first / env-fallback), refreshes CSRF + retries once on mismatch, and throws typed actionable errors for: missing cookies, auth failure, tweet not found.
- The dispatcher in `add-post-helper.ts::detectAddPostSourceType` checks Twitter first, then HN, then Reddit, then web fallback.
- No DB migration (`source_type = 'twitter'` already valid).
- No UI change (the existing `AddPostPanel` form accepts any URL).
