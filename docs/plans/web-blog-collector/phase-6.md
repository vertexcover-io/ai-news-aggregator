# Phase 6: collectWeb + worker dispatch

> **Status:** pending
> **Traces to:** REQ-001 (dispatch integration), REQ-002, REQ-032, REQ-052, REQ-060 (top-level parallelism), REQ-079, REQ-080, REQ-090, REQ-091, REQ-092
> **Depends on:** Phase 5

## Overview

After this phase, `collectWeb` exists as the top-level orchestrator. It
fans out across sources in parallel via `Promise.all`, aggregates items
and failures, throws if every source failed, upserts the batch, logs
start/complete events, and returns a `WebCollectorResult`. The BullMQ
worker dispatcher routes `"web-collect"` jobs to it.

## Implementation

**Files:**
- Modify: `packages/pipeline/src/collectors/web.ts` — add `collectWeb`, `resolveDefaultModel` lazy-default helper
- Modify: `packages/pipeline/src/workers/collection.ts` — add `"web-collect"` case
- Modify: `packages/pipeline/tests/unit/collectors/web.test.ts` — add `collectWeb` test cases
- Create: `packages/pipeline/tests/unit/workers/collection.test.ts` — unit test for the worker dispatch switch (if no existing file; otherwise modify)

**Pattern to follow:** `packages/pipeline/src/collectors/hn.ts:176-241` (`collectHn`) for the top-level structure. `packages/pipeline/src/workers/collection.ts:14-29` for dispatch.

**What to test:**

- REQ-001 (dispatch): `handleCollectionJob({ name: "web-collect", data: { config } })` calls `collectWeb` with the correct config and a constructed `rawItemsRepo`
- REQ-002: worker switch handles `"web-collect"` case (covered by REQ-001 test)
- REQ-060 (top-level parallelism): with 2 mocked sources and delayed listing fetches, source 2 starts before source 1 finishes (instrument start times)
- REQ-079: `collectWeb` throws when **every** source fails (all `sourceFailed === true`). No rows upserted.
- REQ-080: `collectWeb` returns a result (does NOT throw) when some sources fail and at least one succeeds. `failures` contains the failed sources' entries. Working source's items are upserted.
- REQ-090: `collectWeb` returns `failures: undefined` when all sources succeed with no failures at all
- REQ-090: `collectWeb` returns `failures: [...non-empty...]` when any failure occurred
- REQ-032: `collectWeb` idempotency — running twice on the same sources produces same row count (second run is all deduped). Verifiable by asserting `upsertItems` is called with the same items on the first run and with an empty array (or not called) on the second.
- REQ-052: `collectWeb` calls `upsertItems` exactly once with the aggregated batch
- REQ-091: end-of-job `info` log has `{ itemsFetched, itemsStored, failures: N, durationMs, msg: "collection completed" }`
- REQ-092: start-of-job `info` log fires before any per-source work
- Edge: `sources: []` → returns `itemsFetched: 0`, `itemsStored: 0`, no throw, no failures (boundary test EDGE-018)

**Traces to:** REQ-001, REQ-002, REQ-032, REQ-052, REQ-060, REQ-079, REQ-080, REQ-090, REQ-091, REQ-092, EDGE-018

**What to build:**

### Lazy default model resolution

```ts
import { generateObject } from "ai";
import type { LanguageModelV1 } from "ai";
// Note: `google` is imported lazily inside resolveDefaultModel to avoid
// reading GEMINI_API_KEY at module load time (which would break unit tests).
let cachedDefaultModel: LanguageModelV1 | null = null;

async function resolveDefaultModel(): Promise<LanguageModelV1> {
  if (cachedDefaultModel) return cachedDefaultModel;
  const { google } = await import("@ai-sdk/google");
  cachedDefaultModel = google("gemini-2.5-flash");
  return cachedDefaultModel;
}
```

Dynamic import inside the function means the `@ai-sdk/google` module is only pulled in when an actual collection runs, not when the module is loaded by a unit test. GEMINI_API_KEY is read by the provider at model-use time, not import time.

**Alternative if dynamic import is messy:** import `google` at top-level but construct the model lazily inside `resolveDefaultModel`. The provider function itself doesn't read the env — only the first API call does. Verify via context7 `/vercel/ai` before deciding.

### `collectWeb`

```ts
export interface WebCollectorDeps {
  rawItemsRepo: RawItemsRepo;
  fetchFn?: typeof fetch;
  llmModel?: LanguageModelV1;
}

export async function collectWeb(
  deps: WebCollectorDeps,
  config: WebCollectConfig,
): Promise<WebCollectorResult> {
  const startTime = Date.now();
  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  const llmModel = deps.llmModel ?? (await resolveDefaultModel());

  logger.info(
    { sourceCount: config.sources.length, maxItems: config.maxItems, sinceDays: config.sinceDays },
    "collection started",
  );

  // REQ-060: source-level parallelism
  const results = await Promise.all(
    config.sources.map((source) =>
      processSource(source, config, { rawItemsRepo: deps.rawItemsRepo, fetchFn, llmModel }),
    ),
  );

  // Aggregate
  const allItems: RawItemInsert[] = [];
  const allFailures: CollectorFailure[] = [];
  for (const r of results) {
    allItems.push(...r.items);
    allFailures.push(...r.failures);
  }

  // REQ-079: throw when every source failed
  if (config.sources.length > 0 && results.every((r) => r.sourceFailed)) {
    throw new Error("all sources failed");
  }

  // Upsert (REQ-052)
  if (allItems.length > 0) {
    await deps.rawItemsRepo.upsertItems(allItems);
  }

  const durationMs = Date.now() - startTime;
  const result: WebCollectorResult = {
    itemsFetched: allItems.length,
    itemsStored: allItems.length,
    commentsFetched: 0,
    durationMs,
    failures: allFailures.length > 0 ? allFailures : undefined,
  };

  logger.info(
    {
      itemsFetched: result.itemsFetched,
      itemsStored: result.itemsStored,
      failures: result.failures?.length ?? 0,
      durationMs,
    },
    "collection completed",
  );

  return result;
}
```

Notes:
- `deps.fetchFn ?? globalThis.fetch` — test injection point
- `deps.llmModel ?? (await resolveDefaultModel())` — lazy default
- `Promise.all` not `Promise.allSettled` at this level — `processSource` never throws (it returns a `ProcessSourceResult`), so failures are already captured in the result structure
- `config.sources.length > 0` guard on the all-failed throw means `sources: []` → no throw, no rows, clean exit (EDGE-018)
- `itemsFetched` and `itemsStored` are the same number for this collector — we assemble and upsert everything we successfully built. Partial upsert failures are not a concern at this layer.

### Worker dispatch

Edit `packages/pipeline/src/workers/collection.ts`:

```ts
import { collectWeb } from "@pipeline/collectors/web.js";
import type { HnCollectConfig, RedditCollectConfig, WebCollectConfig } from "@pipeline/types.js";

export interface CollectionJobLike {
  name: string;
  data: { config: HnCollectConfig | RedditCollectConfig | WebCollectConfig };
}

export async function handleCollectionJob(job: CollectionJobLike): Promise<CollectorResult> {
  switch (job.name) {
    case "hn-collect": { ... }
    case "reddit-collect": { ... }
    case "web-collect": {
      const db = getDb();
      const rawItemsRepo = createRawItemsRepo(db);
      return collectWeb({ rawItemsRepo }, job.data.config as WebCollectConfig);
    }
    default:
      throw new Error(`Unknown collector: ${job.name}`);
  }
}
```

The return type stays `Promise<CollectorResult>` — `WebCollectorResult extends CollectorResult` is assignable, so the structural subtype passes through without a type assertion (REQ-071).

### Unit test setup for `collectWeb`

Mock everything except `processSource` via helper injection:

```ts
const mockRepo = createMockRepo();
const mockFetch = createMockFetch([
  // listing response for source 1
  { ok: true, status: 200, text: () => Promise.resolve(LISTING_WITH_ENVELOPE) },
  // detail response for post 1
  { ok: true, status: 200, text: () => Promise.resolve(POST_WITH_ENVELOPE) },
  // listing + detail for source 2
  // ...
]);
const mockModel = createMockLlmModel([/* discovery response, detail response, ... */]);

const result = await collectWeb(
  { rawItemsRepo: mockRepo, fetchFn: mockFetch, llmModel: mockModel },
  { sources: [source1, source2], maxItems: 5 },
);
```

This exercises the whole stack from `collectWeb` down through `processSource` and `processOnePost` with mocks at the I/O boundary. It's a broader test than the per-helper tests but catches integration bugs between phases.

### Worker dispatch test

Create/modify `packages/pipeline/tests/unit/workers/collection.test.ts`:

```ts
it("routes web-collect jobs to collectWeb", async () => {
  // Use a mocked @pipeline/collectors/web module via vi.mock
  vi.mock("@pipeline/collectors/web.js", () => ({
    collectWeb: vi.fn().mockResolvedValue({ itemsFetched: 0, itemsStored: 0, commentsFetched: 0, durationMs: 0 }),
  }));

  const { handleCollectionJob } = await import("@pipeline/workers/collection.js");
  const { collectWeb } = await import("@pipeline/collectors/web.js");

  await handleCollectionJob({
    name: "web-collect",
    data: { config: { sources: [], maxItems: 5 } },
  });

  expect(collectWeb).toHaveBeenCalledOnce();
});
```

If this is the first test file under `tests/unit/workers/`, also check if the existing test pattern for `handleCollectionJob` exists elsewhere first (grep for `handleCollectionJob`). If a test file already exists, add the new case to it.

**Commit:** `feat(VER-47): add collectWeb top-level and worker dispatch`

## Done When

- [ ] `collectWeb` exported from `collectors/web.ts`
- [ ] `workers/collection.ts` routes `"web-collect"` to `collectWeb`
- [ ] All REQs listed at top of this phase have passing unit tests
- [ ] `pnpm build && pnpm typecheck && pnpm lint && pnpm test:unit` clean
- [ ] `CollectorResult` in `@newsletter/shared/types/index.ts` is **still unchanged**
- [ ] All phase 1-5 tests still pass
