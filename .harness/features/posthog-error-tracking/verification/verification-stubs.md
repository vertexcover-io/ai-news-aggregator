# Verification Stubs (VS-0) — from library probe

These are folded into spec.md `## Verification Scenarios` and re-run by functional-verify.

### VS-0-posthog-api-surface: Library probe — posthog-node API surface + no-throw
**Type:** api
**Run:**
```bash
cd packages/api && node -e "
const { PostHog } = require('posthog-node');
const p = PostHog.prototype;
const ok = ['captureException','capture','identify','flush','shutdown'].every(m => typeof p[m] === 'function');
if (!ok) { console.error('MISSING METHODS'); process.exit(1); }
const ph = new PostHog('phc_probe_fake', { host: 'https://us.i.posthog.com', flushAt: 1, flushInterval: 0 });
ph.captureException(new Error('vs0'), 'vs0', { probe: true });
ph.capture({ distinctId: 'vs0', event: 'pipeline_run_degraded', properties: { kind: 'probe' } });
ph.shutdown().then(() => { console.log('VS0_OK'); }).catch(() => { console.log('VS0_OK'); });
"
```
**Expected:** prints `VS0_OK`, exit 0 (the `captureException`/`capture` signatures resolve and do not throw synchronously on the installed `posthog-node`).

### VS-0-posthog-live (OPTIONAL — only if POSTHOG_PROJECT_TOKEN set)
**Type:** api
**Run:** capture a synthetic exception against the real project and confirm 200 ingestion.
**Expected:** Skipped/UNTESTABLE when no token; when a token is present, ingestion call returns success.
