# Adversarial Findings — Web Collector Date Fix

**Date:** 2026-05-26
**Result: No defects found**

## Scenarios Attempted

### AS-1: Malformed JSON-LD block (EDGE-001)

**Scenario:** A page has `<script type="application/ld+json">{ invalid json !!!` followed by a valid
`<meta property="article:published_time">` tag.

**Expected:** No throw. Processing continues to the meta tier and returns the meta date.

**Test coverage:** `published-date.test.ts::EDGE-001: malformed JSON-LD > skips malformed JSON-LD block and continues to next tier`

**Result:** PASS — `extractPublishedAt` wraps each JSON.parse call in try/catch and `continue`s on
failure; the meta tier returns February 14. A second test confirms that when the *only* signal is
a malformed JSON-LD block, the function returns `null` rather than throwing.

---

### AS-2: Conflicting JSON-LD vs `<time>` element (EDGE-006)

**Scenario:** Page has both a JSON-LD `datePublished` (March 5) and a `<time datetime>` element
(March 1). JSON-LD should win.

**Expected:** Returns the JSON-LD date (March 5).

**Test coverage:** `published-date.test.ts::REQ-002: precedence tiers > prefers JSON-LD over <time> when both present`
(via the llm-stats.com fixture — JSON-LD `2026-05-19T10:00:00.000Z` wins over `<time datetime="2026-05-19">`)
and an inline test with explicit conflicting values.

**Result:** PASS — `extractPublishedAt` uses `??` chaining: `extractFromJsonLd ?? extractFromMeta ?? extractFromTimeElement`.
Once JSON-LD returns a non-null date, later tiers are never evaluated.

---

### AS-3: No structured signal — publishedAt must be null, no fabrication (EDGE-004)

**Scenario:** Page has no JSON-LD, no meta date tags, no `<time datetime>` elements, and the LLM
returns an empty string for `published_at`.

**Expected:** `publishedAt = null`. The system must not fabricate a date from body text.

**Test coverage:**
- `published-date.test.ts::dated-none.html > returns null when no structured date signals present`
- `web-date.test.ts::returns null for empty string`
- `web-date.test.ts::returns null for null input`
- `web-date.test.ts::returns null for garbage string`

**Result:** PASS — `extractPublishedAt` on `dated-none.html` returns `null`. `resolvePublishedDate`
with empty/null/garbage also returns `null`. The combination (`structured ?? resolvePublishedDate(llmString)`)
produces `null` when neither signal is available.

---

### AS-4: Future-dated relative string (out-of-scope per spec)

**Scenario:** A page reports a date in the future (e.g., a pre-scheduled post with `datePublished`
set to a future ISO timestamp).

**Expected per spec (out-of-scope note):** Future dates are accepted as-is — no clamping.

**Test coverage:** Not explicitly tested (spec states out-of-scope). The `parseDate` helper in
`published-date.ts` uses `new Date(s)` which accepts future ISO strings without modification.
`resolvePublishedDate` uses `chrono.parseDate(raw, ref)` which also does not clamp.

**Result:** No defect — consistent with spec out-of-scope decision.

---

### AS-5: JSON-LD `@graph` where only the second node has `datePublished` (EDGE-007)

**Scenario:** `@graph` array where the first node is a `WebSite` with no date, and the second is
a `BlogPosting` with `datePublished`.

**Expected:** Returns the `BlogPosting` date.

**Test coverage:** `published-date.test.ts::REQ-003: JSON-LD shapes > handles @graph where first node lacks datePublished — EDGE-007`

**Result:** PASS — `extractFromJsonLd` flattens the `@graph` into `nodes` and iterates, skipping
nodes without `datePublished`. The first *with* a valid date wins.

---

### AS-6: Non-ISO `datePublished` string that is unparseable (EDGE-002)

**Scenario:** JSON-LD has `"datePublished": "not-a-date-at-all-xyz"`. Should fall through to the
next tier rather than returning a garbage date.

**Expected:** Falls through to meta/time tier. If meta is present, meta date is returned.

**Test coverage:** `published-date.test.ts::EDGE-002: non-ISO datePublished > falls through to next tier when datePublished is unparseable garbage`

**Result:** PASS — `parseDate` returns `null` for `NaN` dates; the `for` loop `continue`s and the
node is skipped. Meta tier (January 20) is returned correctly.

---

## Summary

| Scenario | Expected | Actual | Status |
|----------|----------|--------|--------|
| AS-1: Malformed JSON-LD | No throw, fallthrough | No throw, meta date returned | PASS |
| AS-2: JSON-LD vs `<time>` conflict | JSON-LD wins | JSON-LD wins | PASS |
| AS-3: No structured signal | `publishedAt = null` | `null` returned | PASS |
| AS-4: Future-dated signal | Accepted as-is (out-of-scope) | `parseDate` / chrono accept without clamping | PASS (N/A) |
| AS-5: `@graph` second node has date | Second node date returned | Second node date returned | PASS |
| AS-6: Unparseable `datePublished` | Fall through to next tier | Meta tier date returned | PASS |

**No defects found. All adversarial scenarios behave as specified.**
