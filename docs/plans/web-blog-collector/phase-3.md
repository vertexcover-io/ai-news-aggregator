# Phase 3: LLM extraction helpers

> **Status:** pending
> **Traces to:** REQ-011 (discovery LLM call), REQ-012 (URL substring validation), REQ-041 (detail LLM call), REQ-042 (temperature: 0)
> **Depends on:** Phase 1 (types)

## Overview

After this phase, `collectors/web.ts` has Zod schemas for both LLM calls,
`discoverPostUrls` and `extractPostFields` helpers that wrap
`generateObject`, and URL substring validation. Unit tests exercise these
helpers against a mocked `LanguageModel`.

This phase is **independent of Phases 2 and 4** and can run in parallel
with them after Phase 1 lands.

## Implementation

**Files:**
- Modify: `packages/pipeline/src/collectors/web.ts` — add Zod schemas, `discoverPostUrls`, `extractPostFields`, `validateDiscoveredUrls`
- Modify: `packages/pipeline/tests/unit/collectors/web.test.ts` — add test cases for all three helpers
- Create: `packages/pipeline/tests/unit/fixtures/web-listing.json` — canned listing markdown (~30 lines of realistic blog-listing-style markdown with 5-6 post links + nav/footer noise)
- Create: `packages/pipeline/tests/unit/fixtures/web-post.json` — canned post markdown (~50 lines of realistic blog-post-style markdown with title, author line, date, body)

**Pattern to follow:**
- Vercel AI SDK: https://github.com/vercel/ai — use `generateObject({ model, schema, prompt, temperature: 0 })` from the `ai` package. Verify the exact signature via **context7** (`/vercel/ai` docs, query: "generateObject with Zod schema example") before writing code.
- Zod: standard `z.object({ posts: z.array(z.object({...})) })` pattern. No unions, no `z.record` (Gemini structured-output constraint per REQ-011 Gemini compatibility note in the design doc).
- Mocked `LanguageModel`: Vercel AI SDK provides `MockLanguageModelV2` (or similar test double) — check context7 `/vercel/ai` query: "unit test mock language model". If no official test double, use a minimal object that satisfies `LanguageModelV1` interface with a `doGenerate` method returning a pre-baked `object`.

**What to test:**
- `discoverPostUrls` returns an array of `{ url, title, published_at }` when the mocked LLM returns a valid object
- `discoverPostUrls` passes `temperature: 0` to `generateObject`
- `discoverPostUrls` passes the correct Zod schema to `generateObject`
- `discoverPostUrls` throws when `generateObject` throws
- `extractPostFields` returns `{ title, author, published_at }` when the mocked LLM returns a valid object
- `extractPostFields` passes `temperature: 0`
- `validateDiscoveredUrls` drops URLs not present in the listing markdown, keeps ones that are
- `validateDiscoveredUrls` does substring match (exact URL string appears in markdown text)

**Traces to:** REQ-011, REQ-012, REQ-041, REQ-042

**What to build:**

### Zod schemas

```ts
import { z } from "zod";

const DiscoverySchema = z.object({
  posts: z.array(
    z.object({
      url: z.string(),
      title: z.string(),
      published_at: z.string(),
    }),
  ),
});

const DetailSchema = z.object({
  title: z.string(),
  author: z.string(),
  published_at: z.string(),
});

type DiscoveredPost = z.infer<typeof DiscoverySchema>["posts"][number];
type ExtractedFields = z.infer<typeof DetailSchema>;
```

Both schemas use only `z.object` / `z.string` / `z.array` — no unions, no records — so they pass Gemini's structured-output constraints.

### `discoverPostUrls` helper

```ts
import { generateObject } from "ai";
import type { LanguageModelV1 } from "ai";   // verify exact type name via context7

export async function discoverPostUrls(
  listingUrl: string,
  listingMarkdown: string,
  model: LanguageModelV1,
): Promise<DiscoveredPost[]> {
  const { object } = await generateObject({
    model,
    schema: DiscoverySchema,
    temperature: 0,
    prompt:
      `You are extracting blog posts from a listing page that has been ` +
      `converted to markdown. The listing URL is ${listingUrl}.\n\n` +
      `Return the actual blog post entries in the order they appear on the page ` +
      `(top = newest). Skip everything that is not a post: navigation, footer, ` +
      `social links, "related posts" sidebars, author bios, tag indexes, pagination.\n\n` +
      `Use empty strings for fields you cannot determine \u2014 never invent data.\n\n` +
      `--- BEGIN LISTING MARKDOWN ---\n${listingMarkdown}\n--- END LISTING MARKDOWN ---`,
  });
  return object.posts;
}
```

### `extractPostFields` helper

```ts
export async function extractPostFields(
  postUrl: string,
  postMarkdown: string,
  model: LanguageModelV1,
): Promise<ExtractedFields> {
  const { object } = await generateObject({
    model,
    schema: DetailSchema,
    temperature: 0,
    prompt:
      `Extract title, author, and publish date from this blog post markdown. ` +
      `The source URL is ${postUrl}. ` +
      `Use empty strings for fields not stated on the page \u2014 never invent data.\n\n` +
      `--- BEGIN ARTICLE ---\n${postMarkdown}\n--- END ARTICLE ---`,
  });
  return object;
}
```

### `validateDiscoveredUrls` (anti-hallucination)

```ts
export function validateDiscoveredUrls(
  posts: DiscoveredPost[],
  listingMarkdown: string,
): DiscoveredPost[] {
  return posts.filter((p) => listingMarkdown.includes(p.url));
}
```

Plain substring check. REQ-012 says "does not appear as a substring of the listing markdown" — drop those.

### Mocking the LanguageModel in unit tests

Vercel AI SDK exports mock helpers under `ai/test`. Specifically `MockLanguageModelV1` (or similar — verify via context7). Signature roughly:

```ts
import { MockLanguageModelV1 } from "ai/test";

const mockModel = new MockLanguageModelV1({
  doGenerate: async () => ({
    rawCall: { rawPrompt: null, rawSettings: {} },
    finishReason: "stop",
    usage: { promptTokens: 10, completionTokens: 20 },
    text: JSON.stringify({ posts: [/* ... */] }),
  }),
});
```

**IMPORTANT:** The exact mock API may differ in the installed `ai` version. **Verify via context7 BEFORE writing the test.** Query: "mock language model unit test generateObject". If the project's AI SDK version has a different helper, use that. If there's no official mock, the fallback is a minimal object literal that satisfies the `LanguageModelV1` interface's required members — TypeScript will tell us what those are when we try to assign.

### Fixtures

`packages/pipeline/tests/unit/fixtures/web-listing.json`:

```json
{
  "listingUrl": "https://example.com/blog",
  "markdown": "... realistic listing markdown with ~5 post links as [title](url) items, plus nav, footer, sidebar noise ..."
}
```

Populate `markdown` with a realistic mix:
- Nav bar (3-4 links)
- "Latest posts" header
- 5 post cards as `[Post Title](https://example.com/blog/post-N)` with optional dates
- Footer (social links, legal)
- Sidebar with "related" / tag index

Use this fixture for discovery tests. One URL in the listing should NOT be present (to test `validateDiscoveredUrls` drop behavior when the mocked LLM "hallucinates" a URL).

`packages/pipeline/tests/unit/fixtures/web-post.json`:

```json
{
  "postUrl": "https://example.com/blog/post-1",
  "markdown": "# Example Post Title\n\nBy Jane Doe on March 15, 2026\n\n## Introduction\n\nBody paragraphs..."
}
```

### Unit test cases (add to web.test.ts)

1. `discoverPostUrls returns posts array from mocked LLM`
2. `discoverPostUrls passes temperature 0 to generateObject`
3. `discoverPostUrls passes DiscoverySchema to generateObject`
4. `discoverPostUrls throws when LLM throws`
5. `extractPostFields returns title/author/published_at from mocked LLM`
6. `extractPostFields passes temperature 0 to generateObject`
7. `extractPostFields passes DetailSchema to generateObject`
8. `validateDiscoveredUrls drops URLs not in listing markdown`
9. `validateDiscoveredUrls keeps URLs that appear as substrings`
10. `validateDiscoveredUrls handles empty input gracefully`

**Commit:** `feat(VER-47): add Gemini discovery and detail extractors`

## Done When

- [ ] Zod schemas defined (no unions, no records)
- [ ] `discoverPostUrls`, `extractPostFields`, `validateDiscoveredUrls` exported from `collectors/web.ts`
- [ ] 10 unit tests passing
- [ ] `pnpm build && pnpm typecheck && pnpm lint && pnpm test:unit` clean
- [ ] Mock language model strategy confirmed via context7 before writing tests

## Research required before coding

1. **context7 `/vercel/ai`**, query: "generateObject Zod schema temperature" — confirm the current signature
2. **context7 `/vercel/ai`**, query: "MockLanguageModelV1 unit test" — confirm the current mock helper name and shape
3. Look up exact installed versions of `ai` and `@ai-sdk/google` in `packages/pipeline/package.json` (installed by Phase 1) before relying on signatures
