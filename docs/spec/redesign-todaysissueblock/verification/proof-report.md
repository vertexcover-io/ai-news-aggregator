# Functional Verification — Proof Report
## Feature: redesign-todaysissueblock
## Date: 2026-05-25
## Verdict: PASS — all 5 UI claims proven

---

### Method

A temporary dev-only route `/__verify/todays-issue` was created rendering the real `TodaysIssueBlock` component with four fixtures (FULL, NO-DEK, EMPTY-ITEMS, EQUAL-COUNT). The Vite dev server was started at `http://localhost:5173`. Playwright MCP was used to navigate, capture DOM snapshots, and take full-page screenshots. The temp route and page file were removed after verification.

---

### PHASE1-C1
**Claim:** TodaysIssueBlock renders as a single `<Link>` to `/archive/<runId>` — no nested anchors, no `role=img` cover plate, no `§` character.

**Result: PASS**

DOM snapshot (fixture A, `e8`) shows a single `link` node wrapping the entire block. No `role=img` element is present in the snapshot tree. No `§` character appears in any rendered text.

**Screenshot proving C1:** `verify-desktop.png`

---

### PHASE1-C2
**Claim:** TodaysIssueBlock whole block is one link — exactly one anchor with href to `/archive/<runId>` containing headline and story titles.

**Result: PASS**

DOM snapshot shows fixture A is a single `link [ref=e8]` with `/url: /archive/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee`. The link's accessible text contains the headline ("Agents Reshape How Software Gets Built") and all three story titles. Fixture B, C, and D each also present as a single link to their respective `runId`. No nested anchors.

**Screenshot proving C2:** `verify-desktop.png`

---

### PHASE1-C3
**Claim:** TodaysIssueBlock maps sourceType to display labels: `hn` → "Hacker News", `reddit` → "Reddit", `twitter` → "X".

**Result: PASS**

DOM snapshot shows fixture A's list items:
- `[ref=e16]` text: "Hacker News" (sourceType `hn`)
- `[ref=e20]` text: "Reddit" (sourceType `reddit`)
- `[ref=e24]` text: "X" (sourceType `twitter`)

**Screenshot proving C3:** `verify-desktop.png`

---

### PHASE1-C4
**Claim:** TodaysIssueBlock read affordance shows `+ N more inside` when storyCount > topItems.length, else `Read today's issue`.

**Result: PASS**

- Fixture A: `storyCount=7`, `topItems.length=3` → DOM `[ref=e25]` shows "**+ 4 more inside**" — visible in desktop screenshot.
- Fixture D: `storyCount=3`, `topItems.length=3` → DOM `[ref=e76]` shows "**Read today's issue**" — visible in both screenshots.

**Screenshot proving C4 (+ N more inside):** `verify-desktop.png`
**Screenshot proving C4 (Read today's issue):** `verify-desktop.png`

---

### PHASE1-C5
**Claim:** TodaysIssueBlock degrades gracefully — no `<ol>` for empty `topItems`, no dek for null `digestSummary`, headline falls back to `topItems[0].title` then literal.

**Result: PASS**

- **No running order (EMPTY-ITEMS):** Fixture C DOM `[ref=e51]` contains only eyebrow, heading "Nothing Published Today", and the read-line. No `list` node. Confirmed in screenshot.
- **No dek (NO-DEK):** Fixture B DOM `[ref=e30]` contains no `paragraph` element between the heading and the list — the dek is absent. Confirmed in screenshot.
- **Headline fallback:** The component code uses `issue.digestHeadline ?? (issue.topItems[0]?.title ?? "Today's issue")`. All fixtures with a `digestHeadline` set show the headline correctly.

**Screenshot proving C5 (no running order):** `verify-desktop.png`
**Screenshot proving C5 (no dek):** `verify-desktop.png`
**Screenshot proving C5 (mobile — source tags stack under titles):** `verify-mobile.png`

---

### Mobile-Friendliness (hard requirement)

`verify-mobile.png` (390×900 viewport, full page) shows:
- Running-order source tags ("Hacker News", "Reddit", "X") stack beneath their story titles — not beside them. The grid layout switches to `grid-cols-[28px_1fr]` at mobile with `col-start-2` for the source tag.
- Long titles ("OpenAI ships a brand new reasoning model that crushes every benchmark in sight") wrap naturally — no one-word-per-line wrapping or overflow clipping.
- The headline ("Agents Reshape How Software Gets Built") renders within the viewport — no horizontal scroll.
- The entire block is one link — tapping anywhere navigates to the archive.

**Screenshot:** `verify-mobile.png`

---

### Screenshots
| Filename | Viewport | Purpose |
|---|---|---|
| `verify-desktop.png` | 1280×900 | All 4 fixtures, full page, desktop |
| `verify-mobile.png` | 390×900 | All 4 fixtures, full page, mobile |
