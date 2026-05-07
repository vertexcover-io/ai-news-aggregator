# Library Probe — Verification Stubs (VS-0)

These scenarios are derived from successful library probes. functional-verify
re-runs them at the end of the pipeline to catch silent library breakage.

### VS-0-rdp-render: Library probe — react-day-picker SSR range render
**Type:** node script (no app context required)
**Run:**
```bash
cd /tmp/probe-rdp-rerun && rm -rf node_modules package-lock.json && \
  cp /Users/amankumar/Documents/newsletter/.worktrees/archive-keyword-search/docs/spec/add-archive-keyword-search/probes/react-day-picker/probe-render.mjs . && \
  echo '{"name":"rdp-rerun","private":true,"type":"module"}' > package.json && \
  npm install --silent --no-audit --no-fund react@18 react-dom@18 react-day-picker@9 date-fns@4 && \
  node probe-render.mjs
```
**Expected:** exit 0, JSON `ok: true` with `hasRoot`, `hasMonthGrid`, `hasGridCells`, `containsApr8`, `containsMay6` all true.

### VS-0-unaccent-fts: Library probe — Postgres unaccent + websearch_to_tsquery
**Type:** bash (requires running Postgres container)
**Run:**
```bash
bash docs/spec/add-archive-keyword-search/probes/unaccent/probe.sh
```
**Expected:** exit 0, log contains `ALL OK`, all 7 functional checks pass:
1. Extension creates / exists
2. `unaccent('Côté')` returns `Cote`
3. `immutable_unaccent` wrapper compiles
4. Generated tsvector column accepts the wrapper
5. `'agentic'` matches the seeded row
6. Accent-insensitive: `'cote'` matches `'Côté'`
7. `websearch_to_tsquery` operators work (`-` negation)

### VS-7/VS-8/VS-9: Playwright e2e — archive search UX
**Type:** Playwright (requires `pnpm infra:up`, api dev on :3000, web dev on :5173)
**Run:**
```bash
pnpm --filter @newsletter/web test:e2e -- archive-search
```
**Expected:** exit 0, three tests pass.
- VS-7: navigating `/?q=zzz-no-match-zzz` shows the `NO MATCHES` empty state.
- VS-8: typing `claude` in SearchBar updates URL `?q=claude`, ResultMeta `match "claude"` appears, Clear button removes `q` from URL. (Skips with reason if dev DB has no archive containing `claude`.)
- VS-9: opening the `DATE:` chip → `Last 30 days` preset → `Apply` writes `from=YYYY-MM-DD&to=YYYY-MM-DD` to URL.

### VS-10: Perf bench — search P95 ≤ 200ms at 1k archives
**Type:** node script (requires `pnpm infra:up`, api dev on :3000, `DATABASE_URL` from `.env`. Override target with `API_BASE_URL=...`.)
**Run:**
```bash
pnpm --filter @newsletter/api bench:search
```
**Expected:** exit 0, JSON report at `docs/spec/add-archive-keyword-search/verification/perf-report.json` with `passed: true` (P95 ≤ 200ms across 100 sequential queries against a 1,000-archive corpus). Synthetic rows are tagged with `[SYNTHETIC-PERF-SEED]` in `digest_summary`/title and the script self-cleans prior synthetic data on each run; manual cleanup via:
```bash
pnpm --filter @newsletter/api bench:search -- --teardown
```

