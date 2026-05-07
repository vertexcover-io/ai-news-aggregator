// Slack incoming webhook smoke probe.
// Run: SLACK_WEBHOOK_URL=... node docs/spec/slack-notify-on-reviewed/probes/slack-webhook.mjs
//
// PASS = HTTP 200 AND response body equals "ok".
const url = process.env.SLACK_WEBHOOK_URL;
if (!url) {
  console.error("SLACK_WEBHOOK_URL unset");
  process.exit(2);
}
const payload = {
  blocks: [
    {
      type: "header",
      text: { type: "plain_text", text: "🟢 Library Probe — Slack notifier" },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*Smoke test from `feat/slack-notify-on-reviewed`*\nIf you see this message, the webhook works.",
      },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: "*Sources*\n• HN: 23\n• r/MachineLearning: 18" },
        { type: "mrkdwn", text: "*Errors*\n• r/singularity: 429 (3 retries)" },
      ],
    },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: "trigger: probe • runId: probe-0001" }],
    },
  ],
};
const t0 = Date.now();
const res = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(payload),
});
const body = await res.text();
const result = { status: res.status, body, ms: Date.now() - t0 };
console.log(JSON.stringify(result, null, 2));
if (res.status !== 200 || body !== "ok") process.exit(1);
