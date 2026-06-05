# Phase 5: Frontend search bar + URL state

> **Status:** pending

## Overview

Add the search input to `/`. Wire URL ↔ query state via `useSearchParams`. Swap the data source from `listArchives` to `searchArchives` when any of `q`, `from`, `to` is set. Hide month headers when `q` is non-empty. Render the result-meta strip and empty state per mock Frame 2 / Frame 3. Highlight matched terms inline in digest fields.

## Implementation

**Files:**
- Create: `packages/web/src/components/archive-listing/SearchBar.tsx`
- Create: `packages/web/src/components/archive-listing/ResultMeta.tsx`
- Create: `packages/web/src/components/archive-listing/EmptyResults.tsx`
- Create: `packages/web/src/lib/highlightTerms.ts` — splits a string by query terms, returns React fragments with `<mark>` for matches
- Modify: `packages/web/src/pages/ArchiveListingPage.tsx` — read URL params, switch query, hide month headers, render meta + empty
- Modify: `packages/web/src/api/archives.ts` — `searchArchives({ q, from, to })` (already drafted in Phase 4 as part of the API client)
- Modify: `packages/web/src/components/archive-listing/ArchiveRow.tsx` — accept `highlightTerms?: string[]` prop and apply via `highlightTerms` util to digest headline + summary
- Test: `packages/web/tests/unit/components/archive-listing/SearchBar.test.tsx`
- Test: `packages/web/tests/unit/components/archive-listing/ResultMeta.test.tsx`
- Test: `packages/web/tests/unit/components/archive-listing/EmptyResults.test.tsx`
- Test: `packages/web/tests/unit/lib/highlightTerms.test.ts`
- Test: `packages/web/tests/unit/pages/ArchiveListingPage.test.tsx` — covers URL→data wiring, hides MonthHeader when q present, shows empty state

**Pattern to follow:** existing components in `archive-listing/`, `MemoryRouter`-based test wrapper in `tests/unit/ArchivePage.test.tsx`.

**What to test:**
- SearchBar:
  - Renders placeholder "Search the archive…" + ⌕ glyph.
  - Typing triggers a 250 ms-debounced URL update (vitest fake timers).
  - Clear button removes `q` from URL.
- ResultMeta: renders "<N> issues match 'q' · <range>" with React-escaped `q` (EDGE-019).
- EmptyResults: matches mock Frame 3 DOM.
- highlightTerms: case-insensitive, accent-insensitive (mirrors Postgres unaccent for client display) — for client-side a basic case-insensitive match is sufficient; we don't need full unicode normalization. Returns React fragment with `<mark>` for matches and plain text otherwise. Never uses `dangerouslySetInnerHTML`.
- ArchiveListingPage:
  - With `q="foo"` URL param, calls `searchArchives({ q: "foo" })` not `listArchives`.
  - Hides `<MonthHeader/>` when `q` non-empty.
  - Renders `<ResultMeta/>` when `q` non-empty.
  - Renders `<EmptyResults/>` when result is empty + `q` non-empty.
  - With no `q` and no range: behavior identical to today (regression).
- ArchiveRow: when `highlightTerms=['agentic']`, the dek "…teams plan agentic workloads…" wraps "agentic" in `<mark>`.

**Traces to:** REQ-013, 014, 015, 020, 021, 022, 023, EDGE-002, 017, 018, 019.

**Notable code:**

```ts
// highlightTerms.ts
export function highlightTerms(text: string, terms: string[]): ReactNode[] {
  if (!terms.length || !text) return [text];
  // Build a single case-insensitive regex; escape each term.
  const escaped = terms.filter(Boolean).map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (escaped.length === 0) return [text];
  const re = new RegExp(`(${escaped.join('|')})`, 'gi');
  const parts = text.split(re);
  return parts.map((p, i) =>
    i % 2 === 1 ? <mark key={i}>{p}</mark> : p
  );
}
```

```ts
// ArchiveListingPage (excerpt)
const [params, setParams] = useSearchParams();
const q = params.get('q') ?? '';
const from = params.get('from') ?? '';
const to = params.get('to') ?? '';
const isSearch = q.length > 0 || from.length > 0 || to.length > 0;

const { data, isLoading, isError } = useQuery({
  queryKey: isSearch ? ['archives', 'search', q, from, to] : ['archives', 'list'],
  queryFn: isSearch
    ? () => searchArchives({ q: q || undefined, from: from || undefined, to: to || undefined })
    : listArchives,
});

// SearchBar's onChange: 250ms debounced setParams that preserves from/to and only mutates q
```

**Min-char rule (EDGE-002):** SearchBar fires URL update with `q` only when length is 0 OR ≥ 2. A 1-char string keeps the previous URL value (no API hit).

**Done when:**
- [ ] All listed unit tests green
- [ ] Manual sanity: open `/`, type a known term, see filtered results; clear and the full list returns
- [ ] No new console errors
- [ ] `pnpm test:unit` green; baseline test counts ≥ baseline

**Commit:** `feat(VER-XX): wire frontend search bar with URL state on archive listing`
