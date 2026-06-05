# Learnings — web-collector-proxy-support

## 1. Phantom transitive dependency (undici) — see global doc

`undici` was present in the pnpm store via `crawlee`/`playwright` but NOT importable from
`@newsletter/pipeline` until declared as an explicit `dependencies` entry (`undici@7.24.7`). The
library-probe caught this before spec generation, so Phase 1 was "add the dep" as the foundation
phase. Full write-up (reusable across any feature adding an external library under pnpm):

→ `docs/solutions/integration-issues/phantom-transitive-dep-pnpm-must-declare-20260601.md`

## 2. A localhost-fixture crawler e2e must run with `WEB_HTTP_PROXY` UNSET

**The proxy routes ALL crawl traffic — including localhost — so loading the real `WEB_HTTP_PROXY`
from `.env` into a crawler e2e run breaks the in-process fixture-server tests with spurious 403s.**

During the quality gate, `web-crawler.e2e.test.ts` (which crawls a localhost in-process fixture
server) failed 3 tests with `AdaptivePlaywrightCrawler: Request blocked - received 403 status code`.
Root cause: the test-harness invocation did `set -a; . ./.env` to supply `DATABASE_URL`/`REDIS_URL`,
which also loaded the real `WEB_HTTP_PROXY`. The proxy seam then routed the crawler's `http://127.0.0.1:<port>`
fixture request through the live upstream proxy, which cannot reach the test machine's localhost and
returned 403. This is **correct proxy behavior** (the feature working as designed — `runWebCrawl`
applies `ProxyConfiguration` to every request), not a regression. Explicitly `unset WEB_HTTP_PROXY`
before the e2e makes all 3 tests pass.

**Rule for running the pipeline crawler e2e locally / in CI:**

```bash
set -a; . ./.env; set +a
unset WEB_HTTP_PROXY          # crawler e2e fixtures are localhost-only; the proxy can't reach them
pnpm --filter @newsletter/pipeline test:e2e -- web-crawler.e2e
```

If a future change makes the crawler e2e proxy-aware, the fixture server would need to be reachable
*through* the proxy (it isn't) — so the correct posture remains: localhost-fixture crawler e2e runs
with the proxy disabled. The proxy egress path is proven separately by the VS-0 live probes against
`api.ipify.org`, not against the localhost fixture.

## 3. Unrelated pre-existing e2e failures observed (not this feature)

`collection.e2e.test.ts` fails 4 tests with `Cannot read properties of undefined (reading
'upsertItems')`. This is the **legacy collection worker** (`src/workers/collection.ts`, documented
"left in place for rollback, no longer receives new jobs"), untouched by this feature and not
network/proxy related — a pre-existing test-harness defect, flagged here so it isn't misattributed to
the proxy change in future gate runs.
