# Adversarial Findings — run-observability-page

Role-swap critic pass. Goal: break the per-run observability page. Targets derived from spec
ACs/edge-cases NOT in `claims.json` `claims[]`, plus the scenarios named in the verification
directive. Tooling: live curl against api :3000, Playwright MCP against web :5173, direct Postgres
seeding on :5433, Redis on :6379.

## 1. Attack surface derived

- **Orphaned `run_logs`** — logs exist but NO `run_archives` row AND NO Redis key. (Gap: claims cover
  live-via-redis and historical-via-archive, but not "logs only". Source: spec REQ-024 + EDGE-derived.)
- **Run with zero sources** — empty `sourceTelemetry.sources` array. (Derived: REQ-033 table boundary.)
- **Enrichment missing / null** — telemetry has no `enrichment` key at all (stricter than EDGE-010's
  "all-zero counts"). (Source: EDGE-010 boundary.)
- **Very long error stack** — 23 KB multi-line stack in `run.failed` context. (Source: EDGE-007.)
- **Concurrent / interleaved `source.*` rows** — 10 source rows; verify id-ascending ordering & no
  lost rows. (Source: EDGE-006, REQ-026.)
- **Level filter that empties the timeline** — select "Warn" on a run whose logs are all `info`.
  (Source: REQ-036 boundary — distinct from REQ-037 legacy empty.)
- **Unknown / random UUID** — not-found UI state. (Source: REQ-024 / PHASE4-C4, the one UI claim with
  no screenshot in claims.json.)
- **Malformed / XSS runId** — `not-a-valid-uuid-<script>` in the path. (Source: boundary + escaping.)
- **Unauthenticated access** — API + route gate. (Source: REQ-025/REQ-030.)

## 2. Scenarios attempted

| ID | Category | Description | Inputs | Verdict |
|----|----------|-------------|--------|---------|
| ADV-1 | Unexpected state | run_logs present, no archive, no Redis | runId `5555…`, 2 log rows only | EXPECTED (404) |
| ADV-2 | Boundary | completed archive, zero sources | runId `6666…`, `sources:[]` | EXPECTED (200, empty table, no crash) |
| ADV-3 | Boundary (EDGE-007) | 23 KB stack in run.failed | runId `7777…`, 23,325-char stack | EXPECTED (full stack stored; UI scrolls, no layout break) |
| ADV-4 | Boundary (EDGE-010) | enrichment key absent from telemetry | runId `8888…`, no `enrichment` | EXPECTED (API enrichment=null → UI renders all-zeros) |
| ADV-5 | Concurrency (EDGE-006) | 10 interleaved source.completed rows | runId `9999…a` | EXPECTED (10 logs, id-ascending, none lost) |
| ADV-6 | Filter boundary (REQ-036) | "Warn" filter on info-only logs | historical run `2222…` | EXPECTED ("No entries at this level.", 0 rows, no NaN) |
| ADV-7 | Unknown id (REQ-024) | random UUID | `aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee` | EXPECTED (not-found UI + back link) |
| ADV-8 | Malformed / XSS | non-UUID path with `<script>` | `not-a-valid-uuid-%3Cscript%3E` | EXPECTED (400 → not-found UI, no script injection) |
| ADV-9 | Auth (REQ-025) | unauthenticated GET | no cookie | EXPECTED (401, no body) |

### Evidence per scenario

- **ADV-1** `GET …/observability` → `{"error":"Run not found"}` HTTP **404**. Correct: a run is keyed by
  Redis run-state OR an archive row; orphaned logs alone do not constitute a run (REQ-024). No 500, no
  partial render.
- **ADV-2** HTTP 200, `sources:0`, `funnel {0,0,0,0}`, `logs:0`. UI: source table renders with header and
  no body rows; no NaN/undefined in DOM (`bodyHasError:false`); no crash.
- **ADV-3** HTTP 200; `failures[0].context.stack` length = **23325** (full, untruncated). UI after expand:
  `[data-testid=log-stack]` text length 23325, `overflow:auto`, `white-space:pre`; failure card right
  edge 1116 ≤ viewport 1280; **document.scrollWidth 1265 ≤ window 1280 → no horizontal page overflow**.
  The stack scrolls inside its own block rather than bursting the layout. EDGE-007 satisfied.
- **ADV-4** HTTP 200; API `enrichment=null`. UI: `[data-testid=enrichment-strip]` renders
  "Attempted 0 / OK 0 / Failed 0 / Skipped 0 / Avg fetch 0ms"; no NaN/undefined. EDGE-010 satisfied even
  for the stricter "key absent" case.
- **ADV-5** HTTP 200; `logs:10`; `logsAscending:true` (every `logs[i].id <= logs[i+1].id`). No rows lost.
  EDGE-006 / REQ-026 satisfied.
- **ADV-6** Clicking "Warn" on the info-only historical run → 0 `log-row`s and a distinct filtered-empty
  message **"No entries at this level."** (NOT the legacy `timeline-empty` "No debug logs recorded for
  this run."). The feature correctly distinguishes "no logs" from "no logs matching the active filter".
  No NaN, no crash.
- **ADV-7** Random UUID → `[data-testid=run-not-found]` "Run not found / No run-state or archive exists
  for this id." + "← Back to dashboard" → `/admin`. REQ-024 / PHASE4-C4 (the un-screenshotted UI claim)
  proven live.
- **ADV-8** `not-a-valid-uuid-<script>` → API 400 → page renders not-found state; `scriptInjected:false`
  (React escapes the path segment; no `<script>` executed). Correct boundary + escaping behaviour.
- **ADV-9** Unauthenticated `GET …/observability` (no cookie) → HTTP **401**, no payload body
  (verified at the curl layer; route is nested under `/admin` AdminLayout children in `App.tsx`).

## 3. Defects

**None in the run-observability-page feature.** All adversarial inputs were either correctly rejected
(404/400/401) or rendered a safe degraded state (empty table, all-zero enrichment, filtered-empty
timeline, scrollable giant stack) with no 500 reaching the user, no data corruption, no script
injection, no NaN/undefined leak, and no layout break.

## 4. Cannot assess

- **Real concurrent collectors writing rows at the same wall-clock instant** — ADV-5 simulates EDGE-006
  by inserting 10 source rows and asserting id-ascending ordering, but a true race between live worker
  goroutines is not reproducible from this harness. The `(run_id, id)` index + bigserial PK make
  ordering deterministic by construction, so this is low risk; flagged for honesty.
- **TTL expiry of a live Redis run-state mid-view (EDGE-003)** — not exercised live; the historical
  fallback path (live=false from archive) is already proven by VS-2, which is the same code branch a
  TTL-expired run lands in.

## 5. Honest declaration

**No defects found across 9 scenarios attempted.** Categories exercised: unexpected state (orphaned
logs), boundary inputs (zero sources, 23 KB stack, absent enrichment), concurrency/ordering, filter
boundary, unknown-id, malformed/XSS input, and auth.

My most promising attack was **ADV-3 (the 23 KB stack)** — a multi-line trace 400 frames deep is the
classic way to blow out a flex/grid card and force horizontal page scroll on every other section. It
did not land: the stack `<pre>` is `overflow:auto` so it scrolls within its own bordered block, the
failure card stays inside the viewport (1116 ≤ 1280), and the document scroll width (1265) stays under
the window width (1280) — the giant stack is fully contained. The second-most-promising attack,
**ADV-4 (enrichment key entirely absent, not just zeroed)**, also failed to break anything: the
composition endpoint normalises a missing enrichment block to `null` and the `EnrichmentStrip` renders
zeros rather than `NaN`/`undefined`.

## Environmental note (NOT a feature defect)

During the pass I observed my seeded `run_archives` rows disappearing between probes. Investigation
(`ps` + API dev logs) showed **other git worktrees** (`fix-dry-run-archive-access`,
`fix-reviewed-digest-regeneration`) running their full `test:e2e` / quality-gate suites against the
**same shared Postgres on :5433** — those suites delete/truncate `run_archives` (`archive.deleted` log
events, `run-flow-e2e` worker activity). This is cross-worktree test interference on a shared DB, not
a deletion path in the observability feature. The observability code has no delete behaviour. I
re-seeded and re-verified; all scenario runs render correctly. The `mcp__postgres__query` MCP also
points at the wrong port (:5432 vs the project's :5433), which is why direct MCP queries errored — I
used `psql` on :5433 throughout instead.
