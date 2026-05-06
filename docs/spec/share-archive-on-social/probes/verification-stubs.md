# Verification Stubs (VS-0) — share-archive-on-social

These are the executable probes from Stage 1.5 that `functional-verify` in
Stage 5 must re-run end-to-end before sign-off. spec-generation folds these
into `spec.md` under `## Verification Scenarios`.

### VS-0-linkedin: LinkedIn share-offsite endpoint reachable
- **Type:** http (curl)
- **Run:** `bash docs/spec/share-archive-on-social/probes/probe-linkedin.sh`
- **Expected:** exit 0; HTTP 2xx/3xx for `https://www.linkedin.com/sharing/share-offsite/?url=...`

### VS-0-x: X (Twitter) intent endpoint reachable
- **Type:** http (curl)
- **Run:** `bash docs/spec/share-archive-on-social/probes/probe-x.sh`
- **Expected:** exit 0; HTTP 2xx/3xx for `https://twitter.com/intent/tweet?text=...&url=...`

### VS-0-clipboard: Clipboard / execCommand absence in JSDOM 29 (informational)
- **Type:** vitest
- **Run:** `bash docs/spec/share-archive-on-social/probes/probe-clipboard.sh`
- **Expected:** exit 0. Confirms tests need to inject mocks for both `navigator.clipboard` and `document.execCommand`.

### VS-0-meta-CURRENT: setMeta gap (must remain VERIFIED *before* fix is applied — informational)
- **Type:** vitest
- **Run:** `bash docs/spec/share-archive-on-social/probes/probe-meta.sh`
- **Expected:** exit 0 BEFORE the coder phase. After the coder phase fixes `meta.ts`, this probe will FAIL by design (it asserts the broken state). At Stage 5, the coder phase must REPLACE this probe with VS-0-meta-FIXED below.

### VS-0-meta-FIXED: setMeta supports `<meta property="og:title">` after fix
- **Type:** vitest
- **Run:** added by the coder phase. Same probe shell as `probe-meta.sh` but the embedded test asserts the inverted state: after `setMeta("og:title", "X")`, `<meta property="og:title">` IS present and `<meta name="og:title">` is NOT (or both are accepted; the property tag is what matters for OG scrapers).
- **Expected:** exit 0 after the coder phase.

### VS-0-anchor: Anchor target=_blank + window.open work in JSDOM
- **Type:** vitest
- **Run:** `bash docs/spec/share-archive-on-social/probes/probe-anchor.sh`
- **Expected:** exit 0.

## Notes for Stage 5

- The HTTP probes (D1, D2) hit real networks. If the agent runs them in a sandbox without network access, mark them `SKIPPED:network` rather than failed.
- VS-0-meta-CURRENT must be retired once the coder phase lands — it is intentionally a "current state" snapshot, not a permanent test. The coder phase should:
  1. Implement the og:property extension to `setMeta`.
  2. Replace the body of `probes/probe-meta.sh` with the inverted assertions (VS-0-meta-FIXED).
  3. Or simpler: delete the gap probe and rely on the new unit tests for `setMeta` to cover the fix.
