# Quality Gate Report — Reddit Proxy

**Spec:** `docs/spec/reddit-proxy/spec.md`
**Stage:** post-tdd
**Date:** 2026-05-07
**Verdict:** ✅ **PASS**

## Summary

| Check | Status | Evidence |
|---|---|---|
| Typecheck (full repo) | ✅ PASS | `pnpm typecheck` — 7/7 tasks successful |
| Lint (full repo) | ✅ PASS | `pnpm lint` — 5/5 tasks successful |
| Build (full repo) | ✅ PASS | `pnpm build` — 5/5 tasks successful |
| Unit tests (pipeline) | ✅ PASS | 466/466 tests passed |
| New tests added | ✅ PASS | 8 new tests across 2 files (proxy-fetch helper + collector wiring) |
| Functional verification | ✅ PASS | See `verification/proof-report.md` |
| Pre-existing tests | ✅ PASS | All 458 prior tests unchanged + green |

## Command output

### Typecheck

```
$ pnpm typecheck
@newsletter/api:typecheck: > tsc --noEmit
 Tasks:    7 successful, 7 total
Cached:    4 cached, 7 total
  Time:    7.559s
```

### Lint

```
$ pnpm lint
@newsletter/eslint-plugin:lint: ...
@newsletter/shared:lint: > eslint .
@newsletter/pipeline:lint: > eslint .
 Tasks:    5 successful, 5 total
Cached:    4 cached, 5 total
  Time:    11.57s
```

### Build

```
$ pnpm build
@newsletter/web:build: ...
 Tasks:    5 successful, 5 total
Cached:    2 cached, 5 total
  Time:    5.087s
```

### Unit tests

```
$ pnpm --filter @newsletter/pipeline test:unit
 Test Files  41 passed (41)
      Tests  466 passed (466)
   Start at  14:40:01
   Duration  18.39s
```

## New artifacts

- `packages/pipeline/src/lib/proxy-fetch.ts` — 13 LOC helper using `undici.ProxyAgent`.
- `packages/pipeline/tests/unit/lib/proxy-fetch.test.ts` — 4 unit tests (REQ-1..4).
- `packages/pipeline/tests/unit/collectors/reddit-proxy-wiring.test.ts` — 4 unit tests (REQ-3..5).

## Modified files

- `packages/pipeline/src/collectors/reddit.ts` — added `import { createProxyFetch }`; replaced `deps.fetchFn ?? fetch` with `deps.fetchFn ?? createProxyFetch(process.env.REDDIT_HTTP_PROXY)` in two call sites (`collectReddit`, `fetchRedditPost`).
- `packages/pipeline/package.json` — added `undici@7.6.0`.
- `.env.example` — documented `REDDIT_HTTP_PROXY` with usage notes.

## Risk assessment

| Risk | Mitigation |
|---|---|
| Proxy URL leaks in logs | Audited — no `logger.*` call references `REDDIT_HTTP_PROXY` or the URL value. Only env-var name appears, never the value. |
| Proxy outage breaks production runs | Existing `fetchWithRetry` retries 5xx with exponential backoff. A persistent proxy outage will fail the Reddit collector but not the run (other collectors continue per partial-collection rule). |
| Caller-injected fetchFn unexpectedly wrapped | Unit-tested in both call sites: caller fetchFn always wins, `createProxyFetch` is not invoked. |
| undici as new direct dep | Already a transitive dep (Node 22's built-in fetch uses undici). Adding it as a direct dep at v7.6.0 (latest stable) carries low risk. |

## Verdict

**PASS.** All quality gate checks green. Functional verification on the production VPS confirms the implementation works as designed: 403 without proxy, 200 with proxy, comments fetch round-trips successfully. Ready to commit and deploy.

## Next steps (out of scope for this gate)

1. Set `REDDIT_HTTP_PROXY` in the deployed `.env` file on the VPS.
2. Deploy the new pipeline image.
3. Trigger a `run-now` and confirm `raw_items` rows are written for `reddit` source type.
