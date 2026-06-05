# Learnings — email-rate-limit-retry

## Learning 1: Library probe can contradict the design doc — trust the probe

The design doc (and original spec) assumed the Resend SDK returns `retry-after` on `result.error`.
The library probe (`docs/spec/email-rate-limit-retry/library-probe.md`) corrected this: in
`resend@6.12.2`, the `retry-after` header is on `result.headers['retry-after']`, not on
`result.error`.

**Impact:** The provider wrapper had to read `result.headers?.['retry-after']` instead of
`result.error.retryAfter`. If the probe had not been run before coding, the feature would have
silently discarded all `retry-after` values and always used exponential backoff — the 429 recovery
would have been slower and the spec promise broken.

**Rule:** When a design doc says "X field comes from Y," run the library probe first. The SDK shape
is authoritative, not the design doc.

---

## Learning 2: Job-queue `concurrency: 1` is the wrong tool for per-recipient rate limiting

The initial spec and plan called for adding `concurrency: 1` to the BullMQ Worker as a
"belt-and-suspenders" guard for the email rate limit. Code review caught the defect: the
processing worker dispatches ALL job types (`run-process`, `daily-run`, `email-send`,
`linkedin-post`, `twitter-post`, `social-health`). Setting `concurrency: 1` would serialize
every job type behind a long-running `run-process` (which can take minutes), delaying email
delivery and social posts.

The correct tool is the **shared module-level pacer** — it serializes the actual send calls
within and across jobs without touching the BullMQ concurrency setting. The pacer's promise chain
ensures all `acquire()` calls from any job in the same process queue on the same token bucket.

**Rule:** When a feature needs per-operation rate limiting inside a job (not per-job), use an
in-process pacer/semaphore, not a queue-level `concurrency` setting. Queue concurrency controls
how many jobs run simultaneously, not how many operations per second a job can perform.

**How it was caught:** The plan doc's own risk section flagged R2 ("concurrency-1 slows unrelated
jobs"), and code review confirmed it. The processing worker's job-type list made the blast radius
clear.
