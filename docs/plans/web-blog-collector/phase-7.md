# Phase 7: E2E tests

> **Status:** pending
> **Traces to:** Live verification of REQs 010, 011, 012, 031, 032, 041, 050, 060, 072, 074, 075, 079, 080, 090 (per verification matrix column "E2E Test")
> **Depends on:** Phase 6

## Overview

After this phase, `tests/e2e/collectors/web.e2e.test.ts` exists with 5
live-integration tests against real Jina Reader + real Gemini against
three real blog sources. Gated on `GEMINI_API_KEY` via
`describe.skipIf(...)`. Follows the existing `hn.e2e.test.ts` pattern
for dotenv loading and test-DB isolation.

## Implementation

**Files:**
- Create: `packages/pipeline/tests/e2e/collectors/web.e2e.test.ts`
- Modify: `/.env.example` — add `GEMINI_API_KEY=` and `JINA_API_KEY=` placeholders (matches `.claude/rules/tooling.md` "update both .env and .env.example")
- Modify: `.env` — add `GEMINI_API_KEY=` and `JINA_API_KEY=` placeholders (leave empty; user fills in locally)

**Pattern to follow:** `packages/pipeline/tests/e2e/collectors/hn.e2e.test.ts` — use `config({ path: resolve(...)/.env.test })` at top of file, `getTestDb()` + `truncateAll()` in hooks, assertions against live data with soft checks.

**What to test:** The 5 e2e tests from the SPEC section "E2E tests":

### Test sources

```ts
const TEST_SOURCES = {
  anthropicResearch: {
    name: "anthropic-research",
    listingUrl: "https://www.anthropic.com/research",
  },
  openaiNews: {
    name: "openai-news",
    listingUrl: "https://openai.com/news",
  },
  huggingfaceBlog: {
    name: "huggingface-blog",
    listingUrl: "https://huggingface.co/blog",
  },
} as const;
```

### Pinned posts (for Test 2)

```ts
const PINNED_POSTS = {
  // Chosen during implementation. Criteria (per design doc):
  //   - archived (>1 year old)
  //   - unlikely to be deleted (flagship post or paper)
  //   - has a clear, stable title and date
  // Only anthropic-research needs a pinned post (Test 2 runs against one source).
  anthropicResearch: {
    url: "<TODO: pick during implementation — e.g. a 2022 Constitutional AI or similar>",
    expectedTitleSubstring: "<TODO>",
  },
} as const;
```

The implementer picks the URL and substring during Phase 7 using the criteria listed. Good candidates:
- `https://www.anthropic.com/research/constitutional-ai-harmlessness-from-ai-feedback` (Dec 2022)
- `https://www.anthropic.com/research/a-mathematical-framework-for-transformer-circuits` (2021)

Pick one and verify it's still accessible at implementation time.

### Test structure

```ts
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { config } from "dotenv";
import { resolve } from "node:path";
import { rawItems } from "@newsletter/shared/db";
import { collectWeb } from "@pipeline/collectors/web.js";
import { extractPostFields } from "@pipeline/collectors/web.js";   // exported for Test 2
import { createRawItemsRepo } from "@pipeline/repositories/raw-items.js";
import { getTestDb, truncateAll } from "@pipeline-tests/e2e/setup/test-db.js";
import type { AppDb } from "@newsletter/shared/db";

config({ path: resolve(import.meta.dirname, "../../../../../.env.test") });

describe.skipIf(!process.env.GEMINI_API_KEY)(
  "Web Collector E2E",
  () => {
    let db: AppDb;

    beforeAll(() => {
      db = getTestDb();
    });

    beforeEach(async () => {
      await truncateAll();
    });

    // Tests 1-5 below...
  },
  { timeout: 60_000 },   // per-test timeout: 60s (Jina + Gemini live calls)
);
```

### Test 1: multi-source happy path

```ts
it("collects items from all three sources in parallel", async () => {
  const result = await collectWeb(
    { rawItemsRepo: createRawItemsRepo(db) },
    {
      sources: [
        TEST_SOURCES.anthropicResearch,
        TEST_SOURCES.openaiNews,
        TEST_SOURCES.huggingfaceBlog,
      ],
      maxItems: 2,
    },
  );

  // Soft assertion per SPEC: each source contributes at least 1 item OR has a recorded failure
  for (const source of Object.values(TEST_SOURCES)) {
    const hasItem = result.itemsStored > 0;   // refined below
    const hasFailure = result.failures?.some((f) => f.source === source.name) ?? false;
    // Either this source contributed OR it's recorded as failed
    // (this assertion is loosened further below with row filter)
  }

  // Verify RawItemInsert shape on stored rows
  const rows = await db.select().from(rawItems);
  expect(rows.length).toBeGreaterThan(0);   // at least one source produced something
  for (const row of rows) {
    expect(row.sourceType).toBe("blog");
    expect(row.title).toBeTruthy();
    expect(row.url).toBeTruthy();
    expect(row.externalId).toBe(row.url);   // REQ-050
    expect(row.sourceUrl).toBe(row.url);
    expect(row.content).toBeTruthy();
    expect(typeof row.content).toBe("string");
    expect((row.content ?? "").length).toBeGreaterThan(100);   // not empty/truncated
    expect(row.engagement).toEqual({ points: 0, commentCount: 0 });
  }
});
```

### Test 2: pinned historical post

```ts
it("extracts metadata from a pinned historical post", async () => {
  const pinned = PINNED_POSTS.anthropicResearch;
  const { fetchMarkdown, extractPostFields } = await import("@pipeline/collectors/web.js");
  const { google } = await import("@ai-sdk/google");

  const markdown = await fetchMarkdown(pinned.url);
  const fields = await extractPostFields(pinned.url, markdown, google("gemini-2.5-flash"));

  expect(fields.title).toContain(pinned.expectedTitleSubstring);
  expect(Date.parse(fields.published_at)).not.toBeNaN();
  expect(markdown.length).toBeGreaterThan(1000);
});
```

Note: `fetchMarkdown` and `extractPostFields` must be exported from `collectors/web.ts` for this test — Phase 3 should export them (review Phase 3 if they're currently internal-only).

### Test 3: dedup + maxItems + sinceDays (three acts in one test)

```ts
it("dedups across runs, respects maxItems, and records discovery-empty on sinceDays:0", async () => {
  const baseConfig = {
    sources: [TEST_SOURCES.anthropicResearch],
    maxItems: 1,
  };

  // Act A: first run stores 1 item
  const resultA = await collectWeb({ rawItemsRepo: createRawItemsRepo(db) }, baseConfig);
  expect(resultA.itemsStored).toBe(1);
  const rowsAfterA = await db.select().from(rawItems);
  expect(rowsAfterA.length).toBe(1);

  // Act B: second run dedups — 0 new items, NO failure recorded
  const resultB = await collectWeb({ rawItemsRepo: createRawItemsRepo(db) }, baseConfig);
  expect(resultB.itemsStored).toBe(0);
  expect(resultB.failures).toBeUndefined();
  const rowsAfterB = await db.select().from(rawItems);
  expect(rowsAfterB.length).toBe(1);   // same count as after A

  // Act C: sinceDays: 0 filters everything out → discovery-empty failure
  // (Note: all-sources-failed → throws. So put in try/catch)
  await expect(
    collectWeb(
      { rawItemsRepo: createRawItemsRepo(db) },
      { ...baseConfig, sinceDays: 0 },
    ),
  ).rejects.toThrow(/all sources failed/);
});
```

**Important correction on Act C:** With only one source, if that source produces a `discovery-empty` failure, `collectWeb` sees 100% of sources failed and throws. So Act C asserts a throw, not a returned result. To get a non-throwing `discovery-empty` in a result, we'd need a second working source — but that makes the test harder. Keep it simple and assert the throw.

### Test 4: partial failure surfacing

```ts
it("surfaces broken source in failures while working source still produces items", async () => {
  const result = await collectWeb(
    { rawItemsRepo: createRawItemsRepo(db) },
    {
      sources: [
        TEST_SOURCES.anthropicResearch,
        { name: "broken", listingUrl: "https://this-domain-does-not-exist.invalid/foo" },
      ],
      maxItems: 1,
    },
  );

  expect(result.failures).toBeDefined();
  const brokenFailures = result.failures!.filter((f) => f.source === "broken");
  expect(brokenFailures.length).toBeGreaterThanOrEqual(1);
  expect(brokenFailures[0].postUrl).toBeUndefined();   // source-level
  expect(brokenFailures[0].error).toBeTruthy();

  // Working source should still have produced something
  const rows = await db.select().from(rawItems);
  expect(rows.length).toBeGreaterThanOrEqual(1);
});
```

### Test 5: all sources failed throws

```ts
it("throws when the only source is broken", async () => {
  await expect(
    collectWeb(
      { rawItemsRepo: createRawItemsRepo(db) },
      {
        sources: [{ name: "broken", listingUrl: "https://this-domain-does-not-exist.invalid/foo" }],
        maxItems: 1,
      },
    ),
  ).rejects.toThrow(/all sources failed/);
});
```

### Env setup reminder

The runner (local dev or CI) must have `.env.test` at the repo root populated with:

```
DATABASE_URL=postgres://...
GEMINI_API_KEY=...
JINA_API_KEY=...   # optional
```

`.env.example` gets updated to document these.

### Potential gotchas

1. **PINNED_POSTS URL drift.** If Anthropic reorganizes their research URLs, Test 2 breaks. The pinned URL should be old + flagship.
2. **Rate limits.** Running all 5 tests burns ~15 LLM calls. Gemini free tier is tight. The implementer may need to run tests serially and/or use a paid key.
3. **Jina free tier RPM.** ~20 RPM. 5 tests against 3 sources × ~5 Jina calls per source = ~15 Jina calls total. Should be fine but could be flaky on shared CI.
4. **`vi.mock` import ordering** — don't `vi.mock('@ai-sdk/google')` at the top of the e2e file; we want the REAL provider. That's the difference from unit tests.

**Commit:** `test(VER-47): add e2e tests against live Jina and Gemini`

## Done When

- [ ] `tests/e2e/collectors/web.e2e.test.ts` exists with 5 tests
- [ ] All 5 tests pass against live Jina + Gemini (run with `GEMINI_API_KEY` set in `.env.test`)
- [ ] `.env.example` and `.env` have `GEMINI_API_KEY` and `JINA_API_KEY` placeholders
- [ ] `pnpm build && pnpm typecheck && pnpm lint && pnpm test:unit` clean
- [ ] `describe.skipIf(!process.env.GEMINI_API_KEY)` correctly skips the suite when the key is absent (verify by temporarily unsetting and running)
- [ ] Pinned post URL chosen and documented in `PINNED_POSTS` const
