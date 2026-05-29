# Queue `concurrency: 1` is the wrong tool for per-operation rate limiting inside a job

When a job needs to pace individual operations (e.g., send N emails at ≤3/s), the fix is an
**in-process pacer** — not a BullMQ/Celery/Sidekiq worker `concurrency: 1` setting.

## What bit us

The `email-rate-limit-retry` feature initially added `concurrency: 1` to the BullMQ Worker as a
"belt-and-suspenders" rate guard for per-recipient email sends. Code review caught the defect:
the processing worker handles ALL job types (`run-process`, `daily-run`, `email-send`,
`linkedin-post`, `twitter-post`, `social-health`). Setting `concurrency: 1` would have serialized
every job type behind a long-running `run-process` (which takes minutes), delaying email delivery
and social posts — a correctness regression unrelated to the email rate problem.

The correct fix was a shared module-level `SendPacer` singleton. Its internal promise chain
serializes all `acquire()` calls from any job in the same process, regardless of BullMQ concurrency.

## The distinction

| Tool | What it controls | Right use case |
|------|-----------------|----------------|
| Queue `concurrency: 1` | How many **jobs** run simultaneously | Prevent two of the SAME job from running in parallel (e.g., a migration job); never use on a worker that dispatches multiple job types |
| In-process pacer/semaphore | How many **operations per second** run within a job | Per-recipient sends, API calls, crawl requests — anything where throughput inside a job must be rate-limited |

## Rule

1. Before adding `concurrency: 1` to a BullMQ Worker, list every job type it dispatches. If the
   worker handles more than one job type, `concurrency: 1` is almost certainly wrong — it will
   serialize unrelated jobs.
2. For per-operation rate limiting (N ops/second), use an in-process token bucket / pacer shared
   across all invocations of the relevant job. The pacer's acquire-queue serializes operations
   without affecting BullMQ's ability to schedule other job types.
3. Write a test that asserts the worker's `concurrency` option is NOT 1 if the worker is a
   multi-type dispatcher — this makes the intent explicit and prevents a well-meaning future
   change from re-introducing the problem.

## Heuristic

If your design doc says "pin concurrency to 1 for rate limiting" and the worker's `switch` block
has more than two cases, the design is wrong. The right question is: "What am I rate-limiting —
the whole job queue, or operations inside one job type?" If the answer is operations, use a pacer.
