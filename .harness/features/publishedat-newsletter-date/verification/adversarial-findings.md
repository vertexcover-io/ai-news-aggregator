# Adversarial Findings — publishedat-newsletter-date

Step 5 role-swap: deliberate attempts to BREAK the publish-date feature.

**Outcome: no defects found.** All probes behaved per spec.

## Scenarios attempted

### 1. published_at and completed_at in different MONTHS — does grouping use the publish month?
- Probe: set Archive A `completed_at = 2026-04-30 23:00`, `published_at = 2026-05-01 06:00+00`.
- Expectation: effective date = publish date → issueDate `2026-05-01` (May), NOT April.
- Result: `GET /api/archives/:id` → `issueDate = 2026-05-01`. **Publish month wins.** No mismatch
  between the ordering date and the displayed month. (EDGE-005 coherence.)
- Restored A to completed 2026-05-25 / published 2026-05-26 afterward.

### 2. UTC-midnight boundary publish date — off-by-one risk?
- Probe: set Archive A `published_at = 2026-05-26 00:00:00+00` (exact UTC midnight).
- Expectation: date derived in the schedule timezone with no day rollback.
- Result: `issueDate = 2026-05-26` and list `runDate = 2026-05-26`. No off-by-one. `publishedAt`
  key still absent from the public detail payload.
- Restored to 06:00 afterward.

### 3. emailTime == pipelineTime (published_at NULL) — fallback path, no crash?
- Probe: Archive B has `published_at = NULL` (the pipeline writes NULL when scheduled publish
  equals the pipeline completion time, on failure, or when settings are missing).
- Expectation: fall back to `completed_at`, render normally, return HTTP 200.
- Result: `GET /api/archives/:B` → HTTP **200**, `issueDate = 2026-04-10` (= completed_at),
  detail page renders **"FRIDAY · APRIL 10 · 2026"**. No crash, no NaN, no missing-date.

### 4. Does the public single-archive JSON leak a raw `publishedAt` / `published_at` key?
- Probe: dumped top-level keys of `GET /api/archives/:A`, `GET /api/archives/:C`, and every row
  of `GET /api/archives`.
- Expectation: only the derived `issueDate` (detail) / `runDate` (list) is exposed; no raw
  `publishedAt`.
- Result: Archive A detail keys = `[completedAt, digestHeadline, digestSummary, error, hook, id,
  issueDate, rankedItems, sourceTypes, sources, stage, startedAt, status, topN, updatedAt,
  warnings]` — **no `publishedAt`** (cite `verification/api/detail-A.txt`). Archive C detail —
  no `publishedAt` (cite `verification/api/detail-C.txt`). List rows leaking publishedAt: **NONE**
  (row keys = `digestHeadline, digestSummary, isDryRun, leadSummary, runDate, runId, storyCount,
  topItems`).

### 5. Mixed-NULL ordering — does a publish-dated row beat a NULL-published older row?
- Probe: `GET /api/archives` full ordering with Archive A (publish 2026-05-26), Archive B
  (NULL → completed 2026-04-10), Archive C (publish 2026-04-01), and 15 NULL-published
  empties (completed 2026-05-25).
- Result: Archive A is position 1 (latest effective date), the NULL-published 2026-05-25
  empties follow, then Archive B (pos 17, April), then Archive C (pos 18, April). Order is
  strictly `COALESCE(published_at, completed_at) DESC`. Publish-dated A correctly outranks the
  NULL-published rows. (REQ-008 / REQ-012.)

## Defects

None found. The feature handles cross-month publish/complete splits, UTC-midnight boundaries,
the NULL-published fallback, and the public-serialisation boundary correctly.
