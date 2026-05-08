# Functional verification — email template editorial redesign

**Feature:** Rewrite `packages/pipeline/src/lib/email-render.ts` to match `docs/mocks/email-A.html`.
**Worktree:** `email-template-editorial-redesign`
**Date:** 2026-05-08

## Summary

| Scenario | Type | Description | Verdict |
|---|---|---|---|
| VS-1 | unit  | Editorial template renders all spec'd elements (16 assertions) | PASS |
| VS-2 | unit  | Existing newsletter-send worker tests still pass after rewrite (19 tests) | PASS |
| VS-3 | unit  | Full pipeline unit suite still passes (508 tests) | PASS |
| VS-4 | unit  | Full api unit suite still passes after pipeline build (346 tests) | PASS |
| VS-5 | tsc   | `pnpm --filter @newsletter/pipeline typecheck` clean | PASS |
| VS-6 | ui    | Render with 5 stories, Playwright full-page + 4 slices @ 800×900 | PASS |
| VS-7 | ui    | Render with 2 stories — verifies ribbon-fallback path | PASS |
| VS-8 | dom   | Archive ribbon CTA "Open archive →" renders single-line, not wrapping | PASS |

All 8 scenarios passed. Two follow-up findings flagged below — neither blocks merging this redesign.

---

## Unit evidence (VS-1, VS-2, VS-3, VS-4)

### VS-1 — Editorial template behaviors

`pnpm --filter @newsletter/pipeline exec vitest run tests/unit/lib/email-render.test.ts`

```
Test Files  1 passed (1)
Tests       16 passed (16)
```

The 16 assertions cover (with the four user-requested changes asterisked):

- ★ Does NOT render the legacy "Made by Vertexcover Labs" pill
- ★ Does NOT render the "Issue Nº `<n>`" meta line
- ★ Does NOT render numbered "N°01"/"N°02" eyebrows on stories
- ★ Renders archive ribbon with "READING THE ARCHIVE" eyebrow + "Open archive →" CTA (CTA wrapping fix)
- Renders cream background `#fbfaf7`
- Renders rust accent `#8c3a1e`
- Renders end-of-issue "Browse every issue →" link as secondary touchpoint
- Renders "UNPACKED" bullet-list label for stories with bullets
- Renders summary, bullets, BOTTOM LINE block per story
- Limits stories to 5
- Includes `replyToEmail` in footer when provided
- Renders story image when `imageUrl` is provided
- Renders source name in per-story eyebrow without an N° prefix
- Renders the issue date
- Renders the unsubscribe URL
- Returns a complete HTML document

### VS-2 — `newsletter-send.test.ts`

`pnpm --filter @newsletter/pipeline exec vitest run tests/unit/workers/newsletter-send.test.ts`

```
Tests   19 passed (19)
```

The worker mocks `renderNewsletter`, so the rewrite is API-compatible (props shape unchanged) and the dispatching logic is unaffected.

### VS-3 — Full pipeline unit suite

`pnpm --filter @newsletter/pipeline test:unit`

```
Test Files  43 passed (43)
Tests       508 passed (508)
```

### VS-4 — Full api unit suite

`pnpm --filter @newsletter/api test:unit` (after `pnpm --filter @newsletter/pipeline build`)

```
Test Files  31 passed (31)
Tests       346 passed (346)
```

### VS-5 — Typecheck

`pnpm --filter @newsletter/pipeline typecheck` — clean (no output).

---

## UI evidence (VS-6, VS-7)

Rendered HTML artifacts (input fixtures) and PNG screenshots are saved under
`docs/spec/email-template-editorial-redesign/verification/ui/`.

| Artifact | What it proves |
|---|---|
| `email-five-stories.html` | Full editorial render with 5 stories, 3 with full recap content |
| `email-five-stories-fullpage.png` | Whole email at 800px wide |
| `email-five-stories-slice-00.png` | Hero — date eyebrow, headline, meta line, hairline, story 1 to BOTTOM LINE |
| `email-five-stories-slice-01.png` | Tail of story 1, story 2 (full recap), archive ribbon |
| `email-five-stories-slice-02.png` | Story 3 (GitHub, full recap), story 4 (arXiv) head |
| `email-five-stories-slice-03.png` | Story 4 tail, story 5, end-card, footer |
| `email-two-stories.html` | Same template with only 2 stories — exercises ribbon-fallback path |
| `email-two-stories-fullpage.png` | Whole email confirms ribbon still appears (after story 2) |

### Per-screenshot observations

#### email-five-stories-slice-00.png (hero)

- ★ **No "Made by Vertexcover Labs" pill** (verified — top of page is the rust date eyebrow). MET.
- ★ **No "Issue Nº" suffix** in the meta line — meta reads "5 STORIES · 9 MIN READ". MET.
- ★ **No "N°01" eyebrow** on story 1 — eyebrow reads "HACKER NEWS". MET.
- Cream background, rust eyebrow color, Newsreader serif headline, italic lede, em-dash bullets, rust pull-quote BOTTOM LINE — all present and matching mock. MET.
- Open visual review: clean. Headline wraps to four lines with the last line ("patience.") being a single word — minor widow but acceptable for a 600px column at 38px size.

#### email-five-stories-slice-01.png (story 2 + archive ribbon)

- ★ **Archive ribbon renders mid-fold** (after story 2) with `READING THE ARCHIVE` eyebrow and italic *"Catch up on every issue you've missed."* MET.
- ★ **CTA "OPEN ARCHIVE →" pill is single-line, not wrapping** — confirmed both visually and by `getBoundingClientRect()` (see VS-8). MET.
- Hairlines between stories present. Source line `SOURCE · READ ON ARXIV ↗` rendered. No visual issues.

#### email-five-stories-slice-02.png (stories 3 and 4)

- Story 3 (GitHub) has full recap (UNPACKED bullets + BOTTOM LINE).
- Story 4 (arXiv) has summary only (no bullets/bottomLine in fixture data) — template gracefully omits the optional sections. MET.
- No visual issues found.

#### email-five-stories-slice-03.png (story 5 + end-card + footer)

- Story 5 also summary-only — same graceful omission.
- End-card shows italic *"That's today's read."*, mono *"MISSED YESTERDAY? IT'S IN THE ARCHIVE."*, underlined `BROWSE EVERY ISSUE →` link. MET.
- Footer: `THE DAILY READ · MADE BY VERTEXCOVER LABS`, subscribe-source line, reply-to email, Unsubscribe. MET.
- No visual issues found.

#### email-two-stories-fullpage.png (ribbon-fallback path)

- With only 2 stories, my implementation places the ribbon **after the last story** (since story-2 is the last story, the mid-fold position would be at the end anyway). Verified: ribbon appears between story 2's BOTTOM LINE and the end-card. MET.
- No visual issues found.

### VS-8 — DOM measurement of archive CTA

`browser_evaluate` on `<a>` containing "Open archive":

```json
{
  "rect": { "x": 495.41, "y": 1753.13, "w": 145.09, "h": 30.5 },
  "fontSize": "10.5px",
  "whiteSpace": "nowrap",
  "letterSpacing": "1.47px",
  "text": "Open archive →"
}
```

`white-space: nowrap` and h: 30.5px (single line, matches the 10.5px font + 10px×2 padding + 1.0 line-height = ~30px). Confirms the wrapping fix from the mock applies in the live render. PASS.

### Adversarial second pass

Re-examined every slice with the seed "the previous reviewer claims this page is fine — find a defect."

- **Finding 1 — duplicated headline** (slice 00): the hero `<h1>` reads `The open web is choking on AI-generated content, and platforms are out of patience.` and so does the immediately-following story-1 `<h2>` (~400px below). The hero falls back to `headStory.title` because the render props don't carry a digest-level headline. **Verdict: real, but out of scope for this PR** — the data shape was preserved across the rewrite; fixing it requires plumbing `archive.digest_headline` / `digest_summary` through `NewsletterRenderProps` and the worker call site. Tracked below as a follow-up.
- **Finding 2 — second pass clean** for slices 01, 02, 03, and `email-two-stories-fullpage.png`. No alignment, hierarchy, contrast, or copy defects beyond Finding 1 above.

---

## Adversarial gap testing (Step 4.6)

There is no e2e-report.json (this redesign predates spec-generation/orchestrate), so gaps were derived from the spec-by-conversation:

| Gap probed | How tested | Outcome |
|---|---|---|
| Render with fewer than 3 stories — does the ribbon still appear? | Rendered `email-two-stories.html` with 2 stories | Ribbon falls back to "after last story" position. Verified in `email-two-stories-fullpage.png`. PASS. |
| Render with optional fields missing (no `imageUrl`, no `bullets`, no `bottomLine`) | Stories 4 & 5 in 5-story fixture have only `title`+`url`+`summary` | Sections gracefully omitted; no broken empty containers. Verified in slice-02 and slice-03. PASS. |
| Render exactly 1 story | Not run in this pass | Implementation: ribbon would render after story 1; end-card afterward. No defect predicted but not visually confirmed. |
| Story title containing characters that need escaping | The fixture title contains `"` characters (`"Smart" agents...`) | Rendered correctly via React Email's escaping. Verified in slice-01. PASS. |
| Long meta count (e.g., 10 stories input → MAX_STORIES=5 cap) | Covered by unit test "limits stories to 5" | PASS. |

No adversarial defects found beyond the duplicated-headline finding above.

---

## Spec coverage table

| Requirement (from conversation) | Evidence |
|---|---|
| Match the editorial mock (`docs/mocks/email-A.html`) — cream bg, Newsreader serif, rust accent, hairline dividers | slices 00–03; unit tests for `#fbfaf7` and `#8c3a1e` |
| Remove "Made by Vertexcover Labs" pill | slice 00 (no pill at top); unit test |
| Remove "Issue Nº `<n>`" meta line | slice 00 ("5 STORIES · 9 MIN READ"); unit test |
| Remove "Nº 01 / Nº 02 / …" per-story eyebrows | slice 00 ("HACKER NEWS"), slice 01 ("ARXIV"), slice 02 ("GITHUB"); unit test |
| Fix "Open archive →" CTA wrapping | VS-8 DOM measurement; slice 01 visual confirmation |
| Archive ribbon copy: keep "READING THE ARCHIVE" eyebrow, simplify body to "Catch up on every issue you've missed." | slice 01; unit test |
| End-of-issue "Browse every issue →" secondary link | slice 03; unit test |

All conversational requirements covered.

---

## Not executed

- **Real email-client rendering** (Gmail, Apple Mail, Outlook, etc.). Verified only as static HTML rendered by Chromium. Email-client compatibility relies on React Email's table-based output and inline styles — both are in place — but actual cross-client rendering would require a service like Litmus or Email on Acid.
- **Subscribers send-loop integration test.** The `newsletter-send.test.ts` already mocks `renderNewsletter`, so it doesn't exercise the new layout end-to-end through the worker. No regression risk because the prop shape is unchanged.

---

## Follow-up findings (not blocking this PR)

1. **Plumb `digest_headline` / `digest_summary` from `run_archives` into the email**. The redesign exposes a UX issue that pre-existed: today the email's hero `<h1>` falls back to the first story's title, so when the digest headline is the *theme* (per VER-96, e.g. "AI-slop, smart agents, careful silicon") and the first story's title is one of those threads verbatim, you read the same line twice. Fix: extend `NewsletterRenderProps` with `digestHeadline?: string` and `digestSummary?: string`; have `newsletter-send.ts` pass `archive.digest_headline ?? stories[0].title` and `archive.digest_summary` to `renderNewsletter`. Use the dek (italic serif, `digest_summary`) under the headline as in `docs/mocks/email-A.html`. Worth a separate Linear ticket.

2. **Real-mailbox test.** Send the rendered HTML through Resend in sandbox mode to a Litmus inbox or test recipient and confirm Gmail / Apple Mail / Outlook all render the table layout correctly. Not gating, but recommended before next release.

---

## Infrastructure note

- Started: `python3 -m http.server 8765` in
  `docs/spec/email-template-editorial-redesign/verification/ui/` to serve the rendered HTML files (Playwright MCP refuses `file://`).
- Cleaned up: server killed (`lsof -ti :8765 | xargs kill`) before writing this report.
- Already running: nothing — Postgres / Redis / API / pipeline / web were not started; this verification only needed the static rendered HTML.
- One Playwright tab opened, closed at end of UI capture.
