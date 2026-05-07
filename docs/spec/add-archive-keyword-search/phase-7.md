# Phase 7: E2E + perf bench

> **Status:** pending

## Overview

Wrap up: add the Playwright e2e tests covering the full search-flow user journey (VS-7, VS-8, VS-9), and a one-shot perf benchmark script for VS-10 (REQ-028: P95 ≤ 200 ms at 1k archives). functional-verify will run both at the end of the pipeline.

## Implementation

**Files:**
- Create: `packages/web/tests/e2e/archive-search.spec.ts` — Playwright tests covering VS-7 (empty), VS-8 (search → clear), VS-9 (range chip preset)
- Create: `packages/api/scripts/seed-search-perf.ts` — one-shot Node script that seeds 1,000 synthetic reviewed archives via direct DB writes, then runs 100 sequential `GET /api/archives/search?q=<random-token>` calls and prints P50/P95/P99 to stdout + writes `docs/spec/add-archive-keyword-search/verification/perf-report.json`
- Modify: `packages/api/package.json` — add a `pnpm --filter @newsletter/api run bench:search` script that invokes the perf bench

**Pattern to follow:** existing Playwright tests under `packages/web/tests/e2e/`.

**What to test (Playwright):**

```ts
// archive-search.spec.ts (sketch)
test('VS-7: empty state when query has no matches', async ({ page }) => {
  await page.goto('/?q=zzz-no-match-zzz');
  await expect(page.getByText(/no matches/i)).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(0); // or whatever the row selector is
});

test('VS-8: type → results filter → clear restores list', async ({ page }) => {
  await page.goto('/');
  // Pre-seeded reviewed archive contains 'claude' in digest_summary
  await page.getByPlaceholder('Search the archive…').fill('claude');
  await page.waitForURL(/q=claude/);
  await expect(page.getByText(/issues match/)).toBeVisible();
  await page.getByRole('button', { name: /clear/i }).click();
  await page.waitForURL(url => !url.searchParams.has('q'));
  // month headers visible again
  await expect(page.getByText(/2026/)).toBeVisible();
});

test('VS-9: open date chip → pick preset → apply updates URL', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /date:/i }).click();
  await page.getByRole('button', { name: /last 30 days/i }).click();
  await page.getByRole('button', { name: /apply/i }).click();
  await expect(page).toHaveURL(/from=\d{4}-\d{2}-\d{2}.*to=\d{4}-\d{2}-\d{2}/);
});
```

**Perf bench (the non-obvious part):**

```ts
// scripts/seed-search-perf.ts
import { db, runArchives, rawItems } from '@newsletter/shared/db';
import { serializeArchiveSearchText } from '@newsletter/shared';

const RANDOM_TOKENS = ['agentic', 'claude', 'qwen', 'context', 'inference', 'embedding'];

async function seed(n: number) {
  // Insert n synthetic raw_items + run_archives, randomly mixing the tokens
  // into the digest summaries and recap fields. Use INSERT ... SELECT generate_series.
  // Each archive references a small set of newly inserted raw_items.
}

async function bench() {
  const start = Date.now();
  const samples: number[] = [];
  for (let i = 0; i < 100; i++) {
    const token = RANDOM_TOKENS[i % RANDOM_TOKENS.length];
    const t0 = performance.now();
    const r = await fetch(`http://localhost:3001/api/archives/search?q=${token}`);
    await r.json();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  const p50 = samples[Math.floor(samples.length * 0.5)];
  const p95 = samples[Math.floor(samples.length * 0.95)];
  const p99 = samples[Math.floor(samples.length * 0.99)];
  console.log(JSON.stringify({ p50, p95, p99, n: samples.length, totalMs: Date.now() - start }, null, 2));
  // also write to docs/spec/.../verification/perf-report.json
}

await seed(1000);
await bench();
process.exit(0);
```

**Cleanup:** the script tags inserted rows with a known marker (e.g. `metadata.synthetic = true`) so functional-verify can wipe them after running, leaving the dev DB clean. (functional-verify already manages teardown for spec verification artifacts.)

**Done when:**
- [ ] All 3 Playwright tests pass against `pnpm dev` running in another shell
- [ ] Perf bench runs end-to-end and produces a JSON report
- [ ] P95 ≤ 200 ms reported on local Postgres for 1,000-archive corpus
- [ ] Perf bench is invoked by functional-verify (verification scenarios reference it)

**Commit:** `test(VER-XX): add e2e + perf bench for archive search`
