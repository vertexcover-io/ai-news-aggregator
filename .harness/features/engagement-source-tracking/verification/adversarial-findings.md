# Adversarial Findings: engagement-source-tracking

**Date:** 2026-06-09
**Probe script:** `.harness/runtime/engagement-source-tracking/probes/adversarial-utm.mjs`
**Total scenarios run:** 19
**Confirmed breaks:** 0

---

## Scenarios Attempted

### A1. Base URL already has `?utm_source=foo` — overwrite vs. duplicate

**Attempt:** `withUtmSource("https://host/archive/x?utm_source=foo", "linkedin")`

**Expected risk:** Could append a second `utm_source` param, producing `?utm_source=foo&utm_source=linkedin`, causing PostHog to misread the channel.

**Result:** PASS — `searchParams.set()` overwrites; exactly one `utm_source=linkedin` is present. No duplication.

---

### A2. Multiple existing query params

**Attempt:** `withUtmSource("https://host/archive/x?a=1&b=2&c=3", "email")`

**Expected risk:** String manipulation could clobber existing params.

**Result:** PASS — all three params preserved alongside `utm_source=email`. URL API handles correctly.

---

### A3. URL with fragment `#section-1`

**Attempt:** `withUtmSource("https://host/archive/x#section-1", "twitter")`

**Expected risk:** String concat could produce `…#section-1?utm_source=twitter` (malformed).

**Result:** PASS — fragment is correctly preserved after the query. Output: `https://host/archive/x?utm_source=twitter#section-1`. URL API places query before fragment.

---

### A4. Encoded path (percent-encoded space `%20`)

**Attempt:** `withUtmSource("https://host/archive/hello%20world", "email")`

**Expected risk:** Double-encoding or loss of encoding.

**Result:** PASS — pathname preserved as `/archive/hello%20world`; `utm_source=email` appended cleanly.

---

### A5. URL with port

**Attempt:** `withUtmSource("https://host:8080/archive/run-id", "linkedin")`

**Expected risk:** Port could be dropped or mangled.

**Result:** PASS — port `8080` preserved; `utm_source=linkedin` set.

---

### A6. All channel values round-trip

**Attempt:** `withUtmSource(base, "email")`, `withUtmSource(base, "linkedin")`, `withUtmSource(base, "twitter")`

**Expected risk:** Any channel value could be mis-encoded or silently dropped.

**Result:** PASS — all three channels (`email`, `linkedin`, `twitter`) round-trip exactly.

---

### A7. Trailing-slash base URL

**Attempt:** `withUtmSource("https://host/archive/x/", "email")`

**Expected risk:** Could produce `?utm_source=email&utm_source=email` or break the path.

**Result:** PASS — exactly one `utm_source`; path intact.

---

### A8. Existing `utm_source=old` plus other params — targeted overwrite

**Attempt:** `withUtmSource("https://host/archive/x?token=abc&utm_source=old", "linkedin")`

**Expected risk:** Could duplicate `utm_source`, or lose `token=abc`.

**Result:** PASS — `token=abc` preserved; `utm_source` overwritten to `linkedin` (not `old`); no duplicates.

---

### EDGE-004 Live Probe: Direct visit (no utm_source in URL)

**Attempt:** posthog-js probe with landing URL `https://…/archive/<uuid>` (no query string).

**Expected risk:** posthog-js might synthesize a `utm_source` from session storage or referrer.

**Result:** PASS — `$pageview` event captured with no `utm_source` property; PostHog will bucket as `(none)` (direct).

---

## Summary

No breaks found. The `URL.searchParams.set()` API correctly handles all tested edge cases: overwrite semantics for pre-existing `utm_source`, preservation of existing params, fragment ordering, percent-encoding, ports, and trailing slashes. The implementation is robust.

**No entries added to lesson-candidates.jsonl** (no confirmed breaks).
