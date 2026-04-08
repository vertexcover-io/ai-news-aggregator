# Phase 5: processSource + processOnePost

> **Status:** pending
> **Traces to:** REQ-012 (validation integration), REQ-031, REQ-060, REQ-061, REQ-062, REQ-072, REQ-073, REQ-074, REQ-075, REQ-076, REQ-077, REQ-078, REQ-081
> **Depends on:** Phases 2, 3, 4

## Overview

After this phase, `collectors/web.ts` has two orchestration functions:
`processOnePost` (handles one post's full lifecycle: fetch → extract →
validate → buildRawItem) and `processSource` (handles one source's full
lifecycle: discover → filter → dedup → fan out posts via `p-limit`).
Per-stage failure tracking is fully wired. No top-level `collectWeb` yet
— that's Phase 6.

## Implementation

**Files:**
- Modify: `packages/pipeline/src/collectors/web.ts` — add `processOnePost`, `processSource`, `ProcessSourceResult` type, `truncateError` helper, internal `CollectorError` subclass for stage-tagged throws
- Modify: `packages/pipeline/tests/unit/collectors/web.test.ts` — add test cases
- Modify: `packages/pipeline/tests/unit/fixtures/web-listing.json` and/or add `web-listing-with-dates.json` — if needed for date-based test cases

**Pattern to follow:** `packages/pipeline/src/collectors/reddit.ts:213-307` (`collectReddit`) for the per-source outer loop structure, though ours uses `Promise.allSettled` inside the source instead of the explicit for-loop pattern.

**What to test:** (one test per REQ the phase covers, plus edge-case combinations)

- REQ-076: `processOnePost` throws with stage `"detail-fetch"` when `fetchMarkdown` throws
- REQ-077: `processOnePost` throws with stage `"detail-llm"` when `extractPostFields` throws
- REQ-078: `processOnePost` throws with stage `"validate"` when extracted `title` is empty string
- Happy path: `processOnePost` returns a `RawItemInsert` with correct shape
- REQ-072: `processSource` records source-level failure (no `postUrl`) when listing `fetchMarkdown` throws
- REQ-073: `processSource` records source-level failure when `discoverPostUrls` throws
- REQ-074: `processSource` records source-level failure `discovery-empty` when `capped.length === 0` after filter (mocked LLM returns 3 old posts, `sinceDays: 1`)
- REQ-075: `processSource` returns `sourceFailed: false` and `items: []` when `newPosts.length === 0` after dedup (all 3 capped posts already in `findExistingExternalIds` set)
- REQ-012 integration: `processSource` drops hallucinated URLs before filtering
- REQ-031: `processSource` calls `findExistingExternalIds` with the capped URLs
- REQ-061: `processSource` respects `postConcurrency: 2` — max in-flight `processOnePost` calls is 2 at any moment (use a delayed mocked `fetchMarkdown` + instrumented counter)
- REQ-062: `processSource` uses `postConcurrency: 3` when not specified
- REQ-060 (source parallelism) is tested in Phase 6 at the `collectWeb` level
- REQ-081: `processSource` truncates error strings longer than `MAX_ERROR_LENGTH` (200 chars) in recorded `CollectorFailure.error`
- Edge: one post fails with `detail-fetch`, two others succeed → result has `items.length === 2` and `failures.length === 1`
- Edge: `sinceDays` filter drops all posts → source-level failure `discovery-empty`

**Traces to:** REQ-012, REQ-031, REQ-060, REQ-061, REQ-062, REQ-072, REQ-073, REQ-074, REQ-075, REQ-076, REQ-077, REQ-078, REQ-081

**What to build:**

### `ProcessSourceResult` type (internal to the file)

```ts
interface ProcessSourceResult {
  items: RawItemInsert[];
  failures: CollectorFailure[];
  sourceFailed: boolean;   // true iff the source produced 0 items due to a source-level failure
}
```

### Stage-tagged error class (internal)

Used to thread the stage tag through the `processOnePost` throw path without putting `stage` on `CollectorFailure` (REQ-082). The class is internal — never exported, never stored.

```ts
type FailureStage =
  | "discovery-fetch"
  | "discovery-llm"
  | "discovery-empty"
  | "detail-fetch"
  | "detail-llm"
  | "validate";

class CollectorError extends Error {
  constructor(
    public readonly stage: FailureStage,
    message: string,
  ) {
    super(message);
    this.name = "CollectorError";
  }
}
```

### `truncateError` helper

```ts
function truncateError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.length > MAX_ERROR_LENGTH
    ? msg.slice(0, MAX_ERROR_LENGTH)
    : msg;
}
```

### `processOnePost`

```ts
async function processOnePost(
  post: DiscoveredPost,
  fetchFn: typeof fetch,
  llmModel: LanguageModelV1,
): Promise<RawItemInsert> {
  let markdown: string;
  try {
    markdown = await fetchMarkdown(post.url, fetchFn);
  } catch (err) {
    throw new CollectorError("detail-fetch", truncateError(err));
  }

  let fields: ExtractedFields;
  try {
    fields = await extractPostFields(post.url, markdown, llmModel);
  } catch (err) {
    throw new CollectorError("detail-llm", truncateError(err));
  }

  if (!fields.title.trim()) {
    throw new CollectorError("validate", "empty title");
  }

  return buildRawItem(post.url, markdown, fields);
}
```

### Failure logging helper

```ts
function logFailure(
  source: string,
  stage: FailureStage,
  error: string,
  postUrl?: string,
): void {
  logger.warn(
    { event: "collector_failure", collector: "web", source, stage, postUrl, error },
    "collector failure",
  );
}
```

Note the `event: "collector_failure"` tag (REQ-072 log shape). `stage` lives in the log, never in the persistent failure shape (REQ-082).

### `processSource` — the big one

```ts
import pLimit from "p-limit";
import type { RawItemsRepo } from "@pipeline/repositories/raw-items.js";
import type { BlogSource, CollectorFailure, WebCollectConfig } from "@pipeline/types.js";

const DEFAULT_POST_CONCURRENCY = 3;

export async function processSource(
  source: BlogSource,
  config: WebCollectConfig,
  deps: {
    rawItemsRepo: RawItemsRepo;
    fetchFn: typeof fetch;
    llmModel: LanguageModelV1;
  },
): Promise<ProcessSourceResult> {
  // Step 1: fetch listing markdown
  let listingMarkdown: string;
  try {
    listingMarkdown = await fetchMarkdown(source.listingUrl, deps.fetchFn);
  } catch (err) {
    const error = truncateError(err);
    logFailure(source.name, "discovery-fetch", error);
    return {
      items: [],
      failures: [{ source: source.name, error }],
      sourceFailed: true,
    };
  }

  // Step 2: LLM discovery
  let discovered: DiscoveredPost[];
  try {
    discovered = await discoverPostUrls(source.listingUrl, listingMarkdown, deps.llmModel);
  } catch (err) {
    const error = truncateError(err);
    logFailure(source.name, "discovery-llm", error);
    return {
      items: [],
      failures: [{ source: source.name, error }],
      sourceFailed: true,
    };
  }

  // Step 3: anti-hallucination validation (REQ-012)
  const validated = validateDiscoveredUrls(discovered, listingMarkdown);

  // Step 4: apply sinceDays → slice(maxItems)
  const filtered = applySinceDays(validated, config.sinceDays);
  const capped = filtered.slice(0, config.maxItems);

  // Step 5: discovery-empty failure if capped is empty (REQ-074)
  if (capped.length === 0) {
    const error = "no posts after filter";
    logFailure(source.name, "discovery-empty", error);
    return {
      items: [],
      failures: [{ source: source.name, error }],
      sourceFailed: true,
    };
  }

  // Step 6: dedup pre-check (REQ-031)
  const existing = await deps.rawItemsRepo.findExistingExternalIds(
    "blog",
    capped.map((p) => p.url),
  );
  const newPosts = capped.filter((p) => !existing.has(p.url));

  // REQ-075: empty newPosts is NOT a failure — normal success for a source
  // that has nothing new today.
  if (newPosts.length === 0) {
    return { items: [], failures: [], sourceFailed: false };
  }

  // Step 7: per-post processing with p-limit (REQ-061, REQ-062)
  const limit = pLimit(config.postConcurrency ?? DEFAULT_POST_CONCURRENCY);
  const settled = await Promise.allSettled(
    newPosts.map((p) => limit(() => processOnePost(p, deps.fetchFn, deps.llmModel))),
  );

  // Step 8: partition settled into items and failures
  const items: RawItemInsert[] = [];
  const failures: CollectorFailure[] = [];
  for (let i = 0; i < settled.length; i++) {
    const result = settled[i];
    const post = newPosts[i];
    if (result.status === "fulfilled") {
      items.push(result.value);
    } else {
      const err = result.reason;
      const stage = err instanceof CollectorError ? err.stage : "detail-llm";
      const error = err instanceof Error ? err.message : String(err);
      logFailure(source.name, stage, error, post.url);
      failures.push({ source: source.name, postUrl: post.url, error });
    }
  }

  return { items, failures, sourceFailed: false };
}
```

Key points:
- The `capped.length === 0` check happens **before** the dedup pre-check (REQ-074 vs REQ-075 — this is the distinction we fixed earlier)
- `newPosts.length === 0` after dedup is a normal success — it's the expected happy state for subsequent daily runs
- `Promise.allSettled` is used so one failing post doesn't cascade to others in the same source
- `pLimit` wraps each `processOnePost` call to cap concurrent in-flight calls

### Unit test setup notes

Mocking `p-limit` is tricky — it's a pure function. The easy path is to let it run for real in tests. To verify REQ-061 (max in-flight is respected), use a delayed mocked `fetchMarkdown`:

```ts
// In the test setup:
let inFlight = 0;
let maxInFlight = 0;
const slowFetch = vi.fn().mockImplementation(async () => {
  inFlight++;
  maxInFlight = Math.max(maxInFlight, inFlight);
  await new Promise((resolve) => setTimeout(resolve, 10));
  inFlight--;
  return { ok: true, status: 200, text: () => Promise.resolve("Title: X\n\nMarkdown Content:\nbody") };
});

// After processSource returns:
expect(maxInFlight).toBeLessThanOrEqual(2);   // postConcurrency: 2
```

Don't use fake timers for this specific test — real setTimeout is needed so `p-limit` can actually schedule.

**Commit:** `feat(VER-47): add per-source processing with p-limit and failure tracking`

## Done When

- [ ] `processOnePost` and `processSource` exported from `collectors/web.ts`
- [ ] All REQs listed at top of this phase have a passing unit test
- [ ] `pnpm build && pnpm typecheck && pnpm lint && pnpm test:unit` clean
- [ ] All prior phase tests still pass
