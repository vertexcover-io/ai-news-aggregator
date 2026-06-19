# Finding: link-enrichment stalls a large run when the headless browser crashes

- **Feature:** ADM-12 (run pipeline) / link-enrichment (`collector:enrichment`, web crawler)
- **Role:** Admin (`tenant_admin`)
- **Severity:** Major (large runs take many minutes / appear stuck) — **separate from the HN collector bug**.
- **Status:** Recorded only — **NOT fixed** (out of scope of the requested fixes; pre-existing; partly environment-influenced).
- **Surfaced by:** verifying the HN fix. Fixing the HN `best` feed means more items now flow into enrichment, which exposed this.

## Observed
A default-config run (both HN feeds, ~15+ items) sat in `stage: collecting`, `hn: pending` for 6+ minutes and the pipeline went silent. Logs showed the headless browser crashing:
```
collector:enrichment ... status:"failed", durationMs:15036,
  failureReason:"page.goto: Target page, context or browser has been closed"
worker:run-process stage:"enrich" event:"link_enrichment.failed" ...
```
After the shared headless browser dies, **every** subsequent link-enrichment fails on a ~15s timeout (`durationMs:15036`). With many items this serializes into minutes of dead time; `collectHn` only returns (and the HN source flips to `completed`) once all items are processed, so the whole run appears stuck in `collecting`.

## Contrast / isolation
- A **small** run (both feeds, `count:3` → 4 items) on a freshly-restarted worker **completes in ~20s** (`hn: completed`, ranked). So the pipeline and the HN fix are correct end-to-end.
- An earlier `newest`-only run also completed fully. The stall correlates with **item volume + a crashed browser**, not the HN logic.

## Root cause (hypothesis — needs confirmation)
The link-enrichment crawler uses a shared headless Chromium. Under concurrent load (or in a resource-constrained sandbox) the browser/context closes (`page.goto: ... browser has been closed`). Enrichment catches the per-item failure (`link_enrichment.failed`) but does **not** detect that the browser is dead and re-launch it — so each remaining item pays the full navigation timeout (~15s) against a dead browser instead of failing fast or recovering. Repeated tsx-watch restarts (from editing pipeline source during this session) likely contributed to destabilizing the browser.

Likely files to investigate (not modified): the web crawler / `collector:enrichment` browser lifecycle in `packages/pipeline/src/collectors/` (enrichment) and the shared browser/`fetchPage` implementation.

## Environment caveat
This was observed in a sandboxed local stack where headless Chromium is comparatively fragile. The severity in production depends on real crawler stability and concurrency limits (`WEB_CRAWLER_CONCURRENCY`). Worth confirming against prod-like infra before prioritizing.

## Notes for a future fix — NOT applied
- Detect a closed/crashed browser and re-launch it (or fail the remaining items fast) instead of paying a full timeout per item.
- Cap enrichment concurrency / add a per-run enrichment time budget so one bad batch can't stall the whole `collecting` stage.
