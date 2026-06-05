---
governs: packages/shared/src/services/
last_verified_sha: ad0153a
key_files: [credential-cipher.ts, source-identifier.ts, url-safety.ts, static-page-fetcher.ts, item-lifecycle.ts, archive-search-text.ts, page-metadata.ts, summary-source.ts, collector-health-store.ts]
flow_fns: [credential-cipher.ts::getCredentialCipher, source-identifier.ts::deriveRawItemIdentifier, url-safety.ts::canonicalizeFetchUrl, static-page-fetcher.ts::fetchPageStatic, item-lifecycle.ts::classifyItemLifecycle, archive-search-text.ts::serializeArchiveSearchText, collector-health-store.ts::createCollectorHealthStore]
decisions: [D-104, D-106]
status: active
---

# services/ — pure utility services shared across api and pipeline

## Purpose
Stateless utility functions needed by both API and pipeline: credential encryption, source identity derivation, URL safety guards, HTML fetching, item lifecycle classification, archive search text serialization, page metadata extraction, and summary source selection.

## Public surface
- getCredentialCipher(env?) → CredentialCipher — AES-256-GCM encrypt/decrypt with HKDF from SESSION_SECRET
- deriveRawItemIdentifier(args) → string — stable identity from URL per SourceType (subreddit, @handle, owner/repo, hostname)
- canonicalizeFetchUrl(url) → string | null — SSRF guard + URL normalization
- fetchPageStatic(url, opts) → StaticFetchOk | { error } — safe HTML fetch (15s timeout, 2MB limit)
- classifyItemLifecycle(input) → RunSourceItem — traces item through fetched→enrich→dedup→shortlist→rank
- serializeArchiveSearchText(input) → string — builds FTS document (64KB limit)
- extractPageMetadata(html, url) → PageMetadata — JSON-LD + OG fallback
- pickSummarySource(content, enrichedLink) → SummarySource
- createCollectorHealthStore(redis) → CollectorHealthStore — Redis read/write for `collector-health:<collector>` keys: `set(result)`, `setRunning(collector, trigger, now)`, `getSnapshot()`. Both writers use `redis.set` with NO `EX` (persists forever, REQ-007). `getSnapshot` always returns exactly the 5 `HEALTH_CHECKABLE_COLLECTORS` in order; unset/malformed keys decode to a `status:"never"` all-nulls entry (defensive read).

## Data flows
getCredentialCipher(env?) → CredentialCipher:
  SESSION_SECRET → WeakMap cache → HKDF("sha256", secret, "social-creds-v1", "", 32)
  encrypt: randomBytes(12) IV → AES-256-GCM → { ct, iv, tag }
  decrypt: blob → decipher → setAuthTag → plaintext

deriveRawItemIdentifier(args) → string:
  switch sourceType:
    hn → "news.ycombinator.com"
    reddit → regex /\/r\/([^/?#]+)/i → "r/{subreddit}"
    twitter → regex extract handle → "@{handle}"
    github → regex extract owner/repo
    blog/rss → hostname
    web_search → query text or "web search"

fetchPageStatic(url, opts) → result:
  canonicalizeFetchUrl → SSRF check → fetch with signal + timeout
    ├─ status 5xx/4xx → error
    ├─ non-HTML content-type → error
    ├─ >2MB → error
    └─ ok → { html, finalUrl }

createCollectorHealthStore(redis) → CollectorHealthStore:
  set(result) → redis.set(collector-health:<c>, JSON(result))   (NO EX — persists, REQ-007)
  setRunning(c, trigger, now) → redis.set(..., JSON({status:"running", checkedAt:now, durationMs/reason/detail:null}))
  getSnapshot() → redis.mget(5 keys) → map each:
    ├─ null → NEVER_ENTRY(c)  {status:"never", all nulls}
    ├─ JSON.parse ok → CollectorHealthResult
    └─ parse throws → NEVER_ENTRY(c)  (defensive — malformed key treated as never)
    → { collectors: [5 entries, in HEALTH_CHECKABLE_COLLECTORS order] }

## Gotchas / landmines
1. SESSION_SECRET rotation breaks all encrypted credentials (D-104)
2. deriveRawItemIdentifier JS↔SQL alignment critical (D-106)
3. serializeArchiveSearchText truncates at byte boundary (64KB)
4. **Collector-health keys have NO TTL** — `set`/`setRunning` never pass `EX`, so the latest result persists indefinitely (REQ-007). The snapshot always synthesizes a `never` entry for any of the 5 collectors whose key is absent or malformed JSON — it never returns fewer than 5 entries.
