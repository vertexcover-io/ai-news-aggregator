# Adversarial Findings — dry-run-archive-access

**Date:** 2026-05-25
**Role:** Try to break the feature, not confirm it works.

I attempted to find ways the change either fails to deliver the promise or leaks dry runs through a surface
other than the intended direct link.

## Scenarios attempted

1. **Re-introduce the old contract by accident — is the 404 truly gone for reviewed dry runs?**
   - GET the reviewed dry run with no cookie → 200 with full body. The guard is genuinely removed. PASS.

2. **Does removing the dry-run guard accidentally weaken the reviewed gate?**
   - Seeded an **un-reviewed** dry run (`reviewed=false, is_dry_run=true`) → still 404. The `!archive.reviewed`
     guard fires before the (now-deleted) dry-run check ever mattered. The reviewed gate is intact. PASS.

3. **Does the dry run now leak through the LISTING?**
   - GET `/api/archives` with only the reviewed dry run seeded → `{"archives":[]}`. The repo
     `is_dry_run = false` filter still excludes it. Browser `/` confirms no rows render. PASS — no leak.

4. **Does it leak through SEARCH?**
   - GET `/api/archives/search?q=Dry` (the digest headline contains "Dry") → `{"archives":[],"total":0}`.
     The FTS query's `is_dry_run = false` filter holds. PASS — no leak.

5. **Missing / unknown runId** — GET a random UUID → 404 `{error:"not found"}`. No 500, no stack leak. PASS.

6. **Silent UI failure** — the API could return 200 while the page still shows an error (the cache-vs-promise
   class of bug). Drove a real browser: the page rendered the digest content, NOT the error state and NOT the
   "isn't ready yet" state. 0 console errors. PASS — the user-visible promise actually holds, not just the API.

## Defects found

**None.** No surface other than the intended direct UUID link exposes a dry run; the reviewed/missing 404
guards are intact; the rendered page matches the API contract.

## Residual risk (accepted by design)

- The runId is the only access control for the direct link (it is an unguessable UUID). This was explicitly
  chosen by the user ("accessible via direct link, no auth needed"). Anyone holding the UUID can view a
  reviewed dry run. Documented in design.md and the spec's Out of Scope.
