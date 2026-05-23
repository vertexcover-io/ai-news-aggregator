# Phase 1: Shared `url-safety` + static page fetcher

> **Status:** pending

## Overview

Extract two helpers from `packages/pipeline/` into `packages/shared/` so both the API and the pipeline can use them. After this phase, the API can safely fetch a public URL and extract page metadata without importing pipeline code.

## Implementation

**Files:**

- Create: `packages/shared/src/services/url-safety.ts`
  - Export: `isPrivateOrLoopbackHost(host: string): boolean`
  - Export: `canonicalizeFetchUrl(url: string): string | null` — wraps `new URL`, lowercases hostname, rejects non-http(s), rejects via `isPrivateOrLoopbackHost`
- Create: `packages/shared/src/services/static-page-fetcher.ts`
  - Export: `fetchPageStatic(url: string, opts: { signal?: AbortSignal, timeoutMs?: number }): Promise<{ html: string, finalUrl: string } | { error: "ssrf" | "timeout" | "http_4xx" | "http_5xx" | "non_html" | "too_large" | "network" }>`
  - Uses `globalThis.fetch` only (no Crawlee, no browser)
  - 15s default timeout, 2MB max body size, follows redirects but re-validates each hop with `canonicalizeFetchUrl`
- Create: `packages/shared/src/services/page-metadata.ts`
  - Export: `extractPageMetadata(html: string, url: string): { title: string | null, author: string | null, year: number | null }`
  - Priority order: JSON-LD `application/ld+json` (Article schema) → OG (`og:title`, `article:author`, `article:published_time`) → `<meta name="author">`, `<meta name="date">` → `<title>` element fallback for title
  - Uses a lightweight HTML parser — pick `node-html-parser` (already a transitive dep, verify; if not, add it to `packages/shared/package.json`)
- Modify: `packages/shared/package.json` — add `node-html-parser` to dependencies if missing
- Modify: `packages/shared/tsup.config.ts` and `packages/shared/package.json#exports` — add subpath exports for the three new modules
- Modify: `packages/pipeline/src/services/link-enrichment/url-classifier.ts`
  - Replace the local `isPrivateOrLoopbackHost` with `export { isPrivateOrLoopbackHost } from "@newsletter/shared/services/url-safety"`
  - Keep the `canonicalizeEnrichmentUrl` wrapper but have it call the shared `canonicalizeFetchUrl` and add the enrichment-specific suffix-list logic on top

**Tests:**

- Create: `packages/shared/tests/unit/services/url-safety.test.ts`
  - `isPrivateOrLoopbackHost` truthy for: `localhost`, `127.0.0.1`, `10.0.0.5`, `172.16.0.1`, `172.31.255.254`, `192.168.1.1`, `169.254.169.254`, `[::1]`, `[fc00::]`, `0.0.0.0`
  - `isPrivateOrLoopbackHost` falsy for: `example.com`, `1.1.1.1`, `8.8.8.8`, `192.169.1.1` (just outside private range), `172.32.0.1` (just outside private range)
  - `canonicalizeFetchUrl` returns null for: `javascript:alert(1)`, `file:///etc/passwd`, `http://localhost/`, `http://10.0.0.1/`
  - `canonicalizeFetchUrl` returns lowercase-hostname URL string for: `HTTPS://EXAMPLE.COM/Path`
- Create: `packages/shared/tests/unit/services/static-page-fetcher.test.ts`
  - Mocks `globalThis.fetch` to return a small HTML page → returns `{ html, finalUrl }`
  - Mocks `fetch` to return 404 → returns `{ error: "http_4xx" }`
  - Mocks `fetch` to never resolve + 100ms timeout → returns `{ error: "timeout" }`
  - Mocks `fetch` to return non-text/html content-type → returns `{ error: "non_html" }`
  - Calls with `http://localhost/` (before mocking fetch) → returns `{ error: "ssrf" }`, fetch never invoked
- Create: `packages/shared/tests/unit/services/page-metadata.test.ts`
  - Fixture: minimal HTML with `<title>Foo</title>` → `{ title: "Foo", author: null, year: null }`
  - Fixture: HTML with JSON-LD Article schema → extracts title, author, year from JSON-LD
  - Fixture: HTML with OG tags only → extracts title from `og:title`, author from `article:author`, year from `article:published_time`
  - Fixture: HTML with everything → JSON-LD wins
- Modify: `packages/pipeline/tests/unit/services/link-enrichment/url-classifier.test.ts` if it tests `isPrivateOrLoopbackHost` directly — adjust import path or delete the duplicate test

**Pattern to follow:** `packages/shared/src/services/credential-cipher.ts` — existing shared service with subpath export and its own tests.

**Traces to:** NF-007 (SSRF range coverage), NF-008 (SSRF rejection behavior), supports REQ-020/REQ-021 (preview endpoint depends on these helpers)

**What to build:**

The static fetcher is the only piece with subtle behavior. Pseudocode:

```ts
export async function fetchPageStatic(url: string, opts: FetchOpts) {
  const canonical = canonicalizeFetchUrl(url);
  if (!canonical) return { error: "ssrf" };

  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (opts.signal) opts.signal.addEventListener("abort", () => controller.abort());

  try {
    const res = await fetch(canonical, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "AgentLoop-LinkPreview/1.0" },
    });
    if (res.status >= 500) return { error: "http_5xx" };
    if (res.status >= 400) return { error: "http_4xx" };

    const ct = res.headers.get("content-type") ?? "";
    if (!ct.toLowerCase().startsWith("text/html")) return { error: "non_html" };

    // Re-validate final URL post-redirects.
    const finalCanonical = canonicalizeFetchUrl(res.url);
    if (!finalCanonical) return { error: "ssrf" };

    // 2MB cap.
    const reader = res.body?.getReader();
    if (!reader) return { error: "network" };
    let received = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > 2_000_000) return { error: "too_large" };
      chunks.push(value);
    }
    const html = new TextDecoder().decode(Buffer.concat(chunks));
    return { html, finalUrl: finalCanonical };
  } catch (err) {
    if ((err as Error).name === "AbortError") return { error: "timeout" };
    return { error: "network" };
  } finally {
    clearTimeout(timer);
  }
}
```

Metadata extraction prioritizes JSON-LD because it's the most semantically rich and least likely to be wrong. OG tags second because they're standardized. `<meta name="author">` and `<title>` are last-resort fallbacks.

**Commit:** `feat(shared): extract url-safety + static page fetcher for cross-package use`

## Done When

- [ ] All three shared modules exported with correct subpath exports
- [ ] Pipeline still passes `pnpm --filter @newsletter/pipeline test:unit` after re-export shim
- [ ] New shared unit tests all pass
- [ ] `pnpm typecheck` green
- [ ] `pnpm lint` green (no relative imports, no rule violations)
