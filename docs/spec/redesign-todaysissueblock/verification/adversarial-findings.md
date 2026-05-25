# Adversarial Findings — TodaysIssueBlock
## Date: 2026-05-25

---

## Scenarios Attempted

### 1. Very long title (55 characters in a single story)
**Input:** `topItems[0].title = "OpenAI ships a brand new reasoning model that crushes every benchmark in sight"` (80 chars)
**Fixture:** FULL
**Observed:** Title wraps naturally across multiple lines. The number rail (`01`) stays aligned to the top. The source label stacks below (mobile) or stays in the right column (desktop). No overflow, no clipping.
**Verdict:** PASS — no defect.

---

### 2. Missing digestSummary (null dek)
**Input:** `digestSummary: null`
**Fixture:** NO-DEK
**Observed:** The dek paragraph is completely absent. Layout tightens — the running order follows the headline directly with correct spacing (`mb-[22px]` on the heading). No empty `<p>` tag is rendered.
**Verdict:** PASS — no defect.

---

### 3. Empty topItems array (storyCount=0)
**Input:** `topItems: [], storyCount: 0`
**Fixture:** EMPTY-ITEMS
**Observed:** No `<ol>` is rendered. The read line shows "Read today's issue" (moreCount = 0 - 0 = 0 ≤ 0). Layout transitions directly from headline to read affordance.
**Verdict:** PASS — no defect.

---

### 4. Equal count (storyCount === topItems.length)
**Input:** `storyCount: 3, topItems.length: 3`
**Fixture:** EQUAL-COUNT
**Observed:** Read affordance shows "Read today's issue" — correct, since `moreCount = 3 - 3 = 0`.
**Verdict:** PASS — no defect.

---

### 5. Narrow mobile viewport (390px)
**Input:** All four fixtures at 390px viewport width
**Observed:**
- Source tags stack under titles (grid `col-start-2` pushes to row 2 on mobile)
- Long titles wrap normally — no single-word-per-line layout
- Headline does not overflow the viewport
- Eyebrow "Today's Issue · Monday, May 25" wraps without collapsing
**Verdict:** PASS — mobile layout works correctly.

---

### 6. Unknown sourceType fallback
**Observed in code:** `sourceLabel()` returns `sourceType.toUpperCase()` for unmapped sourceTypes (via `?? sourceType.toUpperCase()`). For example, a `sourceType: "newsletter"` would render as "Newsletter" (mapped) and an unknown `sourceType: "custom_source"` would render as "CUSTOM_SOURCE".
**Verdict:** PASS — the fallback is safe (no crash, no empty label).

---

### 7. digestHeadline null — fallback to topItems[0].title
**Input:** `digestHeadline: null, topItems[0].title: "Some article title"`
**Observed in code:** `const headline = issue.digestHeadline ?? (issue.topItems[0]?.title ?? "Today's issue")`
**Verdict:** Fallback chain is correct. Not tested in a dedicated fixture, but verified in the component source.

---

### 8. digestHeadline null AND topItems empty — final fallback
**Input:** `digestHeadline: null, topItems: []`
**Observed in code:** `issue.topItems[0]?.title` is `undefined`, so the fallback returns "Today's issue" (literal string).
**Verdict:** PASS — no crash, graceful fallback to literal.

---

## Defects Found

**None.** All adversarial scenarios passed without error.

---

## Notes

- The component correctly handles all boundary conditions documented in the spec.
- The mobile layout uses CSS grid with responsive column tracks — no JavaScript-based reflow, which is robust and SSR-safe.
- The single-link wrapper means the entire card is keyboard-navigable as one focusable unit, which is correct for a block-level navigation element.
- There is no `§` glyph anywhere in the rendered output (confirmed by DOM snapshot).
- There are no nested `<a>` tags (the only link is the outer `<Link>` wrapper).
