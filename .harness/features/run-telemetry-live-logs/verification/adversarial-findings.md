# Adversarial Findings — run-telemetry-live-logs

**Total defects found: 0** (3 scenarios attempted, all behaved as designed.)

## Scenario A — Bogus UUID
- Action: navigate to `/admin/runs/00000000-0000-0000-0000-000000000000` (no row in `run_archives`,
  no Redis run-state).
- Expected: graceful 404 / "Run not found" message, no stack trace.
- Observed: page renders the `Run not found` empty state with the copy
  "No run-state or archive exists for this id." plus a `← Back to dashboard` link.
- Outcome: **behaved as expected.**

## Scenario B — Debug Timeline "Error"-only filter
- Action: on the seeded run page, click the `Error` chip in the Debug Timeline filter.
- Expected: only the two error rows visible (`web.extract.failed`, `link_enrichment.failed`);
  info + warn rows hidden.
- Observed: counted occurrences in DOM after filter applied:
  `web.extract.failed = 1`, `link_enrichment.failed = 1`, info events
  (`listing_completed | extract.start | crawler.stats`) = 0 in the visible Debug Timeline
  (info events only remain inside the per-source source-log panel when expanded — that panel
  is not gated by the Debug Timeline level filter, which is consistent with the design).
- Outcome: **behaved as expected.**

## Scenario C — Legacy archive with URL-form identifier
- Action: seeded a second archive (`00000000-0000-0000-0000-000000000098`) whose
  `source_telemetry.sources[0].identifier` is the **full listing URL**
  `https://example.com/blog` (the pre-VS-1 shape, before identifier alignment with
  `deriveRawItemIdentifier`). Navigated and expanded the source row.
- Expected: API returns 200 with an empty items array (no crash); UI shows the legacy
  fallback message "No items collected for this source.".
- Observed: row expands, panel reads `0 deduped-survivors / 0 dedup-dropped / 0 enrich-failed`
  then the verbatim copy "No items collected for this source." and "No source log lines
  recorded." for the source-log subsection. No HTTP error.
- Outcome: **behaved as expected.** Matches the VS-8 e2e contract for legacy archives.
