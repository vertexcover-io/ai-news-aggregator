# SPEC — Slack Notification on Newsletter Reviewed

**Linear:** (to be filed)
**Branch:** `feat/slack-notify-on-reviewed`
**Design doc:** `docs/spec/slack-notify-on-reviewed/design.md`
**Library probe:** `docs/spec/slack-notify-on-reviewed/library-probe.md` (`<!-- LP:VERDICT:PASS -->`)

## Summary

Post a Slack message to `#internal-projects` whenever the daily newsletter has finished sending — i.e. at the end of the `newsletter-send` worker job. The message includes per-source link counts (from telemetry persisted on the archive at run completion), an Errors section (always present; shows "No collection errors" when zero), and actual delivery counts (`Sent to N subscribers` or `Sent to N/M subscribers (F failed)`). The send job is enqueued by both the manual review path (`PATCH /api/admin/archives/:runId`) and the AUTO_REVIEW pipeline path, so both review modes ultimately trigger one Slack notification per archive.

## Functional Requirements

### FR-1. Trigger Point

The notification fires from the **`newsletter-send` worker**, after the send job completes (`packages/pipeline/src/workers/newsletter-send.ts`, after the `newsletter-send.completed` log). This means:

- **Manual review:** `PATCH /api/admin/archives/:runId` enqueues `send-newsletter` → worker delivers emails → fires Slack with actual delivery counts.
- **AUTO_REVIEW:** Pipeline run completion enqueues `send-newsletter` → same worker path → same Slack notification.

A single archive produces exactly one Slack notification (idempotency via `slack_notified_at` on the archive row).

### FR-2. Message Content

The Slack message MUST include:

| Section | Content |
|---------|---------|
| Header | "🟢 Newsletter Sent" |
| Digest | `archive.digestHeadline` if present, otherwise the rank-1 item title; omitted if neither exists |
| Sources | One line per source unit with `displayName` and `itemsFetched`. Total at the end. |
| Errors | **Always present.** When zero errors: "*⚠️ Errors* / • No collection errors". When errors: one line per failed source with error string, retry count, status. |
| Distribution | "Sent to N subscribers" when all delivered; "Sent to N/M subscribers (F failed)" when some failures. Counts come from the send worker. |
| Footer | Archive link if `PUBLIC_BASE_URL` env is set |

### FR-3. Per-Source Telemetry Persistence

A new column `source_telemetry jsonb` on `run_archives` stores the per-source breakdown captured during the run. The pipeline writes this column at the same `archive upsert` point where `rankedItems` is written. The notifier reads this column at notification time (NOT from Redis).

For archives created BEFORE this feature ships, `sourceTelemetry` is `NULL` and the notification omits the **Sources** section in favor of a single line: `Telemetry unavailable (legacy run)`.

### FR-4. Idempotency

A new column `slack_notified_at timestamptz` on `run_archives` is set after a successful Slack POST. If `slackNotifiedAt` is non-null at notification time, the notifier short-circuits with a single log line and does NOT POST.

### FR-5. Failure Mode

The notifier's `notifyReviewedArchive()` MUST NOT throw. On failure (network error, non-200 response, malformed config), it logs structured error and returns. The review API call and pipeline worker proceed normally.

### FR-6. Configuration

- Env var `SLACK_WEBHOOK_URL` is the only required config.
- When unset/empty: notifier is a no-op; one info log at startup.
- When set but malformed (no `https://hooks.slack.com/` prefix): warning logged at startup; notifier still attempts to POST (operator override).

### FR-7. Privacy

The webhook URL MUST NOT appear in any log line. Logs may include only the host (`hooks.slack.com`) and HTTP status code.

## Non-Functional Requirements

- **NFR-1:** No new npm dependencies. Use built-in `fetch`.
- **NFR-2:** All new code under `@newsletter/shared` for cross-package use; provider factories in api/pipeline `src/lib/`.
- **NFR-3:** Existing `pino` logger pattern preserved (`logger.{level}({event, ...ctx}, "human message")`).
- **NFR-4:** Drizzle migration follows project convention (no raw `ALTER TABLE` outside generated migrations).
- **NFR-5:** Slack POST latency added to the manual review HTTP response is < 1s in normal conditions.

## Verification Scenarios

### VS-0 — Library Probe (re-runs from `library-probe.md`)

**VS-0.1** — Webhook accepts Block Kit payload (real POST returns `200 ok`).
**VS-0.2** — Non-200 response handled gracefully (notifier resolves, logs error event).
**VS-0.3** — Webhook URL never logged in plaintext.
**VS-0.4** — Idempotency: `slackNotifiedAt` set → no POST issued.
**VS-0.5** — Disabled: `webhookUrl: undefined` → no POST issued, resolves silently.

### VS-1 — Manual review fires notification

**Given** a run archive exists with `reviewed=false`, `slackNotifiedAt=null`, valid `sourceTelemetry`.
**When** `PATCH /api/admin/archives/:runId` is called with `{ reviewed: true, ...curated_items }`.
**Then**:
- Slack POST is issued exactly once with Block Kit payload.
- `archive.slackNotifiedAt` is set after the POST succeeds.
- HTTP 200 returned to the client even if Slack POST fails.

### VS-2 — AUTO_REVIEW fires notification

**Given** `AUTO_REVIEW=true` and pipeline run completes successfully.
**When** the archive is upserted with `reviewed=true`.
**Then**:
- `sourceTelemetry` is persisted to the archive row.
- Slack POST is issued exactly once after `enqueueSendNewsletter()`.
- Worker completes normally even if Slack POST fails.

### VS-3 — Re-save does not duplicate

**Given** an archive with `slackNotifiedAt` already set.
**When** `PATCH /api/admin/archives/:runId` is called again with `{ reviewed: true, ...edits }`.
**Then**: no Slack POST is issued; one log line `event: "slack.notify.skipped"` recorded.

### VS-4 — Errors-only / errors omitted

**Given** a run with a failed reddit collector and a failed RSS source.
**When** the message is built.
**Then**: the Errors section lists both with their error string and retry count.

**Given** a run with zero collector errors.
**When** the message is built.
**Then**: the Errors section is omitted entirely.

### VS-5 — Legacy archive (pre-migration)

**Given** an archive row with `sourceTelemetry = NULL`.
**When** `notifyReviewedArchive()` runs.
**Then**: the message includes "Telemetry unavailable (legacy run)" instead of the Sources block; the notification still fires.

### VS-6 — Disabled in dev

**Given** `SLACK_WEBHOOK_URL` unset.
**When** the API or pipeline starts.
**Then**: a single info log line `event: "slack.notify.disabled"`; subsequent reviews complete normally without any fetch calls to `hooks.slack.com`.

### VS-7 — Webhook returns 500

**Given** the Slack webhook returns HTTP 500.
**When** `notifyReviewedArchive()` is called.
**Then**:
- Logger records `event: "slack.notify.failed"`, status `500`.
- The function resolves (does not throw).
- `archive.slackNotifiedAt` is NOT set.
- The review HTTP response is 200.

## Out of Scope

- Retrying failed Slack notifications.
- Other notification channels.
- Slack interactivity (buttons, modals).
- Post-delivery telemetry ("delivered to X" — would require hooking the send worker).
- Backfilling `sourceTelemetry` for old archives.

## Acceptance

- All VS-* scenarios pass via unit tests + the live probe.
- `pnpm typecheck` and `pnpm lint` pass with zero new errors.
- A live integration test: trigger a manual review on the staging environment, verify a message appears in `#internal-projects`.
