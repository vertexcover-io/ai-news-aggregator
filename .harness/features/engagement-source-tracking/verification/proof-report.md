# Verification Proof Report: engagement-source-tracking

**Date:** 2026-06-09
**Branch:** feature/engagement-source-tracking
**Spec:** .harness/features/engagement-source-tracking/spec.md
**Claims:** 11 executed / 11 passed / 0 failed (claims.json)

---

## Scope and Rationale for Test Strategy

This feature introduces:
1. A pure shared helper `withUtmSource(url, source)` in `@newsletter/shared/utils`.
2. Pipeline notifiers (email, linkedin, twitter) that call `withUtmSource` to tag archive URLs before posting.

**Web UI is unchanged.** The archive page at `/archive/:runId` passes through `?utm_source` transparently — the React route renders identically with or without the param. `ui_claims = 0` for this feature.

**Live PostHog + browser round-trip is not feasible** in the local CI/worktree environment (PostHog is disabled when `PUBLIC_POSTHOG_KEY` is absent and no PostHog project is configured for local dev). The capture evidence is instead provided by the VS-0 probe (see below), which uses the real `posthog-js` browser library under jsdom with `before_send: () => null` to intercept events before any network call. This is the canonical REQ-007 proof.

---

## VS-0 Probe: posthog-js utm_source Capture (REQ-007)

**Command:** `bash .harness/runtime/engagement-source-tracking/probes/posthog-js/probe-utm-capture.sh`

**Result:** PASS

**Stdout:**
```json
{
  "ok": true,
  "sample": {
    "event": "$pageview",
    "utm_source": "linkedin",
    "$current_url": "https://newsletter.vertexcover.io/archive/3f9a2c1e-7b4d-4e2a-9c10-aaaabbbbcccc?utm_source=linkedin",
    "$pathname": "/archive/3f9a2c1e-7b4d-4e2a-9c10-aaaabbbbcccc"
  }
}
```

**Stderr:** `PROBE OK: utm_source captured as linkedin`

**Confirmation:**
- `ok: true` — event with `utm_source` was captured.
- `sample.utm_source == "linkedin"` — REQ-007 criterion met.
- `sample.$pathname == "/archive/3f9a2c1e-7b4d-4e2a-9c10-aaaabbbbcccc"` — bare archive path, no query string in pathname.
- No network egress — event dropped via `before_send: () => null`.

---

## EDGE-004: Direct Visit (no utm_source) → No utm_source on Event

**Probe:** `.harness/runtime/engagement-source-tracking/probes/posthog-js/probe-no-utm.mjs`
**Landing URL:** `https://newsletter.vertexcover.io/archive/3f9a2c1e-7b4d-4e2a-9c10-aaaabbbbcccc` (no query)

**Result:** PASS

```json
{
  "ok": true,
  "capturedCount": 2,
  "sample": {
    "event": "$pageview",
    "utm_source": "(absent)",
    "$current_url": "https://newsletter.vertexcover.io/archive/3f9a2c1e-7b4d-4e2a-9c10-aaaabbbbcccc"
  }
}
```

Direct visits produce no `utm_source` property — PostHog will bucket them as `(none)`.

---

## Unit Test Suite Results

### @newsletter/shared — utm.test.ts (7 tests)
All 7 tests passed:
- `test_REQ_001_withUtmSource_sets_source_param`
- `test_REQ_002_UtmSource_type_is_fixed_set`
- `test_REQ_006_withUtmSource_preserves_path_and_query`
- `test_REQ_008_link_build_never_throws_when_analytics_off`
- `test_EDGE_001_trailing_slash_base_single_param`
- `test_EDGE_002_existing_query_preserved`
- `test_EDGE_005_absolute_base_always_valid_url`

Suite totals: 388 tests / 388 passed.

### @newsletter/pipeline (REQ-003 through REQ-005, EDGE-003)
- `test_REQ_003_email_archive_links_tagged_email` — email-render.test.ts: PASS
- `test_EDGE_003_external_item_links_untagged` — email-render.test.ts: PASS (story.url appears without ?utm_source)
- `test_REQ_004_linkedin_url_tagged_linkedin` — linkedin notifier.test.ts: PASS
- `test_REQ_005_twitter_url_tagged_twitter` — twitter notifier.test.ts: PASS

Suite totals: 1133 tests / 1133 passed.

---

## Quality Gate Results

| Check | Baseline | Current | Delta | Status |
|-------|----------|---------|-------|--------|
| typecheck | exit 0 | exit 0 | — | PASS |
| lint errors | 1 (pre-existing) | 1 (same) | 0 | PASS |
| lint warnings | 20 (pre-existing) | 20 (same) | 0 | PASS |
| shared tests | 388 | 388 | +0 | PASS |
| pipeline tests | 1129 (baseline) | 1133 | +4 (new utm tests) | PASS |

No new lint errors introduced. Pre-existing 1-error (rasterize-mark.cjs parser error in web) is unchanged.

---

## Summary

All 11 claims proven. VS-0 probe confirms posthog-js captures `utm_source` from a tagged URL onto a `$pageview` event with no network egress. EDGE-004 confirms direct visits carry no `utm_source`. Adversarial testing found no defects (see adversarial-findings.md). The implementation is correct and complete.

**Functional verdict: PASS**
