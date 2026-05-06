# Share Archive on Social — Design

**Linear:** VER-68 / share-newsletter-on-social-easily
**Scope:** `/archive/:runId` only (public archive detail page)
**Date:** 2026-05-06
**Branch:** `feat/VER-68-share-archive-on-social`

---

## Phase 1 — Grounding the idea

### Problem

Today there is no way to share an issue of the AI newsletter to LinkedIn or X
from inside the product. A reader who wants to post about an issue has to copy
the URL by hand, switch tabs, paste it, then write a description from scratch.
That friction is the difference between "I'll share this" and "I'll share this
later" — i.e., never.

Linear ticket VER-68: *"share newsletter on social easily."*

### What "good" looks like

- A reader on `/archive/:runId` can post the issue to LinkedIn or X in **one
  click**. The composer opens with the issue title and URL already filled in.
- A reader can also copy the issue URL to clipboard in one click for
  channels we don't deep-link to (Slack, email, DMs).
- The buttons fit the Ledger aesthetic of the page (serif/mono, rust accent
  `#8C3A1E`, hairline dividers, no shadow). They don't look like a generic
  "Sharetastic" widget bolted on.
- The share preview that LinkedIn/X scrape from the URL renders with a
  predictable headline: **"AI news - \<Date\>"**.

### What we are NOT building

- ❌ Per-story share buttons. Whole-archive only. (Confirmed with user.)
- ❌ Server-side OAuth posting. We use plain intent URLs only — no tokens,
  no API calls.
- ❌ A reusable cross-page share component. Only `/archive/:runId` gets
  share buttons in this PR. Listing page (`/`) and admin pages do not.
- ❌ Analytics / share-event tracking. The component will expose stable
  `data-share-target="linkedin|x|copy"` attributes for *future* analytics
  but no tracking is wired in this PR.
- ❌ Facebook, Reddit, WhatsApp, etc. Two channels (LinkedIn, X) plus copy
  link. Adding more is a YAGNI trap and clutters the header.
- ❌ Email share (`mailto:`). If the user wants email, copy-link is the
  answer — paste into their email client of choice.
- ❌ Image / OG image generation. Existing `og:image` (if any) is reused
  as-is. We change `og:title` only.

---

## Phase 2 — Approaches explored

### 2A — Mechanism: native intent URLs vs Web Share API

| Approach | Pros | Cons |
|---|---|---|
| **Plain intent URLs** (LinkedIn `share-offsite`, X `intent/tweet`) opened via `window.open()` or `<a target="_blank">` | Works in every browser. No permissions. No mobile-vs-desktop branching. Predictable composer with our prefilled text. Zero deps. | Two clicks on mobile (button → composer). UI is whatever LinkedIn/X give us. |
| **Web Share API** (`navigator.share({ title, text, url })`) on supported devices, fallback to intent URLs | Native OS share sheet on iOS/Android — best mobile UX. Lets users share to apps we don't deep-link (Messages, Slack, Notes). | iOS Safari restricts it to user-gesture handlers (we already have that). Desktop Chrome/Edge: no native share sheet — falls back anyway. **Behavior is unpredictable across platforms.** Adds branching logic and three test paths instead of one. The user explicitly asked for LinkedIn/X buttons, not "a share menu." |

**Recommendation: plain intent URLs only.** The user-confirmed UX is "click LinkedIn → land on LinkedIn with prefilled text." Adding `navigator.share` on mobile Safari/Chrome would *replace* that with the OS share sheet — a different UX that the user did not ask for. YAGNI. We can add Web Share later as a "Share…" button without redesign if we choose.

### 2B — Placement on the page

I looked at how serif-leaning, long-form newsletter sites handle this:

- **Stratechery** (and the new Passport platform): share controls live in a thin top utility row above the article, plus a "Discussion" anchor below. Restrained, monochrome, no brand color fills.
- **Substack** posts: a share toolbar appears **between the headline and the article body** (Like / Comment / Restack / Share), and a second copy floats at the bottom or in a sidebar on desktop.
- **Axios / Smart Brevity layout:** share buttons are in the top-right corner of the article, near the byline.
- **Lenny's Newsletter / Platformer** (both on Substack): use the Substack default — share row directly under the headline / above the body.

The convergent pattern is: **share controls sit immediately under (or beside) the issue's headline metadata, not floating, not in the page's global nav**. They don't dominate, but they're on the first scroll.

**Three options considered for `/archive/:runId`:**

1. **Bottom only** — share row in the footer, just above `SubscribeWidget`. *Pro:* matches "end-of-article share" reflex; high-intent readers who finished see it. *Con:* invisible until scroll; on a long issue with 8 stories that's significant. Misses the "skim the headline and share" reflex.
2. **Header only** — share row tucked under the "← All issues" link, before the first story. *Pro:* one stable, scannable spot; first-screen visibility; matches Substack/Axios convention. *Con:* readers who finish the issue have already scrolled past it.
3. **Both header and footer** — same component rendered twice. *Pro:* catches both reflexes. *Con:* visual noise; two sources of truth for share UX; doubles the DOM.

**Recommendation: option 2 (header only), placed inside `ArchivePageHeader`,
on a single row beneath the existing "← All issues" back-link and above the
first story divider.** This matches the dominant convention, gives the buttons
first-screen visibility, and keeps the bottom of the page focused on the
SubscribeWidget which is our actual conversion goal there. If we later see
data suggesting end-of-article shares matter, adding a second instance is a
trivial follow-up.

### 2C — Visual design within the Ledger aesthetic

The page's typographic system is: serif headlines (Newsreader), mono eyebrows
(Geist Mono), `#FAFAF7` ground, `#8C3A1E` rust as the *only* color accent,
hairline dividers, no shadows, square corners.

Three visual treatments considered:

1. **Icon-only round buttons, filled rust** — most "social-share-y," but
   rust-filled circles fight the Ledger restraint and turn the header into
   a Web 2.0 widget zone. Rejected.
2. **Icon + uppercase mono label, ghost (text-only) buttons in a row,
   separated by a "·" mono dot** — reads like the eyebrow row already on
   the page (`MONDAY · MAY 6, 2026`). Pure typography, zero brand color
   collision, fits the aesthetic. **Recommended.**
3. **Icon + label inside a hairline-bordered pill** — very close to (2)
   but adds visible borders. Slightly heavier; OK fallback if (2) reads
   too quiet on mobile.

**Recommended visual:** option 2. A small mono row reading e.g.
`SHARE → LINKEDIN · X · COPY LINK` with a hover state that switches the
target word to the rust accent. Each item is a 44×44 px touch target
(per the existing mobile-layout convention). Icons live to the left of the
mono label, sized 14 px to match the eyebrow.

**Copy-link feedback:** when clicked, the `COPY LINK` label swaps in place to
`COPIED ✓` for 1.5 s, then reverts. No toast, no portal, no library.

### 2D — Where the share-URL builders live

Two places to put the URL-building logic:

- **A) Inline in the component.** Three template literals, four lines each.
  Easy to read, no indirection. No tests required (the strings are static).
- **B) Pure functions in `packages/web/src/lib/shareLinks.ts`.** One function
  per platform, plus the X-truncation helper. Tested in isolation.

**Recommendation: B.** The X truncation is non-trivial (must reserve 24 chars
for the t.co-shortened URL + the leading space, and must not split a Unicode
character mid-grapheme). That deserves a unit test. LinkedIn / copy are
simpler but live next door for cohesion. Total: ~40 lines + ~80 lines of
tests.

---

## Phase 2.5 — External Dependencies & Fallback Chain

Every external surface this feature depends on is listed below with a
declared fallback. This is the contract for the library-probe stage.

### D1 — LinkedIn share-offsite intent URL

- **What it is:** `https://www.linkedin.com/sharing/share-offsite/?url=<encoded-url>`
- **What we depend on it for:** Opening LinkedIn's composer prefilled with our
  archive URL, after which LinkedIn server-side fetches the URL and reads
  `og:title` / `og:description` / `og:image` from our HTML to render the
  card preview.
- **How it can fail:**
  - LinkedIn changes the endpoint or query-param contract (historically rare
    but has happened: `shareArticle?mini=true` → `sharing/share-offsite`).
  - LinkedIn's scraper can't reach the deployed origin (private network,
    rate-limited, missing OG tags) — composer opens but preview is blank.
  - User isn't logged in to LinkedIn — composer redirects to login first,
    *then* lands on the share form. Acceptable.
- **Fallback chain:**
  1. Primary: `share-offsite` endpoint (current docs as of 2026).
  2. If users report blank previews → verify `og:title` / `og:description` are
     emitted by the archive page (this PR sets `og:title`; description is set
     elsewhere). Use LinkedIn's
     [Post Inspector](https://www.linkedin.com/post-inspector/) to debug.
  3. If LinkedIn deprecates the endpoint → fall back to copy-link
     (always works, requires user to paste manually). The Copy Link button
     in this design *is* that fallback — it's not just an extra feature.

### D2 — X (Twitter) intent URL

- **What it is:** `https://twitter.com/intent/tweet?text=<encoded>&url=<encoded>`
- **What we depend on it for:** Opening X's composer prefilled with our text +
  URL. X auto-shortens the URL to a `t.co` link (≈23 chars) at post time.
- **How it can fail:**
  - X changes the host or path (`twitter.com` vs `x.com/intent/post`). Per
    current X docs (2026), `twitter.com/intent/tweet` continues to work and
    the team explicitly maintains backward compat.
  - User exceeds 280 chars after X concatenates `text + " " + t.co/url`.
    Composer either truncates client-side or shows an error. Our truncation
    helper prevents this.
  - User isn't logged in — composer redirects to login first. Acceptable.
- **Fallback chain:**
  1. Primary: `twitter.com/intent/tweet`.
  2. If `twitter.com` is deprecated → switch the constant to
     `https://x.com/intent/post`. One-line change, no other contract drift.
  3. Worst case → copy-link.

### D3 — Clipboard API (`navigator.clipboard.writeText`)

- **What it is:** Browser-native API for writing text to the clipboard.
- **What we depend on it for:** The Copy Link button.
- **How it can fail:**
  - Insecure origin (HTTP, not localhost) → `clipboard` is `undefined`.
    Production is HTTPS, so this only bites local non-localhost dev.
  - User has not granted clipboard permission (prompts on some browsers).
    Our call is in a click handler so prompt is automatic.
  - Old browsers (IE, very old Safari) — out of support.
- **Fallback chain:**
  1. Primary: `navigator.clipboard.writeText(url)`.
  2. If `navigator.clipboard` is `undefined` (insecure context) →
     `document.execCommand("copy")` against a temporary hidden `<textarea>`.
     Deprecated but universally supported.
  3. If both fail → show the URL in a `prompt()` dialog so the user can
     copy manually. Ugly but always works.

### D4 — Open Graph `og:title` meta tag

- **What it is:** `<meta property="og:title" content="AI news - <Date>" />`
  injected at runtime via the existing `setMeta` helper in
  `packages/web/src/lib/meta.ts`.
- **What we depend on it for:** LinkedIn's share preview headline. (X uses
  Twitter Cards; if absent, X falls back to og: tags too.)
- **How it can fail:**
  - SPA scrapers: LinkedIn / X scrapers may not execute JS. Setting
    `og:title` only on `useEffect` after hydration means a scraper that
    doesn't run JS sees the static `index.html` `<title>` (which is just
    `Newsletter`).
  - Existing project state: `setMeta` already runs in `ArchivePage` to set
    `description` after data loads — same SPA-hydration limitation already
    applies. So the bar for this PR is **don't make it worse**, not "make
    LinkedIn previews server-rendered." That's a separate, larger effort
    (would need SSR or per-route HTML pre-rendering).
- **Fallback chain:**
  1. Primary: `setMeta("og:title", "AI news - <Date>")` in `ArchivePage`.
  2. Acceptable degraded behavior: scrapers without JS see the default
     `<title>` from `index.html`. Document this in the design as a known
     limitation, recommend SSR/pre-render as future work in the spec's
     follow-up section.
  3. If we want better previews before SSR ships → emit a Cloudflare /
     edge worker that detects bot user-agents and returns a hand-built HTML
     stub with og: tags. **Not in scope for this PR.**

### D5 — `window.open` and popup blockers

- **What it is:** `window.open(url, "_blank", "noopener,noreferrer")` to
  launch the LinkedIn / X composer.
- **What we depend on it for:** Opening the composer in a new tab without
  navigating away from the archive.
- **How it can fail:** Pop-up blockers. Modern browsers allow pop-ups when
  the call is synchronous within a user click handler — our case.
- **Fallback chain:**
  1. Primary: `window.open(...)`.
  2. If `window.open` returns `null` (blocked) → fall back to navigating
     the current tab (`location.href = url`). Not ideal — user loses the
     archive — but recoverable via back button.
  3. Best practice: render the LinkedIn / X buttons as actual `<a href>`
     anchors with `target="_blank"`. Browsers handle anchor target reliably
     even when scripted `window.open` is blocked. **This is the chosen
     approach** — no `window.open` call at all for LinkedIn / X. Copy is a
     button (no nav).

---

## Phase 3 — The design

### 3.1 Component architecture

```
packages/web/src/
  lib/
    shareLinks.ts            ← NEW (pure functions, unit-tested)
      buildLinkedInShareUrl(archiveUrl: string): string
      buildXShareUrl(archiveUrl: string, text: string): string
      truncateForX(text: string, urlLength: number): string
  components/
    ArchiveShareRow.tsx      ← NEW (presentational)
    ArchivePageHeader.tsx    ← UNCHANGED in API; the share row is rendered
                               as a sibling immediately AFTER the header in
                               ArchivePage.tsx, not inside the header,
                               to keep the header component pure.
  pages/
    ArchivePage.tsx          ← MODIFIED:
                               • render <ArchiveShareRow /> after <ArchivePageHeader />
                               • set og:title to "AI news - <Date>" via setMeta
  lib/
    meta.ts                  ← already exposes setMeta(name, content);
                               extend if it doesn't support property="og:title"
                               (it likely does — verify in coder stage)
```

### 3.2 Data flow

```
ArchivePage (data loaded, status=completed)
  │
  ├─ useEffect: setMeta("og:title", "AI news - " + formatIssueDate(startedAt))
  │             setMeta("description", pickHeadline(...))    [already present]
  │             document.title = "AI news - <Date>"          [tweak existing]
  │
  ├─ <ArchivePageHeader … />              (unchanged)
  │
  ├─ <ArchiveShareRow                     (NEW)
  │      archiveUrl={window.location.href}
  │      shareText={`AI news - ${formatIssueDate(startedAt)}`}
  │  />
  │     │
  │     ├─ <a href={buildLinkedInShareUrl(url)} target="_blank" rel="noopener noreferrer">
  │     │    [LinkedIn icon] LINKEDIN
  │     ├─ <a href={buildXShareUrl(url, text)} target="_blank" rel="noopener noreferrer">
  │     │    [X icon] X
  │     └─ <button onClick={copyToClipboard}>
  │          [link icon] COPY LINK     (swaps to "COPIED ✓" for 1500ms)
  │
  └─ <ArchiveStoryCard /> ⋯
```

### 3.3 URL constructions (canonical)

**LinkedIn:**
```
https://www.linkedin.com/sharing/share-offsite/?url={encodeURIComponent(archiveUrl)}
```
LinkedIn ignores any `text`/`title`/`summary` params reliably; the preview comes
from `og:title` + `og:description` + `og:image` of the URL it scrapes. So we
pass `url` only. The `og:title` we set takes care of the headline.

**X:**
```
https://twitter.com/intent/tweet?text={encodeURIComponent(truncated)}&url={encodeURIComponent(archiveUrl)}
```
where `truncated` is the result of `truncateForX(`AI news - <Date>`, 24)`.

**Truncation rules for X (`truncateForX`):**
- X reserves 23 chars for the `t.co` shortened URL plus 1 char for the
  separator space. Reserve **24 chars** total.
- Treat input as **graphemes** (`Array.from(str)` — splits surrogate pairs
  but not full emoji sequences; acceptable for our title strings which are
  ASCII-only). Don't do raw `.slice()` on a string with multi-byte chars.
- Budget: `280 - 24 = 256` chars for `text`.
- If `text.length <= 256` → return text as-is.
- Else return `text.slice(0, 255) + "…"` (single-char ellipsis, total 256).
- The shareText we generate (`"AI news - May 6, 2026"`) is well under 256
  chars in practice — truncation is a safety net for future title formats,
  not a primary path. Worth the test, not worth contortions.

### 3.4 Visual design (concrete)

**Layout (inside ArchiveShareRow, rendered between the header and the first story divider):**
```
┌──────────────────────────────────────────────────────────────────────────┐
│  SHARE →   in LINKEDIN   ·   ✕ X   ·   🔗 COPY LINK                       │
└──────────────────────────────────────────────────────────────────────────┘
   (mono, 11px, neutral-500; · separators are mono mid-dots in neutral-300)
   (each item is a 44×44 minimum touch target on mobile via padding)
```

**Tailwind classes (proposal):**
- Wrapper: `mt-2 mb-8 flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.18em] text-neutral-500`
- Each link/button: `inline-flex items-center gap-2 min-h-[44px] px-2 hover:text-[#8C3A1E] transition-colors`
- Separator span: `text-neutral-300 select-none` containing `·`
- Icon: 14×14 inline SVG, `currentColor` so it picks up the rust on hover.
- Copy success state: same element, label swapped to `COPIED ✓` for 1500 ms.
  Use a `useState<boolean>` + `setTimeout` (clear in cleanup).

**Mobile behavior (< 640 px):** the row stays one line and may wrap to two
rows naturally via `flex-wrap`. Each item retains `min-h-[44px]`. We do not
collapse into a single "Share…" button — there are only three targets and
they fit.

**Accessibility:**
- Icons have `aria-hidden="true"` (label carries the meaning).
- LinkedIn link: `aria-label="Share this issue on LinkedIn"`.
- X link: `aria-label="Share this issue on X"`.
- Copy button: `aria-label="Copy archive link"` and after copy success
  `aria-live="polite"` region announces "Copied".

### 3.5 OG / `<title>` / SEO changes

Inside `ArchivePage`'s existing `useEffect`:

```ts
const dateStr = formatIssueDate(data.startedAt); // "May 6, 2026"
const ogTitle = `AI news - ${dateStr}`;
document.title = ogTitle;                         // was: `Issue — ${dateStr}`
setMeta("description", pickHeadline(null, topStoryTitle));   // unchanged
setMeta("og:title", ogTitle);                                // NEW
```

If `setMeta` only supports `<meta name=...>` and not `<meta property=og:...>`,
extend it. The two cases are syntactically interchangeable from the DOM
perspective, but Open Graph requires the `property` attribute, not `name`.

> **Known limitation:** SPA hydration. LinkedIn / X scrapers that don't
> execute JS will see the static `index.html` `<title>`. This is pre-existing
> for `<meta name="description">` and is out of scope to fix here. We add
> a TODO note in the design's *Future work* section at the bottom of this
> doc.

### 3.6 Error handling

The skill says: trust internal code, validate at boundaries. The boundary
here is the click handler. Concrete handling:

- **LinkedIn / X anchors:** no error path — the browser handles
  `<a target="_blank">` natively. If the URL build returns `""` (defensive
  guard for `archiveUrl` being empty), the anchor is rendered as
  `aria-disabled="true"` and not clickable. We assert `archiveUrl !== ""`
  on entry; in practice it can never be empty because `window.location.href`
  is always defined when the component renders.
- **Copy button:** wrap `navigator.clipboard.writeText(url)` in a try/catch.
  - Success → swap label to "COPIED ✓".
  - Failure → fall back to `document.execCommand("copy")` via a hidden
    `<textarea>` trick.
  - Double-failure → swap label to "COPY FAILED" and `console.warn` once.

### 3.7 Testing strategy

**Unit tests (`packages/web/tests/unit/lib/shareLinks.test.ts`):**
- `buildLinkedInShareUrl` URL-encodes `url`. No `text` param emitted.
- `buildXShareUrl` URL-encodes both `text` and `url`. Hostname is
  `twitter.com`. Path is `/intent/tweet`.
- `truncateForX` returns input unchanged when within budget.
- `truncateForX` returns 256-char output (255 + `…`) when over budget.
- `truncateForX` budget accounts for 24 reserved chars (URL + space).

**Component tests (`packages/web/tests/unit/components/ArchiveShareRow.test.tsx`):**
- Renders three controls with correct labels.
- LinkedIn anchor has `target="_blank"`, `rel="noopener noreferrer"`, and
  the LinkedIn share-offsite URL with the encoded `archiveUrl`.
- X anchor has the correct `intent/tweet?text=...&url=...` URL.
- Copy button click invokes `navigator.clipboard.writeText` with
  `archiveUrl` and the label swaps to "COPIED ✓" for ~1500 ms.
- Copy button uses `execCommand` fallback when `navigator.clipboard`
  is `undefined` (mock the global).
- All controls have appropriate `aria-label`s.

**E2E (Playwright) — minimal:** a single test on `/archive/:runId` that
asserts the three controls exist with the right hrefs. We don't navigate
to LinkedIn / X in the test (would hit external sites). We DO test the
copy-link feedback by mocking `navigator.clipboard`. This goes in
`packages/web/tests/e2e/archive-share.spec.ts`.

### 3.8 Security & privacy

- All anchors carry `rel="noopener noreferrer"` to prevent reverse-tab nav
  attacks.
- We don't send any tracking data with the click.
- The shared URL is `window.location.href` which is the canonical archive
  URL — no fragment, no query string. (If the page ever adds a query string
  for filters, strip it; for now `/archive/:runId` has none.)
- No user input is embedded in either intent URL — text and URL are derived
  from server data — so XSS surface in the intent URLs is nil. We still
  `encodeURIComponent` everything because that's how URLs work.

### 3.9 Out of scope (explicit)

- No SSR/pre-render of og: tags. Captured as future work below.
- No share-event analytics. The buttons expose `data-share-target=...`
  attributes that can be picked up by a future analytics shim.
- No customization of share text per-archive (e.g., admin-set teaser).
  The text is always `"AI news - <Date>"`.
- No share buttons on `/` (archive listing) — same justification as above:
  YAGNI; revisit if the listing ever becomes a primary share surface.

### 3.10 Future work

1. **SSR or pre-render og:tags** so LinkedIn/X scrapers that don't run JS
   see the right preview. Track separately.
2. **Per-archive teaser text** editable in admin review, fed into the
   X composer text. Track separately.
3. **Native share sheet on mobile** (`navigator.share`) as a 4th control
   that auto-hides on desktop. Track separately if usage warrants.
4. **Click telemetry.** Wire `data-share-target` into PostHog / etc when
   the analytics layer is added.

---

## Approval gate

This design covers Phase 1, Phase 2 (with a recommendation per axis), Phase
2.5 (fully declared external dependencies + fallback chain — required for
library-probe to pass), and Phase 3 (architecture, file layout, URLs, visuals,
testing, errors, scope).

**Asking the user to confirm before we move to library-probe:**
- Placement: header, immediately under "← All issues" link, before the
  first story.
- Visual: mono row, no fills, rust-on-hover; 44 px touch targets.
- Mechanism: plain intent URLs (LinkedIn `share-offsite` + X
  `intent/tweet`) via `<a target="_blank">` anchors. No `navigator.share`,
  no Web Share API.
- og:title set to `"AI news - <Date>"` (e.g., `"AI news - May 6, 2026"`)
  via `setMeta`; document.title aligned to match.
- New file: `packages/web/src/lib/shareLinks.ts` (URL builders +
  truncation helper, unit-tested).
- New file: `packages/web/src/components/ArchiveShareRow.tsx`.
- Modified: `packages/web/src/pages/ArchivePage.tsx` (renders share row +
  sets og:title).

Sources consulted during research:
- [Share on LinkedIn — Microsoft Learn](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin)
- [Web Intent — X Developer Platform](https://developer.x.com/en/docs/x-for-websites/tweet-button/guides/web-intent)
- [Tweet Button parameter reference](https://developer.x.com/en/docs/x-for-websites/tweet-button/guides/parameter-reference1)
- [Responsible Social Share Links — Jonathan Suh](https://jonsuh.com/blog/social-share-links/)
- [The Simplest Way to Offer Sharing Links — CSS-Tricks](https://css-tricks.com/simple-social-sharing-links/)
