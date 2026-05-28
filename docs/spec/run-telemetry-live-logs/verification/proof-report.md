# Verification Proof Report — run-telemetry-live-logs

**Verdict: PASSED**

Date: 2026-05-28
Branch: `feat/run-telemetry-live-logs`
Spec: `docs/spec/run-telemetry-live-logs/spec.md`
Aggregated claims: `.harness/run-telemetry-live-logs/claims.json` (21 claims executed, 0 failed)

## Infra used
- PostgreSQL: `localhost:5434` (`record-review-edits-pg-temp` container; user/db `newsletter`)
- Redis: `localhost:6379`
- API dev server: `node` via `tsx src/index.ts` on `:3000` (watch mode disabled because the
  Linux user-watcher quota — `fs.inotify.max_user_watches=65536` — was already saturated; we
  ran the long-lived process without HMR. This does not affect the gate.)
- Web dev server: `vite` on `:5173` with `CHOKIDAR_USEPOLLING=true CHOKIDAR_INTERVAL=2000`
  for the same inotify reason.
- Browser automation: Playwright MCP

## Quality gate (Step 3)
| Check | Result | Notes |
|---|---|---|
| `pnpm typecheck` | PASS (turbo full cache hit) | 7/7 packages clean |
| `pnpm lint` | PASS (turbo full cache hit) | 5/5 packages clean |
| `pnpm --filter @newsletter/pipeline test:unit` | PASS | 92 files / 1063 tests |
| `pnpm --filter @newsletter/api test:e2e tests/e2e/observability-extended.e2e.test.ts` | PASS | 3/3 tests |

## Per-claim evidence

### VS-1 — web collector identifier alignment with `deriveRawItemIdentifier`
- Type: unit
- Evidence: `packages/pipeline/tests/unit/collectors/web.test.ts` describe block
  "unit identifier matches deriveRawItemIdentifier (VS-1)" — 5 parameterised tests (canonical,
  uppercase host, subdomain, trailing slash, .co.uk TLD). All pass in the unit run above.

### VS-2 — pino bridge dual-emit + isolation
- Type: unit
- Evidence: `packages/pipeline/src/services/__tests__/run-logger.test.ts` — `withPinoBridge`
  debug/info/warn/error each dual-call (4 cases) plus the two crash-isolation tests
  (throwing base logger doesn't block runLogger; rejecting runLogger swallowed).

### VS-3 — link-enrichment failure logging (catch + non-ok + cancel)
- Type: unit
- Evidence: `packages/pipeline/src/services/link-enrichment/__tests__/index.test.ts`
  "VS-3 catch-block path emits link_enrichment.failed at error level",
  "VS-3 non-ok enrichOne result emits link_enrichment.failed at error level",
  "VS-3 cancelled branch emits link_enrichment.failed at error level".

### VS-4 — successful enrichment is silent
- Type: unit
- Evidence: same file — "VS-4 successful enrichment emits zero error and zero warn rows".

### VS-5 — level mapping for web-collector + crawler-stats events
- Type: unit
- Evidence: `packages/pipeline/tests/unit/collectors/web.test.ts` describe "level mapping for
  web collector events (VS-5)" (3 tests) + `packages/pipeline/tests/unit/services/web-crawler.test.ts`
  describe "runLogger crawler.stats emission" (2 tests). All 5 pass.

### VS-6 — observability endpoint surfaces all seeded events
- Type: e2e
- Evidence: `packages/api/tests/e2e/observability-extended.e2e.test.ts` — VS-6 case (all
  seeded events in `logs[]`, error rows in `failures[]`).

### VS-7 — per-source items endpoint returns the 3 seeded items
- Type: e2e
- Evidence: same file — VS-7 case (identifier alignment fix proved with `blog:cursor.com`).

### VS-8 — legacy archive with listing-URL identifier returns 200 + empty items
- Type: e2e
- Evidence: same file — VS-8 case. Confirmed live via adversarial run-id
  `00000000-…-000098` (see `adversarial-findings.md`).

### VS-9 — Debug Timeline + Failure cards render all new events
- Type: ui (Playwright MCP screenshots)
- Evidence: `docs/spec/run-telemetry-live-logs/verification/screenshots/vs-9-debug-timeline.png`
  shows all 6 seeded events (info/warn/info/error/info/error) with level chips and timestamps.
  `screenshots/vs-9-failure-cards.png` shows two FailureCards (`Extract failed` collect-stage
  with `source: blog`, plus `Enrichment failed` enrich-stage), both tagged `non-fatal`.
  The URL + `failureReason` + `step` context fields render in the per-source source-log panel
  visible after clicking the source row (see VS-10 screenshot — line items
  `url=https://broken.example.com/blog · step=discovery · error=HTTP 500`,
  `url=https://cursor.com/blog/post-99 · step=extract · error=timeout`).

### VS-10 — Per-source items dropdown populated for blog source
- Type: ui (Playwright MCP screenshot)
- Evidence: `docs/spec/run-telemetry-live-logs/verification/screenshots/vs-10-source-items.png`
  shows the expanded `blog · cursor.com` row with all 3 seeded posts
  (`Cursor post 1/2/3` with the matching `https://cursor.com/blog/post-N` link),
  plus the inline source log showing each event (info / warn / info / error / info)
  with `url`, `step`, and `error` context fields.

## Adversarial findings
See `docs/spec/run-telemetry-live-logs/verification/adversarial-findings.md`.
Summary: 3 scenarios attempted, 0 defects found — all behaved as expected.
