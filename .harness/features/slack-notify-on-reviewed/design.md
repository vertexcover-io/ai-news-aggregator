# Slack Notification on Newsletter Reviewed — Design

**Status:** Draft
**Owner:** Aman
**Date:** 2026-05-07
**Spec dir:** `docs/spec/slack-notify-on-reviewed/`

## Problem

When a newsletter run's archive transitions to `reviewed=true` (either via manual `PATCH /api/admin/archives/:runId` or via the pipeline's `AUTO_REVIEW` path), we want a Slack message posted to `#internal-projects` summarizing the run. The message must include:

1. **Per-source link counts** — Twitter list → posts fetched, each subreddit → posts fetched, each web URL → posts fetched.
2. **Final newsletter distribution** — recipient count (subscribers the digest will be sent to).
3. **Data collection errors** — sources that failed/partially failed, error summaries, retry counts.

## Scope

**In scope:**
- A `SlackNotifier` interface + implementation that POSTs to a Slack incoming webhook with Block Kit formatting.
- Hooking the notifier into both review-completion paths (API manual + pipeline AUTO_REVIEW).
- Persisting per-source telemetry to the database at run completion so manual-review notifications (which can fire long after Redis state expires) still have data.
- Env var `SLACK_WEBHOOK_URL` (optional — feature disabled when unset).
- Unit tests for the notifier + integration tests for both hook points.

**Out of scope:**
- Other notification channels (email-to-team, Discord, etc.).
- Re-sending notifications.
- Slack interactivity (buttons, modals) — webhook only, one-way.
- Webhook signing/auth verification — not applicable for outbound webhooks.

## Key Decisions

### D1. Webhook (incoming) vs Bot Token

**Decision:** Use Slack **Incoming Webhook**.

**Rationale:**
- Channel is encoded in the webhook URL — no channel ID config to maintain.
- No token storage (the URL is sensitive but a single secret).
- We do not need to read messages, list channels, or perform any operation outside posting to one channel.
- Bot tokens (`xoxb-...`) require OAuth scopes management and are overkill here.

The user already provided a webhook URL pointing at `#internal-projects`.

### D2. Per-Source Telemetry Persistence

**The problem:** `RunState` lives in Redis with TTL 3600s. Manual review can happen hours/days later — by then the Redis key is gone, so we cannot reconstruct per-source counts at review time.

**Options considered:**

| Option | Pros | Cons |
|--------|------|------|
| A. Read from Redis at review time | Zero schema change | Misses any review > 1h after run |
| B. Persist source telemetry to a new column on `run_archives` | Always available | Schema migration; one extra column |
| C. New `run_source_telemetry` table | Normalized | Overkill for single-row-per-run snapshot |

**Decision:** **Option B** — add a `sourceTelemetry jsonb` column to `run_archives`, populated at archive upsert time (same place where ranked items get written). Manual reviews always have this data; AUTO_REVIEW also reads from it (consistent path).

**Schema shape (TypeScript type stored as JSONB):**
```ts
export interface RunSourceTelemetry {
  sources: SourceTelemetryEntry[];
  totalItemsFetched: number;
  totalErrors: number;
}

export interface SourceTelemetryEntry {
  sourceType: "hn" | "reddit" | "blog" | "twitter";
  // For sources with sub-units (subreddit name, twitter list ID, blog URL),
  // identifier disambiguates them. For HN there is one collector → one entry.
  identifier: string;          // e.g. "r/MachineLearning", "list:1234567890", "https://openai.com/blog/rss"
  displayName: string;         // human-readable for Slack ("r/MachineLearning", "OpenAI Blog", "AI ML List")
  itemsFetched: number;
  status: "completed" | "failed" | "partial";
  errors: string[];            // empty if no errors
  retries: number;             // 0 if not retried
  durationMs: number;
}
```

**`retries`** is **not** currently tracked by collectors. We will:
- Add a `retries` counter to `SourceRunState` (default 0).
- Have collectors (or their HTTP layer) increment it on transient failures retried.
- Acceptable interim behavior: collectors that don't currently retry report 0. This is honest — the message says "0 retries" rather than fabricating data.

### D3. Where the Notification Fires

**Both paths converge on the same helper.** A new function `notifyReviewedArchive(runId, deps)`:

1. Reads the archive row (already in DB at this point).
2. Reads `sourceTelemetry` from the archive row (persisted at run completion).
3. Reads confirmed subscriber count via `SubscribersRepo.listConfirmed().length`.
4. Builds Slack Block Kit payload.
5. POSTs to webhook.
6. Logs success/failure (does **NOT** throw — Slack failures must not fail the review or block send-newsletter enqueueing).

Hook points:
- `packages/api/src/routes/archives.ts` after `enqueueSendNewsletter()` (line ~127).
- `packages/pipeline/src/workers/run-process.ts` inside the `if (archiveWritten && autoReviewed)` block (line ~504-521).

Both pass a `trigger: "manual" | "auto-review"` string included in the message.

### D4. Failure Handling

The Slack notification is **best-effort, side-channel**. If the webhook is down or returns 4xx/5xx:
- Log a structured error (`event: "slack.notify.failed"`, includes runId, status, body).
- **Do NOT** retry inline (would block the review HTTP response or worker).
- **Do NOT** fail the review or the enqueue.

Out-of-scope (deferred): a retry queue for failed Slack notifications. If the user wants resilience later, we can wrap this in a BullMQ job; for now the failure rate of Slack webhooks in practice is negligible.

### D5. Idempotency

If the user re-saves a review (e.g., they edit and PATCH again with `reviewed: true` while it's already true), Slack would fire twice. To prevent this:

- Add a `slackNotifiedAt timestamp` nullable column on `run_archives`.
- The notifier checks: if `slackNotifiedAt` is non-null, skip + log.
- After a successful POST, set `slackNotifiedAt = now()`.

This means **the notification fires exactly once per archive's lifetime**, regardless of how many times reviewed flips. Acceptable: re-edits do not need to re-notify the team.

### D6. Configuration

**Env var:** `SLACK_WEBHOOK_URL` (single value).

If unset:
- The notifier short-circuits at construction time (factory returns a no-op).
- Log a single info line at startup: `slack.notify.disabled`.
- **No error.** This makes the feature opt-in and keeps dev environments clean.

If malformed (doesn't start with `https://hooks.slack.com/`):
- Log a warning at startup. Still attempt to use it (don't second-guess the operator).

## Architecture

### Module Layout

```
packages/shared/
  src/
    slack/
      notifier.ts          # Type definitions, no-op impl, types are exported
      webhook-client.ts    # Pure POST helper (testable)
      message-builder.ts   # Build Block Kit payload from archive + telemetry
      index.ts             # Public exports
  tests/unit/slack/
    message-builder.test.ts
    webhook-client.test.ts
    notifier.test.ts

packages/api/
  src/
    services/
      review.ts            # MODIFIED: call slackNotifier.notifyReviewed() after enqueue
  src/lib/
    slack-provider.ts      # Factory: createSlackNotifier() reading env

packages/pipeline/
  src/
    workers/
      run-process.ts       # MODIFIED: call slackNotifier inside auto-review block
                           # ALSO: write sourceTelemetry to run_archives at upsert time
  src/services/
    source-telemetry.ts    # NEW: builds RunSourceTelemetry from RunState
```

**Rationale for placement in `@newsletter/shared`:** the notifier is used by both api and pipeline. Per CLAUDE.md, shared owns cross-cutting types and code. Slack notifier is exactly that. The `slack-provider.ts` factories live in each package because they read env vars (per existing dotenv-bootstrap convention).

### Public API

```ts
// packages/shared/src/slack/notifier.ts
export interface SlackNotifier {
  notifyReviewedArchive(input: NotifyReviewedInput): Promise<void>;
}

export interface NotifyReviewedInput {
  runId: string;
  trigger: "manual" | "auto-review";
}

export interface SlackNotifierDeps {
  webhookUrl: string | undefined;        // undefined → no-op notifier
  archiveRepo: RunArchivesRepo;
  subscribersRepo: SubscribersRepo;
  logger: pino.Logger;
  fetch?: typeof fetch;                  // injectable for tests
  now?: () => Date;                      // injectable for tests
}

export function createSlackNotifier(deps: SlackNotifierDeps): SlackNotifier;
```

### Slack Message Format (Block Kit)

```
🟢 Newsletter Reviewed — Issue #42 (auto-review)
"AI agents reach state-of-the-art on coding benchmarks"

📊 Sources
  • Hacker News: 23 items
  • r/MachineLearning: 18 items
  • r/LocalLLaMA: 12 items
  • AI ML Twitter List: 47 items
  • OpenAI Blog (RSS): 3 items
  • Anthropic Blog (RSS): 2 items
  Total: 105 items fetched

⚠️ Errors (2)
  • r/singularity: 429 rate limit (3 retries) — partial
  • https://example.com/rss: ENOTFOUND — failed

📬 Distribution
  • Will send to 2 subscribers

🔗 View archive: https://newsletter.vertexcover.io/archive/<runId>
```

When there are zero errors, the **Errors** section is omitted (cleaner). When the URL base for the archive link is unknown (no `PUBLIC_BASE_URL` env), we omit the link line.

### Testing Strategy

| Test | Location | What it asserts |
|------|----------|-----------------|
| `message-builder.test.ts` | shared/tests/unit | Snapshot of Block Kit payload for: full run, run with errors, run with no errors, missing digest headline |
| `webhook-client.test.ts` | shared/tests/unit | POSTs to URL with correct headers; throws on non-2xx; retries 0 times on failure |
| `notifier.test.ts` | shared/tests/unit | No-op when webhookUrl unset; idempotent (skips if slackNotifiedAt set); sets slackNotifiedAt on success; does not throw on webhook failure |
| `archives-route.test.ts` | api/tests/unit | (extend) PATCH triggers slackNotifier.notifyReviewedArchive |
| `run-process.test.ts` | pipeline/tests/unit | (extend) AUTO_REVIEW path triggers notifier; sourceTelemetry persisted to archive |

E2E tests are not required for this feature — the Slack endpoint is external and we mock fetch in unit tests. (Per existing pattern: Resend has only unit tests too.)

## External Dependencies & Fallback Chain

**Declared dependencies (NEW):**

1. **Slack Incoming Webhook (HTTPS POST)** — outbound only, no SDK needed.
   - **Primary:** `fetch` (built-in Node 18+, already used elsewhere)
   - **Fallback chain:** No fallback needed — `fetch` is universal. If we ever need queueing, BullMQ already in the stack.
   - **Verification:** Library probe will POST a hello-world Block Kit message to the user-provided webhook and confirm a `200 ok` response.

**No new package dependencies.** We deliberately avoid `@slack/webhook` because:
- It pulls in `@slack/types` and adds bundle weight for a single POST.
- Block Kit is just JSON; we don't need a wrapper.
- We already have `fetch`.

## Migration Plan

A single Drizzle migration adds two columns to `run_archives`:

```sql
ALTER TABLE run_archives
  ADD COLUMN source_telemetry jsonb,
  ADD COLUMN slack_notified_at timestamptz;
```

Both are nullable. Existing rows have `NULL` for both — the notifier handles `null` `sourceTelemetry` by including a "telemetry unavailable" line for archives created before this feature.

## Risks

| Risk | Mitigation |
|------|------------|
| Webhook URL leaked in logs | Notifier never logs the URL; only logs domain `hooks.slack.com` and status |
| Slack rate-limit (1 msg/sec/webhook) | Realistically we send ≤ a few messages/day; not a concern |
| Blocking the review HTTP response | Notifier is awaited but wrapped in try/catch; failures don't propagate |
| sourceTelemetry mismatch with rankedItems | Both written in the same `archive upsert` transaction (DB-level atomicity) |

## Open Questions (resolved)

- **Q: Does `Final Newsletter Distribution` mean recipient count or post-send delivery counts?**
  - A: Recipient count at review-time. Post-send delivery is out of scope (would require hooking the send worker, additional notifications).
- **Q: Should we include the digest headline?**
  - A: Yes — `archive.digestHeadline` if non-null, otherwise omit that subline.
- **Q: Twitter list display name — list IDs are opaque. Where does the human-readable name come from?**
  - A: From `RunSubmitTwitterConfig.lists[]` in run state — each list has both `id` and `displayName`. The pipeline persists this into `sourceTelemetry.displayName`.

## Acceptance Criteria

1. Posting a manual `PATCH /api/admin/archives/:runId` with `{ reviewed: true }` causes a Slack message in `#internal-projects` (verified via webhook URL).
2. Completing an AUTO_REVIEW pipeline run causes the same Slack message.
3. The message includes per-source counts, errors (if any), and recipient count.
4. Re-saving a reviewed archive does not produce duplicate messages.
5. Setting `SLACK_WEBHOOK_URL` empty or unset disables the feature with a single startup log line and zero errors.
6. Slack webhook failure (e.g., 500 response) is logged but does not fail the review API call or the pipeline worker.
7. `pnpm typecheck` and `pnpm lint` pass with zero errors.
8. New unit tests pass.
