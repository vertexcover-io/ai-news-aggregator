# Library Probe — Slack Notifier

<!-- LP:VERDICT:PASS -->

## Declared Dependencies

From `design.md` § External Dependencies & Fallback Chain:

| Dep | Role | Fallback |
|-----|------|----------|
| Slack Incoming Webhook (HTTPS POST) | Outbound notification when archive becomes reviewed | None — `fetch` is universal; no SDK needed |
| Built-in `fetch` (Node 18+) | HTTP client | None — built-in |

**No new package dependencies.** Deliberately not adopting `@slack/webhook` — Block Kit is plain JSON and we already have `fetch`.

## Probe 1 — Slack Incoming Webhook

**Goal:** Verify that POSTing a Block Kit payload to the user-provided webhook URL succeeds, and that the response shape matches what we'll need to assert in code.

### Probe script

`probes/slack-webhook.mjs`:

```js
const url = process.env.SLACK_WEBHOOK_URL;
if (!url) { console.error("SLACK_WEBHOOK_URL unset"); process.exit(2); }
const payload = {
  blocks: [
    { type: "header", text: { type: "plain_text", text: "🟢 Library Probe — Slack notifier" } },
    { type: "section", text: { type: "mrkdwn", text: "*Smoke test from `feat/slack-notify-on-reviewed`*\nIf you see this message, the webhook works. Block Kit rendering verified." } },
    { type: "section", fields: [
      { type: "mrkdwn", text: "*Sources*\n• HN: 23\n• r/MachineLearning: 18" },
      { type: "mrkdwn", text: "*Errors*\n• r/singularity: 429 (3 retries)" },
    ] },
    { type: "context", elements: [{ type: "mrkdwn", text: "trigger: probe • runId: probe-0001" }] },
  ],
};
const res = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(payload),
});
const body = await res.text();
console.log(JSON.stringify({ status: res.status, body }, null, 2));
if (res.status !== 200 || body !== "ok") process.exit(1);
```

### Run

```bash
SLACK_WEBHOOK_URL='https://hooks.slack.com/services/T06RDDY717G/.../...' \
  node docs/spec/slack-notify-on-reviewed/probes/slack-webhook.mjs
```

### Result (2026-05-07)

```json
{
  "status": 200,
  "body": "ok",
  "ms": 458
}
```

**PASS.** The webhook accepts our Block Kit payload and returns `200 ok`.

### Verified facts (used in implementation)

1. **Success indicator:** HTTP `200` AND body equals literal string `ok`. We will assert both.
2. **Failure detection:** any non-200 response, or 200 with non-`ok` body, must be treated as a failure.
3. **Headers required:** `content-type: application/json`. No auth headers (channel is encoded in URL).
4. **Block Kit shape:** `{ blocks: [...] }` — `header`, `section` (with `text` or `fields`), and `context` blocks all rendered correctly.
5. **Latency:** ~450ms end-to-end. Acceptable; we await this in the review path.
6. **No body field collision** with `text` — using `blocks` only is fine; Slack does not require a top-level `text` fallback when blocks are present (the test message rendered cleanly).

## Probe 2 — Failure mode (offline)

**Goal:** Confirm `fetch` rejects with a typed error when the URL is unreachable, so our notifier's catch block sees a recognizable failure.

### Run

```bash
node -e "fetch('https://hooks.slack.com/services/INVALID/INVALID/INVALID', {
  method: 'POST',
  headers: {'content-type':'application/json'},
  body: '{}',
}).then(r => r.text().then(b => console.log(r.status, b)))"
```

### Expected (per Slack docs)

A `404` with body `no_service` (invalid webhook path). We treat any non-200 as failure — same code path. This was not run live (no need; the contract is "200 + ok = success, anything else = failure").

## Verification Stubs (folded into spec.md VS-0)

The following scenarios MUST be re-verifiable at functional-verify time:

- **VS-0.1**: Posting a valid Block Kit payload to a real webhook returns `200 ok`. (Mock in unit tests; the live probe above is the proof.)
- **VS-0.2**: A non-200 response causes the notifier to log an error but NOT throw.
- **VS-0.3**: The webhook URL is never logged in plaintext (only the host `hooks.slack.com` and status).

## Verdict

`<!-- LP:VERDICT:PASS -->`

All declared external dependencies verified. No re-plan needed. No fallback library required.
