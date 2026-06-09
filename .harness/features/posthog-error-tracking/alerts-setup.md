# PostHog Alert Configuration Runbook

**Project:** AI Newsletter (Vertexcover)
**PostHog project token:** the existing `POSTHOG_PROJECT_TOKEN` environment variable — no new token or credential is needed.
**Important:** all alert changes are UI-only. No code deploy is required to add, edit, or delete alerts.

---

## Alert 1: Issue Created or Reopened → Slack

This alert fires whenever PostHog creates a new exception group (i.e., a new class of error is seen for the first time) **or** an already-resolved exception group recurs.

### Steps

1. Open your PostHog project dashboard and navigate to **Error Tracking** in the left sidebar.
2. Click the **Alerts** tab (top of the Error Tracking section).
3. Click **New alert**.
4. Set **Trigger** to `Issue created or reopened`.
5. Under **Destination**, select **Slack**.
6. Choose the Slack connection (or create one via **Add Slack connection** — authorize PostHog's Slack app and select the target channel, e.g. `#alerts-newsletter`).
7. Optionally add a descriptive name such as `Newsletter — new/reopened exception`.
8. Click **Save**.

**Effect:** The team is notified in Slack the moment a new exception class appears in production, or a previously resolved one comes back.

---

## Alert 2: Spike Detection → Slack

This alert fires when PostHog detects an abnormal spike in exception volume (statistical anomaly detection over the rolling window).

### Steps

1. In **Error Tracking → Alerts**, click **New alert**.
2. Set **Trigger** to `Spike detection` (sometimes labelled `Exception volume spike`).
3. PostHog auto-computes the baseline; no manual threshold is required.
4. Under **Destination**, select **Slack** and pick the same channel used above (e.g. `#alerts-newsletter`).
5. Name the alert `Newsletter — exception spike` for clarity.
6. Click **Save**.

**Effect:** A sudden surge of exceptions (e.g., a bad deploy causing repeated 500s) triggers an immediate Slack notification before the issue count climbs high enough to show up as separate grouped issues.

---

## Alert 3: `pipeline_run_degraded` Insight Alert → Slack

This alert fires when the custom `pipeline_run_degraded` event appears at least once in a given time window, ensuring domain-level degradation (enrichment failure rate, zero-yield sources, partial publish) pages the operator just like exceptions do.

### Steps

1. Navigate to **Insights** in the PostHog left sidebar.
2. Click **New insight** → choose **Trends**.
3. In the event selector, type `pipeline_run_degraded` and select it.
4. Set the time window to **1 hour** (or the shortest available rolling window; PostHog calls this the "run window").
5. Save the insight with the name `Pipeline run degraded — count`.
6. With the insight open, click **Alerts** (bell icon, top-right of the insight panel) → **New alert**.
7. Set **Condition** to `Value is greater than or equal to` **1**.
8. Under **Destination**, select **Slack** and pick the alert channel (e.g. `#alerts-newsletter`).
9. Name it `Newsletter — pipeline_run_degraded`.
10. Click **Save alert**.

**Effect:** Any pipeline run that produces at least one degradation finding (e.g., enrichment failure rate above 30%, a source yielding zero items, or a partial publish) immediately notifies the operator via Slack.

---

## Notes

- All three alerts use the **same PostHog project** that `POSTHOG_PROJECT_TOKEN` points to — no second project or token is involved.
- Slack connection setup (OAuth) is a one-time step; subsequent alerts reuse the same connection.
- To edit or silence an alert, go to **Error Tracking → Alerts** (for alerts 1–2) or the saved insight's alert panel (for alert 3) and update or delete the alert there — no code change or redeploy needed.
- PostHog alert delivery uses PostHog's own routing; no `AlertDispatcher` or sweep worker is implemented in this codebase.
