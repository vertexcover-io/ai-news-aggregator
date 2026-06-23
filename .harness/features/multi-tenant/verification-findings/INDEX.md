# Verification Findings — Index

One line per issue discovered while executing `../feature-verification-playbook.md`.
**Findings are recorded only — not fixed.** Each links to a per-issue file with root cause.

Status legend: ❌ open · ✅ fixed (with tests).

| # | Feature | Severity | Summary | File |
|---|---------|----------|---------|------|
| 1 ✅ | ADM-12 / HN collector | Blocker | HN `best` feed sends `numericFilters=points>N` to Algolia `/search` relevance index, which rejects it (400 `invalid numeric attribute(points)`); default feeds include `best`, and one feed's non-retryable error fails the whole run. `newest`-only runs complete fine. | [ADM-12-hn-best-feed-400.md](ADM-12-hn-best-feed-400.md) |
| 3 ❌ | ADM-12 / link-enrichment | Major | **Separate, pre-existing** (surfaced by the HN fix routing more items into enrichment): when the shared headless browser crashes mid-enrichment, every remaining item pays a ~15s timeout, stalling a large run in `collecting`. Small runs complete fine. NOT fixed — out of scope; partly sandbox-environment-influenced. | [ADM-12b-link-enrichment-browser-crash.md](ADM-12b-link-enrichment-browser-crash.md) |
| 2 ✅ | SUP-02 / super console logout | Major | Sign-out from `/admin/tenants` awaits `invalidateQueries(["auth","me"])` (refetch 401-rejects) before `navigate`, so navigate is skipped; page stays on the guarded route and the guard chain oscillates into an unbounded `/api/auth/me` 401 + PostHog loop (blank page). Clean unauthenticated nav doesn't loop. Related: `AdminLayout` logout invalidates wrong key `["admin","me"]` ≠ `["auth","me"]`. | [SUP-02-signout-loop.md](SUP-02-signout-loop.md) |

See `RESULTS.md` for the full PASS/FAIL/UNTESTABLE matrix across all features.
