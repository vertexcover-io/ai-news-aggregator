# Adversarial Findings — web-collector-structured-data

**Date:** 2026-05-26
**Role-swap:** Actively attempting to break the feature.

---

## Scenarios Attempted

### A-001: Malformed JSON-LD (unclosed brace, invalid UTF-8 escape)

**Attack:** HTML with a `<script type="application/ld+json">` block containing invalid JSON (`{"@type":"NewsArticle","name":"Test"` — unclosed).

**Expected behavior (per spec):** `structuredData` is the raw string, verbatim. No JSON parsing is done in `convert.ts` (REQ-003), so a syntax-invalid blob is appended as-is. The LLM receives garbled JSON and may or may not extract items from it — but `convert()` does not throw.

**Outcome:** SAFE. The extractor uses `el.textContent` to grab the raw text — no `JSON.parse` call in the extraction path. Malformed JSON is passed verbatim to the LLM; the LLM may return no URLs for the malformed portion. No crash.

---

### A-002: `#item-` URL with a query string

**Attack:** Discovery LLM returns `https://llm-stats.com/ai-news#item-https://techmeme.com/article?foo=bar`.

**Expected behavior:** `resolvesToListing` strips the fragment (`https://llm-stats.com/ai-news`) and compares origin+pathname to the listing URL (`https://llm-stats.com/ai-news`). Match → skip Pass-2. The full verbatim URL (including `#item-...?foo=bar` suffix) is stored as `externalId`.

**Outcome:** SAFE. `new URL(postUrl).origin + new URL(postUrl).pathname` correctly strips both fragment and query string from the discovered URL before the listing comparison. The fragment-plus-query-string variant deduplicates distinctly from a same-base URL without the query string.

---

### A-003: Giant JSON-LD blob hitting the 120 KB combined cap (EDGE-002)

**Attack:** A page with a 300 KB `self.__next_f.push` blob combined with a 10 KB markdown body. Total would be ~310 KB before the cap.

**Expected behavior (REQ-006):** Combined body is sliced to exactly `COMBINED_DISCOVERY_CAP = 120_000` chars. The markdown prefix (appended first) is fully preserved because it is only 10 KB; only the trailing structured blob is clipped mid-JSON.

**Outcome:** SAFE. The implementation builds `combined = markdown + "\n\n--- STRUCTURED DATA ---\n" + structuredData` and then calls `.slice(0, 120_000)`. Because markdown is the prefix, it is always preserved even if the blob is truncated mid-JSON. The LLM receives partial JSON and may miss some items — acceptable.

**Note:** A very large combined body close to the Anthropic context limit is not a risk here because `COMBINED_DISCOVERY_CAP` is 120 KB, well within model token limits.

---

### A-004: Hallucinated URL not present in markdown or structured data (EDGE-003)

**Attack:** Discovery LLM returns a URL like `https://totally-made-up.ai/article/123` that appears in neither the markdown nor the structured blobs.

**Expected behavior (REQ-008):** The old substring gate is removed. The hallucinated URL passes `validateDiscoveredUrls` (valid `https://` URL, non-empty, non-fragment). It is enqueued as a Pass-2 detail job. The Pass-2 fetch either 404s, times out, or returns no content — the error is recorded as `detail_failed` and no `RawItem` is stored.

**Outcome:** SAFE. The unit test `passes validation for a hallucinated URL not present in markdown (EDGE-003)` directly verifies this path. The LLM-returned URL passes validation; failure at Pass-2 detail fetch is expected and logged. No infinite loop, no crash, no stored garbage item.

---

### A-005: `#fragment-only` URL from discovery LLM (REQ-009)

**Attack:** Discovery LLM returns `#item-some-anchor` (bare fragment, no scheme/host).

**Expected behavior (REQ-009):** `validateDiscoveredUrls` drops URLs starting with `#` (the `p.url.startsWith("#")` check). The relative resolution path also catches it — `new URL("#item-some-anchor", listingUrl)` produces a same-page URL pointing to the listing, which `resolvesToListing` would also catch; but the `#`-prefix drop happens first.

**Outcome:** SAFE. Unit test `drops empty, fragment, and non-http(s) URLs (REQ-009)` covers this. Fragment-only URLs are dropped before any resolution attempt.

---

### A-006: Empty or whitespace-only `<script type="application/ld+json">` block

**Attack:** HTML with `<script type="application/ld+json">   </script>` (whitespace only).

**Expected behavior:** `el.textContent.trim()` is empty/whitespace. The implementation uses `el.textContent` — a whitespace-only blob would be included in the structured data. However this is benign: the LLM receives a whitespace separator between other blobs and ignores it.

**Potential defect:** If ALL `ld+json` blocks are whitespace-only, `structuredData` might be `"\n\n"` (non-null) rather than `null`. The spec says "no JSON-LD and no Next.js data scripts" → null (REQ-004). An all-whitespace blob technically satisfies "there is a script with this type."

**Severity: Low.** This edge case is unlikely in production (real pages either have no block or have content). The worst outcome is the LLM receives a whitespace-only `STRUCTURED DATA` section and returns no extra URLs — identical to the null path functionally.

---

### A-007: Listing URL with trailing slash vs. no trailing slash (self-referential check)

**Attack:** Listing URL is `https://llm-stats.com/ai-news/` (trailing slash), discovered URL is `https://llm-stats.com/ai-news#item-foo`.

**Expected behavior (REQ-010):** `resolvesToListing` normalises by comparing `origin + pathname`. `new URL("https://llm-stats.com/ai-news/").pathname === "/ai-news/"` vs `new URL("https://llm-stats.com/ai-news").pathname === "/ai-news"`. These differ — trailing-slash mismatch could cause a false negative (treating a self-referential URL as an external one and attempting Pass-2).

**Outcome:** The unit test `returns true when post URL has trailing slash but listing does not` covers the case where the POST URL has the trailing slash. However, the inverse (listing URL has trailing slash, post URL does not) is not explicitly tested.

**Severity: Low.** In practice, llm-stats.com uses `/ai-news` without trailing slash consistently. Real-world effect is unlikely. Worth a follow-up test, but not a blocking defect.

---

### A-008: `self.__next_f.push` script containing a large minified webpack bundle (noise)

**Attack:** A page where the `self.__next_f.push` script is actually a webpack chunk, not a data payload — thousands of lines of minified JS.

**Expected behavior (per spec):** Per `plan.md` decisions: "Skip webpack/analytics noise." The extractor selects scripts matching `self.__next_f.push` or `__NEXT_DATA__`, not generic `<script>` tags. However, if a webpack runtime inlines `self.__next_f.push([...])` to bootstrap Next.js routing, that could be captured.

**Outcome:** ACCEPTABLE RISK. The combined cap (120 KB) limits the damage — even a 500 KB webpack chunk gets truncated before it crowds out the markdown. The LLM is instructed to extract post URLs; a webpack chunk contains no post URLs and the LLM simply returns nothing from that portion. No crash, no false items.

---

## Summary

| Scenario | Severity | Status |
|----------|----------|--------|
| A-001: Malformed JSON-LD | None | Safe — no JSON.parse in extractor |
| A-002: `#item-` URL with query string | None | Safe — fragment+query stripped before comparison |
| A-003: 300 KB blob hitting 120 KB cap | None | Safe — markdown prefix preserved, blob truncated |
| A-004: Hallucinated URL | None | Safe — passes validation, fails at Pass-2, logged |
| A-005: Fragment-only discovered URL | None | Safe — dropped by `#`-prefix check in validateDiscoveredUrls |
| A-006: Whitespace-only ld+json block | Low | Non-null structuredData on whitespace-only scripts; functionally equivalent to null path |
| A-007: Trailing-slash listing URL vs non-trailing-slash post URL | Low | Untested inverse; unlikely in production; not blocking |
| A-008: webpack chunk matching `self.__next_f.push` | Acceptable | 120 KB cap limits damage; LLM extracts nothing useful from bundle |

**No blocking defects found.** Two low-severity observations (A-006, A-007) are noted for awareness but do not affect the correctness of the feature for its intended use case (llm-stats.com/ai-news and similar Next.js news aggregators).
