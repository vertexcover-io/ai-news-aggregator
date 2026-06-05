# Skill Spec: /debug-jobs

> Inspect and debug BullMQ job queues backed by Redis. Helps diagnose why pipeline jobs are failing, stuck, or behaving unexpectedly.

---

## What problem does this solve?

The newsletter pipeline runs multiple BullMQ jobs — collectors scraping sources in parallel, then sequential processors (dedup, filter, rank, summarize). When something goes wrong, you need to quickly answer:

- Did the job even run?
- Is it stuck in "active" state?
- Did it fail? What was the error?
- How many retries happened?
- What was the job payload?
- Are there jobs piling up in the queue?

Without this skill, debugging means manually running `redis-cli` commands and knowing BullMQ's internal key structure. This skill abstracts that away.

---

## When should this skill trigger?

- User says "debug jobs", "check the queue", "why is the pipeline stuck", "job failing", "queue status"
- User asks about specific queues by name (e.g., "check the collector queue", "what's in the processing queue")
- User reports that the pipeline ran but no candidates appeared in the database
- User sees a "ready for review" notification never arrived

---

## What should it do?

### 1. Queue Overview

Show a summary of ALL queues in the system:

| Queue | Waiting | Active | Completed | Failed | Delayed |
|-------|---------|--------|-----------|--------|---------|
| collectors | 0 | 2 | 31 | 1 | 0 |
| processors | 3 | 0 | 0 | 0 | 0 |

This gives an instant snapshot of where things stand. If "waiting" is high and "active" is 0, workers probably aren't running. If "failed" is non-zero, something broke.

### 2. Failed Job Details

For each failed job, show:

- **Job ID** and **name** (e.g., `collect-hn`, `collect-reddit`)
- **Error message** and **stack trace**
- **Job payload** (the data passed to the job)
- **Number of attempts** made and **max attempts** configured
- **When it failed** (timestamp)
- **Which attempt** this was (1st try? 3rd retry?)

This is the most important part — failed jobs are the #1 reason someone invokes this skill.

### 3. Stuck Job Detection

Identify jobs that are in "active" state for too long:

- If a job has been "active" for more than 5 minutes (configurable), flag it as potentially stuck
- Show the job details (ID, name, payload, how long it's been active)
- Suggest remediation: is the worker process dead? Did it crash mid-job?

### 4. Job History

For a specific queue or job name, show the last N completed jobs:

- **Job name**, **duration** (how long it took to process), **result** (if any)
- **Timestamp** of completion
- Useful for checking if jobs ran successfully today vs yesterday

### 5. Queue Health Check

Run a quick health assessment:

- Is Redis reachable?
- Are workers registered and consuming from queues?
- Are there any stale/zombie connections?
- Is memory usage on Redis reasonable?
- Are there any queues with jobs piling up faster than they're being processed?

### 6. Job Actions

After diagnosing, the skill should be able to:

- **Retry a specific failed job** — re-enqueue it
- **Retry all failed jobs** in a queue
- **Drain a queue** — remove all jobs (waiting, delayed, failed) — ask for confirmation first
- **Remove a specific job** by ID

Always confirm destructive actions (drain, remove) before executing.

---

## Input

The skill can be invoked with optional arguments:

- `/debug-jobs` — show the full queue overview
- `/debug-jobs <queue-name>` — show details for a specific queue
- `/debug-jobs failed` — show all failed jobs across all queues
- `/debug-jobs <job-id>` — show full details for a specific job

---

## How it works under the hood

The skill should use the **Redis MCP** to query BullMQ's internal key structure. BullMQ stores data in Redis with keys like:

- `bull:<queue-name>:waiting` — list of waiting job IDs
- `bull:<queue-name>:active` — list of active job IDs
- `bull:<queue-name>:completed` — set of completed job IDs
- `bull:<queue-name>:failed` — set of failed job IDs
- `bull:<queue-name>:<job-id>` — hash with job data, status, error, attempts

If the Redis MCP is not available, fall back to `redis-cli` commands via Bash.

---

## Output format

- Use tables for overview/summary data
- Use code blocks for error messages and stack traces
- Use bullet points for health check results
- Always show timestamps in human-readable format (e.g., "2 minutes ago", "today at 14:32")
- Color-code or flag severity: failed jobs are critical, stuck jobs are warnings, everything else is info
