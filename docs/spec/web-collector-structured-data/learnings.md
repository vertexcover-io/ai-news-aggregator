# Learnings — web-collector-structured-data

## Readability/Turndown discards embedded JSON, so the discovery LLM never sees structured listing data

**Root cause that bit us:** The web collector's listing markdown is produced by JSDOM →
(strip `script`/`style`/`nav`/`footer`/`aside`) → Turndown. On modern aggregator/SPA
pages (Next.js, link aggregators like llm-stats.com), the *actual* list of items lives in
embedded JSON — JSON-LD `<script type="application/ld+json">` (standard `NewsArticle` /
`ItemList` schema) and Next.js flight payloads (`self.__next_f.push(...)`,
`<script id="__NEXT_DATA__">`) — NOT as static `<a href>` anchors. Stripping `<script>`
before building the markdown threw all of it away, so the discovery LLM only ever saw the
handful of outbound research anchors and silently dropped the entire "Today" news section.
Browser rendering did **not** help — even the hydrated DOM had zero news anchors; the data
only ever exists in the JSON payloads.

**The fix that generalised:** Extract the raw JSON blob text *before* the strip step and
hand it to the discovery LLM verbatim alongside the markdown (single combined 120 KB cap,
markdown first). Do **not** hand-parse the JSON per-site — the LLM extracts URLs/titles/dates
from the raw blobs. This is the only approach that fixes *every* such site rather than
just llm-stats; a typed JSON-LD parser would have fixed llm-stats but not the
`__next_f`-only sites.

**Two follow-on consequences worth remembering:**
1. The "URL must be a substring of the listing markdown" anti-hallucination gate had to be
   dropped (JSON-only URLs aren't in the markdown). Safe because Pass-2 detail fetch already
   drops dead/hallucinated URLs without storing a bad item.
2. Aggregators wrap the real source URL in a fragment (`…/ai-news#item-https://techmeme.com/…`).
   HTTP ignores the fragment, so fetching it just re-fetches the listing page. The fix detects
   "URL minus fragment resolves to the listing URL" and skips Pass-2, building the item from the
   discovery LLM's title+date with the full fragment URL kept as a distinct `externalId`.

**Heuristic for the next collector bug:** If a listing "renders fine in a browser" but the
collector misses most items, check whether the items are `<a href>` anchors or
JS-hydrated/`<button>`/JSON-only. Probe the raw HTML for `application/ld+json` and
`self.__next_f` before assuming a render-mode problem.

Relates to [[web-collector-date-extraction]] (PR #208) — both are "the signal is in the
original DOM, not the Readability output" lessons.
