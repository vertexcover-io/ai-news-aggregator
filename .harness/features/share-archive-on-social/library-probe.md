# Library Probe — share-archive-on-social

> **Run at:** 2026-05-06
> **Verdict:** PASS
> **Loopback count:** 0

## Context

The dependencies for VER-68 are unusual for this skill: not npm libraries, but a
mix of public-internet HTTP endpoints (LinkedIn / X intent URLs) and browser DOM
APIs (Clipboard, execCommand, window.open) plus an internal helper (`setMeta`).
The npm health-heuristic loop in the skill template doesn't apply, so we skip
Step 2 and Step 3 (no creds — every surface is unauthenticated). We DO run
real smoke probes for each surface.

## Summary

| # | Surface | Probe | Verdict | Notes |
|---|---|---|---|---|
| D1 | LinkedIn `share-offsite/?url=...` | `probes/probe-linkedin.sh` | **VERIFIED** | HTTP 200, accepts `url` query param |
| D2 | X `twitter.com/intent/tweet?text=&url=` | `probes/probe-x.sh` | **VERIFIED** | 301 → 200 (twitter.com redirects to x.com); anchor follows redirect natively |
| D3 | Clipboard API + `execCommand` fallback | `probes/probe-clipboard.sh` | **VERIFIED with caveat** | In JSDOM 29 BOTH `navigator.clipboard` and `document.execCommand` are absent; production browsers unaffected; **tests must inject mocks** for both paths |
| D4 | `setMeta` for `<meta property="og:title">` | `probes/probe-meta.sh` | **VERIFIED with gap** | Existing helper writes `name=` only; coder phase must extend it (or add `setMetaProperty`) for og:tags |
| D5 | `<a target="_blank">` + `window.open` | `probes/probe-anchor.sh` | **VERIFIED** | Both work in JSDOM as expected |

## Selected approach (final)

- **Sharing mechanism:** plain intent URLs as `<a href target="_blank" rel="noopener noreferrer">` anchors. No `window.open` (per design — anchors handle pop-up blockers more reliably).
- **LinkedIn URL:** `https://www.linkedin.com/sharing/share-offsite/?url=<encoded>`. No other params; LinkedIn pulls preview from og:tags on the destination page.
- **X URL:** `https://twitter.com/intent/tweet?text=<encoded>&url=<encoded>`. The 301 to x.com is fine (anchor follows). Reserve **24 chars** in the truncation budget for the t.co-shortened URL + leading space.
- **Copy link:** `navigator.clipboard.writeText(url)` first; fallback to a hidden `<textarea>` + `document.execCommand("copy")`; final fallback to `window.prompt(...)` (out of scope for unit tests).
- **og:title meta:** the coder phase MUST extend `packages/web/src/lib/meta.ts` to write `<meta property="og:title">`. Two acceptable shapes: (a) extend `setMeta` to detect the `og:` prefix and switch attribute; (b) add a sibling `setMetaProperty(property, content)`. Recommend (a) for cohesion — the existing call site is already named `setMeta`.

## Adjustments to the design (carry into spec/plan)

1. **Add a "JSDOM caveat" note to the testing strategy:** unit tests of the copy-link control must inject `navigator.clipboard.writeText` via `Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn() }, configurable: true })`, and must inject `document.execCommand` via `Object.defineProperty(document, "execCommand", { value: vi.fn().mockReturnValue(true), configurable: true })` to assert the fallback path. This pattern follows the existing `tests/unit/setup.ts` model (matchMedia/ResizeObserver stubs).

2. **Update `packages/web/src/lib/meta.ts`** in the coder phase: when the key starts with `og:` (or another configured prefix), write `property=` instead of `name=`. Add a one-line unit test confirming `setMeta("og:title", "X")` produces `<meta property="og:title" content="X">`.

3. **Spec verification scenarios (Stage 5 will re-run these probes):**
   - VS-0-linkedin (re-run `probe-linkedin.sh`)
   - VS-0-x (re-run `probe-x.sh`)
   - VS-0-clipboard (re-run `probe-clipboard.sh`)
   - VS-0-meta-FIXED (NEW, runs in Stage 5: same shape as the gap probe but inverted — asserts `byProperty !== null` after the fix)
   - VS-0-anchor (re-run `probe-anchor.sh`)

## Pivot Log
None. All primary surfaces verified.

## Setup Needed
None. No credentials required.

## Resolution
N/A — no escalation needed.

<!-- LP:VERDICT:PASS -->
