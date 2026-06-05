# Verification Stubs (for spec.md `## Verification Scenarios`)

These are auto-generated from the library probe. functional-verify will
re-run them at the end of the pipeline to catch any drift between probe
time and merge time.

### VS-0a-userauth: Library probe — rettiwt-api list.tweets in user-auth mode
**Type:** api
**Run:** `node docs/spec/add-twitter-x-collector/probes/rettiwt-api/probe-list-tweets-userauth.mjs`
**Pre-req:** `RETTIWT_API_KEY` set in project-root `.env.harness`
**Expected:**
- exit 0
- ≥1 tweet returned
- shape checks pass: `id`, full text, `createdAt`, author handle, `likeCount`
- `payload.sample.json` non-empty

### VS-0a-user-timeline: Library probe — rettiwt-api user.details + user.timeline
**Type:** api
**Run:** `node docs/spec/add-twitter-x-collector/probes/rettiwt-api/probe-user-timeline.mjs`
**Pre-req:** `RETTIWT_API_KEY` set in project-root `.env.harness`
**Expected:**
- exit 0
- handle → numeric id resolution succeeds for `jack` and `sama`
- user.timeline returns ≥1 tweet for each (or warns if account is quiet)
- shape checks pass on returned tweets
- `payload-user-timeline.sample.json` non-empty

### VS-0a-pagination: Library probe — rettiwt-api list.tweets pagination
**Type:** api
**Run:** `node docs/spec/add-twitter-x-collector/probes/rettiwt-api/probe-pagination.mjs`
**Pre-req:** `RETTIWT_API_KEY` set in project-root `.env.harness`
**Expected:**
- exit 0
- page 1 returns ≥1 tweet AND a non-empty cursor
- page 2 returns ≥1 tweet AND is not identical to page 1
- combined unique-tweet count > page 1 count (cursor advanced)
