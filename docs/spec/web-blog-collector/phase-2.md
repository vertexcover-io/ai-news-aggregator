# Phase 2: Jina fetch helper

> **Status:** pending
> **Traces to:** REQ-010 (Jina fetch + envelope strip), REQ-040 (same applied to post URLs), REQ-100 (retry on 429), REQ-101 (non-retryable 4xx)
> **Depends on:** Phase 1 (types)

## Overview

After this phase, `packages/pipeline/src/collectors/web.ts` exists with a
`fetchMarkdown` helper that fetches a URL through Jina Reader, strips the
Jina envelope, and retries transient failures with exponential backoff.
Nothing else in `web.ts` yet.

## Implementation

**Files:**
- Create: `packages/pipeline/src/collectors/web.ts` — module-level constants, `fetchMarkdown` helper
- Create: `packages/pipeline/tests/unit/collectors/web.test.ts` — unit tests for `fetchMarkdown` (this file will grow across phases 2-6)
- Create: `packages/pipeline/tests/unit/fixtures/web-jina-envelope.json` — one canned Jina response with the full envelope (`Title:`, `URL Source:`, `Markdown Content:` prefix + body)

**Pattern to follow:** `packages/pipeline/src/collectors/hn.ts:83-115` (`fetchWithRetry`). Same shape: explicit retry loop, exponential backoff via `Math.pow(2, attempt) * 1000`, short-circuit on non-retryable 4xx.

**What to test:**
- Happy path: 200 OK → returns stripped body (envelope headers gone)
- Envelope stripping: input with `Title: Foo\nURL Source: https://x\n\nMarkdown Content:\n<body>` → output is exactly `<body>`
- No envelope: input that doesn't contain `\nMarkdown Content:\n` → return raw trimmed
- 429 then 200 → retries once, returns body on second call
- 502 then 502 then 200 → retries twice, returns body on third call
- 502 three times in a row → throws after 3 attempts (not infinite)
- 404 (non-retryable 4xx) → throws immediately, `fetch` called exactly once
- Network error (rejected promise) → retries per backoff schedule, throws after limit
- `JINA_API_KEY` header: if `process.env.JINA_API_KEY` is set, the fetch includes `Authorization: Bearer <key>`. If unset, no auth header.

**Traces to:** REQ-010, REQ-040, REQ-100, REQ-101

**What to build:**

### `packages/pipeline/src/collectors/web.ts`

Start the file with module-level constants that will grow across phases. Establishing them here sets the pattern:

```ts
import { createLogger } from "@newsletter/shared/logger";

const logger = createLogger("collector:web");

const JINA_BASE_URL = "https://r.jina.ai/";
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;   // exponential: 1s, 2s, 4s
const MAX_ERROR_LENGTH = 200;       // used in Phase 5
```

### `fetchMarkdown` helper

```ts
export async function fetchMarkdown(
  url: string,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<string> {
  const jinaUrl = `${JINA_BASE_URL}${url}`;
  const headers: Record<string, string> = { Accept: "text/plain" };
  const apiKey = process.env.JINA_API_KEY;
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetchFn(jinaUrl, { headers });
      if (!response.ok) {
        const status = response.status;
        if (status >= 400 && status < 500 && status !== 429) {
          throw new Error(`Non-retryable HTTP ${status} for ${url}`);
        }
        throw new Error(`HTTP ${status} for ${url}`);
      }
      const raw = await response.text();
      return stripJinaEnvelope(raw);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (lastError.message.startsWith("Non-retryable")) throw lastError;
      if (attempt < MAX_RETRIES - 1) {
        await delay(Math.pow(2, attempt) * RETRY_BASE_DELAY_MS);
      }
    }
  }

  throw lastError ?? new Error(`fetchMarkdown failed after ${MAX_RETRIES} retries`);
}

function stripJinaEnvelope(raw: string): string {
  const bodyMatch = raw.match(/\nMarkdown Content:\n([\s\S]*)$/);
  return (bodyMatch ? bodyMatch[1] : raw).trim();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

Notes:
- `fetchFn` is a parameter with a default. Phase 5 will call this via `deps.fetchFn ?? globalThis.fetch` wrapper. Keep the helper generic.
- The helper is **not** exported to consumers outside the collector — it's module-internal. But unit tests import it directly via `@pipeline/collectors/web.js` + re-export; confirm export syntax during implementation.
- `logger` is imported here but not used yet. That's fine — Phase 5 uses it for failure events.

### Unit tests

Create `packages/pipeline/tests/unit/collectors/web.test.ts`. Use fake timers so the backoff delays don't actually sleep (mirrors `hn.test.ts:55` `vi.useFakeTimers({ shouldAdvanceTime: true })`).

Mock `fetch` with the same `createMockFetch` pattern as `hn.test.ts:21-35` but returning `{ ok, status, text: () => Promise.resolve(body) }` since Jina returns text, not JSON.

Import the function dynamically inside `beforeEach`:
```ts
beforeEach(async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const mod = await import("@pipeline/collectors/web.js");
  fetchMarkdown = mod.fetchMarkdown;
});
```

Test cases (mapping to REQs):
1. `fetchMarkdown returns the stripped body on 200` (REQ-010)
2. `fetchMarkdown strips the Jina envelope (Title: / URL Source: / Markdown Content:)` (REQ-010)
3. `fetchMarkdown returns raw trimmed when envelope is missing` (REQ-010 edge)
4. `fetchMarkdown retries on 429 and returns body on success` (REQ-100)
5. `fetchMarkdown retries on 502 up to MAX_RETRIES then throws` (REQ-100)
6. `fetchMarkdown does not retry on 404` (REQ-101) — assert `fetchFn` called exactly once
7. `fetchMarkdown does not retry on 400` (REQ-101)
8. `fetchMarkdown adds Authorization header when JINA_API_KEY is set`
9. `fetchMarkdown omits Authorization header when JINA_API_KEY is unset`

For tests 8 and 9, use `vi.stubEnv('JINA_API_KEY', ...)` inside the test.

### Fixture

`packages/pipeline/tests/unit/fixtures/web-jina-envelope.json`:

```json
{
  "envelope": "Title: Example Post\nURL Source: https://example.com/post\n\nMarkdown Content:\n# Hello World\n\nThis is the body.\n\n[A link](https://example.com/other)",
  "expectedBody": "# Hello World\n\nThis is the body.\n\n[A link](https://example.com/other)"
}
```

Import via `@pipeline-tests/unit/fixtures/web-jina-envelope.json`. Use both fields in the test to verify the strip.

**Commit:** `feat(VER-47): add Jina fetch helper with retry`

## Done When

- [ ] `packages/pipeline/src/collectors/web.ts` exists with `fetchMarkdown` exported
- [ ] 9 unit tests passing in `tests/unit/collectors/web.test.ts`
- [ ] `pnpm build && pnpm typecheck && pnpm lint && pnpm test:unit` clean
- [ ] Existing tests still pass (51 from baseline + new web tests)
