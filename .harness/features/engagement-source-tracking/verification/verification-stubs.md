# Verification Stubs (promoted from library-probe)

These VS-0 scenarios are re-run by functional-verify at the end of the pipeline.

### VS-0-posthog-js-utm-capture: Library probe — posthog-js utm_source capture
**Type:** api
**Run:** bash .harness/runtime/engagement-source-tracking/probes/posthog-js/probe-utm-capture.sh
**Expected:** exit 0; stdout JSON has `"ok": true` and `sample.utm_source == "linkedin"`; `sample.$pathname` is the archive path (no query). Proves posthog-js auto-captures `utm_source` from the landing URL onto a `$pageview` with no network egress (event dropped via `before_send`).
