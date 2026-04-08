# Phase 4: Ranking processor (Vercel AI SDK + Gemini)

> **Status:** pending
> **Depends on:** Phase 1
> **Traces to:** REQ-060, REQ-061, REQ-062, REQ-063, REQ-064, REQ-065, REQ-066, REQ-084, EDGE-008, EDGE-009, EDGE-010

## Overview

Adds a single-call ranking function backed by the Vercel AI SDK's `generateObject`
with a zod schema, defaulting to `google/gemini-2.5-flash` via `@ai-sdk/google`.
Loads the system prompt from an external markdown file so it can be iterated
without code changes.

## Library research note

Before implementation, use **context7** to confirm current `ai` + `@ai-sdk/google`
signatures:
- `generateObject({ model, system, prompt, schema, ... })` — verify parameter names
- How to instantiate the google provider and pass a model id
- Whether `google(...)` takes `"gemini-2.5-flash"` or `"models/gemini-2.5-flash"`

Do not assume API from memory per `.claude/rules/research-and-validation.md`.

## Implementation

**Files to create:**
- `packages/pipeline/src/processors/rank.ts`
- `packages/pipeline/prompts/rank-system.md`
- `packages/pipeline/tests/unit/processors/rank.test.ts`

**Package.json changes:**
- Add exact versions of `ai` and `@ai-sdk/google` and `zod` to
  `@newsletter/pipeline`. Pin to latest compatible releases (`pnpm add ai@<latest>
  @ai-sdk/google@<latest> zod@<latest>`).

### Candidate cap (REQ-060)

```typescript
const MAX_CANDIDATES = 100;

function capCandidates(items: RankCandidate[]): RankCandidate[] {
  if (items.length <= MAX_CANDIDATES) return items;
  return [...items]
    .sort((a, b) => engagementOf(b) - engagementOf(a))
    .slice(0, MAX_CANDIDATES);
}
```

### rank.ts skeleton

```typescript
import { z } from "zod";
import { generateObject } from "ai";
import { google } from "@ai-sdk/google";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createLogger } from "@newsletter/shared";
import type { RankedItemRef, SourceType } from "@newsletter/shared";

const logger = createLogger("processor:rank");

const DEFAULT_MODEL = "gemini-2.5-flash";
const PROMPT_PATH = resolve(__dirname, "../prompts/rank-system.md");
const rankSystemPrompt = readFileSync(PROMPT_PATH, "utf-8");

export interface RankCandidate {
  id: number;
  title: string;
  url: string;
  sourceType: SourceType;
  publishedAt: string | null; // ISO or null
  engagement: { points: number; commentCount: number };
}

export interface RankResult {
  rankedItems: RankedItemRef[];
  candidateCount: number;
  rankedCount: number;
}

const rankedEntrySchema = z.object({
  id: z.number().int(),
  score: z.number(),
  rationale: z.string().min(1),
});
const rankedResponseSchema = z.object({
  ranked: z.array(rankedEntrySchema),
});

export interface RankOptions {
  topN: number;
  modelId?: string;
}

export async function rankCandidates(
  candidates: RankCandidate[],
  options: RankOptions,
  // injectable for tests
  generate: typeof generateObject = generateObject,
): Promise<RankResult> {
  const capped = capCandidates(candidates);
  const modelId = options.modelId ?? process.env.RANKING_MODEL ?? DEFAULT_MODEL;

  if (capped.length === 0) {
    return { rankedItems: [], candidateCount: 0, rankedCount: 0 };
  }

  const userPayload = capped.map((c) => ({
    id: c.id,
    title: c.title,
    url: c.url,
    sourceType: c.sourceType,
    publishedAt: c.publishedAt,
    engagement: c.engagement,
  }));

  let result;
  try {
    result = await generate({
      model: google(modelId),
      system: rankSystemPrompt,
      prompt: JSON.stringify({ candidates: userPayload }),
      schema: rankedResponseSchema,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ event: "run.rank.failed", error: message }, "run.rank.failed");
    throw new Error(`ranking failed: ${message}`);
  }

  const validIds = new Set(capped.map((c) => c.id));
  const valid = result.object.ranked.filter((r) => validIds.has(r.id));
  if (valid.length === 0) {
    throw new Error("ranking returned no valid items");
  }

  const sorted = [...valid].sort((a, b) => b.score - a.score).slice(0, options.topN);

  const rankedItems: RankedItemRef[] = sorted.map((r) => ({
    rawItemId: r.id,
    score: r.score,
    rationale: r.rationale,
  }));

  logger.info(
    { event: "run.rank", candidateCount: capped.length, rankedCount: rankedItems.length },
    "run.rank",
  );

  return { rankedItems, candidateCount: capped.length, rankedCount: rankedItems.length };
}
```

### `prompts/rank-system.md`

```markdown
You rank AI news items for a technical audience (ML engineers, infra engineers,
researchers building LLM applications). Score each candidate 0–100 on:

- **Technical novelty** — new results, architectures, benchmarks, tools.
- **Practical value** — concrete for engineers shipping AI systems.
- **Signal vs noise** — penalize PR, funding news, recaps, listicles.

Return a ranked array with a one-line rationale per item. Include every
candidate you consider relevant (score > 30). Lower scores for recaps, fluff,
or marketing. Use the `id` field from the input verbatim.
```

### Build step note

Because `rank.ts` uses `readFileSync(__dirname + "../prompts/...")`, the
`prompts/rank-system.md` file must be present next to the built output. Either:

- (A) Use `import.meta.url` + `fileURLToPath` + `resolve` to compute the path
  relative to the source file at runtime, and add the prompts dir to the tsup
  build copy assets, **or**
- (B) Inline the prompt at build time via a `?raw` import — requires tsup
  loader config.

**Pick (A).** Update `packages/pipeline/tsup.config.ts` to copy
`src/prompts/**/*.md` into `dist/prompts/`, and compute the path via
`new URL("../prompts/rank-system.md", import.meta.url)`. Confirm by building and
checking `dist/prompts/rank-system.md` exists.

## What to test (REQ-060–066, EDGE-008–010)

1. **Truncation to 100 (REQ-060):** 150 candidates in → pass only top-100
   by engagement to the mocked `generate` (inspect the captured call arg).
2. **generateObject called once with correct schema shape (REQ-061):** mock
   `generate`, assert called once, assert the `schema` is the expected zod shape
   (check with a schema-shape comparison — safer: assert the schema is
   `rankedResponseSchema` by identity or by a `.shape` inspection).
3. **Payload shape per candidate (REQ-062):** inspect the `prompt` JSON,
   assert every entry has `id`, `title`, `url`, `sourceType`, `publishedAt`,
   `engagement`.
4. **Score sort + truncation to topN (REQ-063):** mock returns 10 scored items;
   call with `topN: 3`; assert exactly 3 items returned, in descending score order.
5. **Invalid-id filter (EDGE-008):** mock returns some IDs not in the candidate
   set → only known IDs returned. If all invalid → throws
   `"ranking returned no valid items"`.
6. **Failure propagation (REQ-064):** mock `generate` to throw → rank call
   rethrows as `"ranking failed: ..."` and logs `run.rank.failed`.
7. **Env-var model override (REQ-065):** `process.env.RANKING_MODEL = "gemini-2.5-pro"`
   → `google` called with that model id. Clear env → called with default.
8. **Prompt file load (REQ-066):** `rankSystemPrompt` is loaded from disk, not
   inlined. Sanity: `typeof rankSystemPrompt === "string"` and length > 0.
9. **Single-candidate (EDGE-009):** 1 candidate in, mock returns 1 scored → 1 item out.
10. **topN > candidates (EDGE-010):** 3 candidates, `topN: 10` → 3 items out.

## Dependency on GEMINI_API_KEY

The `@ai-sdk/google` provider reads `GOOGLE_GENERATIVE_AI_API_KEY` by default.
Rename or map `GEMINI_API_KEY` → `GOOGLE_GENERATIVE_AI_API_KEY` in the worker
boot (or pass via a provider factory). Document in `.env.example`:

```
# Required for ranking
GEMINI_API_KEY=
RANKING_MODEL=gemini-2.5-flash   # optional
```

At pipeline worker startup (in `packages/pipeline/src/index.ts` or a bootstrap
file), verify presence and hard-fail fast with a clear message if missing.

**Commit:** `feat(VER-run-ui): add ranking processor via Vercel AI SDK + Gemini`

## Done When

- [ ] `rank.ts` with candidate cap, single generateObject call, zod schema
- [ ] `prompts/rank-system.md` loaded at runtime (not inlined)
- [ ] Unit tests pass for all 10 cases above with mocked `generate`
- [ ] `ai`, `@ai-sdk/google`, `zod` added with exact pinned versions
- [ ] `.env.example` updated
- [ ] tsup config copies `prompts/` into `dist/`; `pnpm build` includes the prompt file
