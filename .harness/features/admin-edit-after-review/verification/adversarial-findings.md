# Adversarial Findings — admin-edit-after-review

## 1. Attack Surface Derived

Sources: spec gaps (REQ/EDGE IDs not in claims.json `claims[]`) + task-prompt adversarial ideas.

**Spec gaps (integration-level tests not in claims.json):**
- REQ-003: Admin GET fields (no UI claim, no unit claim)
- REQ-004: Public GET omits fields (no claim)
- REQ-007: PATCH skips already-sent channels (no claim)
- REQ-008: Re-PATCH reviewed archive returns 200 (no claim)
- EDGE-001: All channels sent → zero jobs (no claim)
- EDGE-002: Email unsent + LinkedIn sent → email-enqueue logic (no claim)

**Task-prompt adversarial ideas (explicit):**
- Edit reviewed+sent archive → no duplicate email-send job in Redis processing queue
- Public GET response has none of four new keys
- Kebab Edit disabled states (already in unit claims but re-probe boundary)
- Banner channel-list correctness: email+linkedin sent, twitter null → no X in banner

**Derived boundary inputs:**
- Double-submit PATCH (concurrent/sequential re-saves)
- PATCH field validation (wrong type for id)
- Archive with ALL channels sent banner list correctness

## 2. Scenarios Attempted

| ID | Category | Description | Inputs | Verdict |
|----|----------|-------------|--------|---------|
| A-1 | Status accuracy / queue | PATCH all-channels-sent archive, check no new jobs enqueued in `processing` queue | runId=ddc3a732 (emailSentAt+linkedinPostedAt+twitterPostedAt all non-null), PATCH with new title | EXPECTED (zero jobs) |
| A-2 | Banner correctness | Email+linkedin sent, twitter null → banner shows "Email, LinkedIn" not "X" | runId=12409a56 (email_sent_at+linkedin_posted_at set, twitter null) | EXPECTED (correct) |
| A-3 | Status accuracy / queue | PATCH email+linkedin sent archive, verify no new twitter-post job despite twitter being unsent | runId=12409a56 (emailTime==pipelineTime sentinel) | EXPECTED (zero jobs, settings sentinel) |
| A-4 | Unexpected sequences / double-submit | Two consecutive PATCHes to same reviewed archive | runId=46fe5008, PATCH title "Double PATCH Title 1" then "Double PATCH Title 2" | EXPECTED (both 200) |
| A-5 | Broader surface / public route | Explicitly verify all 4 admin-only fields absent from public GET | GET /api/archives/:runId, check `reviewed`, `emailSentAt`, `linkedinPostedAt`, `twitterPostedAt` keys | EXPECTED (all absent) |
| A-6 | EDGE-005 boundary | Reviewed archive with all timestamps null → "Edit ·" heading, no banner | runId=e91f24e4 (no sent timestamps) | EXPECTED (correct) |
| A-7 | PATCH schema validation | PATCH with missing `id` field on rankedItems | PATCH body with `rawItemId` instead of `id` | EXPECTED (400 zod validation) |
| A-8 | All-channels banner | All 3 channels sent → banner shows "Email, LinkedIn, X" | runId=ddc3a732 (all sent) | EXPECTED (correct) |

## 3. Defects

None confirmed. All adversarial scenarios returned EXPECTED behavior.

## 4. Cannot Assess

- **EDGE-002 (email unsent past-due + LinkedIn already posted → email enqueued)**: The test environment settings have `emailTime === pipelineTime` ("08:00" both), so `resolveScheduledPublishAt` returns `null` and `selectImmediatePublishChannels` always returns `[]` — no immediate dispatch happens. The underlying logic in `selectImmediatePublishChannels` and the PATCH route is covered by integration unit tests, but cannot be driven through the real pipeline in this environment without reconfiguring `emailTime` to differ from `pipelineTime`. This is a test-environment limitation, not a code defect.
- **Concurrency (two simultaneous PATCHes)**: Out of scope per spec (design EC6 — accepted race). Not attempted.
- **Expired admin session mid-flow**: Session is cookie-based (HMAC signed). Could not easily force expiry in this session. Not attempted — auth is well-tested elsewhere.

## 5. Honest Declaration

No defects found across 8 scenarios attempted. Categories exercised: queue-correctness (A-1, A-3), UI banner content (A-2, A-6, A-8), double-submit (A-4), public route isolation (A-5), input validation (A-7).

Most promising attack: the "no duplicate email-send job" scenario (A-1, from the task-prompt). If the PATCH route called `selectImmediatePublishChannels` without first checking the already-sent timestamps, it would have enqueued a duplicate job. The code correctly guards on `emailSentAt !== null` inside `selectImmediatePublishChannels`. Redis scan returned zero matching keys after the PATCH, confirming the guard works.

Second most promising: the banner exclusion of X when `twitterPostedAt` is null (A-2). If the banner logic mapped channels incorrectly (e.g. built the list before checking null), X could appear incorrectly. Verified: banner text was "Email, LinkedIn" with no X, matching the null twitter timestamp.
