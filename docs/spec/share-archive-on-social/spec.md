# SPEC: Share Archive on Social

**Source:** docs/spec/share-archive-on-social/design.md
**Library probe:** docs/spec/share-archive-on-social/library-probe.md (verdict PASS)
**Linear:** VER-68 / share-newsletter-on-social-easily
**Generated:** 2026-05-06

## Requirements

| ID | Type | Requirement | Acceptance Criterion | Priority |
|----|------|-------------|----------------------|----------|
| REQ-001 | Ubiquitous | The system shall render a share row on `/archive/:runId` (only when `data.status === "completed"`) consisting of three controls: a LinkedIn anchor, an X (Twitter) anchor, and a Copy-link button. | At a completed archive URL, the page contains exactly one element with `data-testid="archive-share-row"` containing children with `data-share-target` values of `linkedin`, `x`, and `copy`. The row does not render on loading, error, cancelled, or in-progress states. | Must |
| REQ-002 | Ubiquitous | The system shall place the share row in the page header region, immediately below the existing "← All issues" back-link and above the first story divider, inside the same `max-w-[1120px]` content container. | DOM order on a completed archive: `ArchivePageHeader` → `ArchiveShareRow` → first `ArchiveStoryCard`. The row sits inside the existing `<div class="mx-auto max-w-[1120px] …">` wrapper. | Must |
| REQ-003 | Event-driven | When the user clicks the LinkedIn control, the system shall navigate (in a new tab) to `https://www.linkedin.com/sharing/share-offsite/?url=<encoded-archive-url>` with `target="_blank"` and `rel="noopener noreferrer"`. | The control is an `<a>` whose `href` exactly matches `https://www.linkedin.com/sharing/share-offsite/?url=` followed by `encodeURIComponent(window.location.href)`. `target` is `"_blank"` and `rel` includes both `noopener` and `noreferrer`. | Must |
| REQ-004 | Event-driven | When the user clicks the X control, the system shall navigate (in a new tab) to `https://twitter.com/intent/tweet?text=<truncated-text>&url=<encoded-archive-url>` with `target="_blank"` and `rel="noopener noreferrer"`. | The control is an `<a>` whose `href` matches the pattern `https://twitter.com/intent/tweet?text=...&url=...`, where `text` is `encodeURIComponent(truncateForX(shareText, 24))` and `url` is `encodeURIComponent(window.location.href)`. `target` and `rel` as above. | Must |
| REQ-005 | Ubiquitous | The system shall derive the share text from the archive's start date as `"AI news - <Month D, YYYY>"` (e.g., `"AI news - May 6, 2026"`). | When `data.startedAt` is `2026-05-06T...`, the `text` query param decodes to `"AI news - May 6, 2026"`. | Must |
| REQ-006 | Ubiquitous | The system shall expose a pure helper `truncateForX(text, reservedForUrl)` that returns the original text when its length is at most `280 − reservedForUrl`, and otherwise returns the first `(280 − reservedForUrl − 1)` characters followed by a single Unicode ellipsis `"…"`. | Unit tests in `packages/web/tests/unit/lib/shareLinks.test.ts` cover: input within budget passes through; input exactly at budget passes through; input one over budget gets `255 + "…"` (when `reservedForUrl=24`); empty input returns empty string. | Must |
| REQ-007 | Event-driven | When the user clicks the Copy-link button, the system shall write `window.location.href` to the clipboard via `navigator.clipboard.writeText`, then swap the button label from `"COPY LINK"` to `"COPIED ✓"` for 1500 ms (using the rust accent `#8C3A1E` color), then revert. | Component test mocks `navigator.clipboard.writeText` and asserts: it is called once with the expected URL; the button label updates to `"COPIED ✓"` immediately; after `1500 ms` (`vi.advanceTimersByTime`) the label reverts to `"COPY LINK"`. | Must |
| REQ-008 | Event-driven | When `navigator.clipboard` is unavailable (insecure origin / older browsers), the system shall fall back to creating a temporary hidden `<textarea>`, selecting its contents, calling `document.execCommand("copy")`, and then removing the textarea. The success label swap shall still occur on a `true` return. | Component test stubs `navigator.clipboard` as `undefined` and stubs `document.execCommand` to return `true`; asserts a textarea is briefly added then removed; asserts `execCommand("copy")` is invoked; asserts the label still swaps to `"COPIED ✓"`. | Must |
| REQ-009 | Event-driven | When both Clipboard API and `execCommand` fail, the system shall set the button label to `"COPY FAILED"` for 1500 ms. | Component test stubs both as failing; asserts label = `"COPY FAILED"`. | Should |
| REQ-010 | Ubiquitous | The system shall set `document.title` to `"AI news - <Month D, YYYY>"` and call `setMeta("og:title", "AI news - <Month D, YYYY>")` whenever a completed archive renders. The previous `setMeta("description", ...)` call shall be retained. | Component / page test asserts `document.title` and `<meta property="og:title">` are present with the exact expected string after the page settles. | Must |
| REQ-011 | Ubiquitous | The system shall extend `packages/web/src/lib/meta.ts`'s `setMeta(key, content)` so that when `key` starts with `"og:"`, the helper writes `<meta property="<key>" content="<content>">` (and updates the `property=` tag on subsequent calls), instead of `<meta name="<key>">`. Calls with non-`og:` keys retain existing `name=` behavior. | Unit test in `packages/web/tests/unit/lib/meta.test.ts`: after `setMeta("og:title", "X")`, `document.head.querySelector('meta[property="og:title"]')?.getAttribute("content") === "X"` and `document.head.querySelector('meta[name="og:title"]')` is `null`. After `setMeta("description", "Y")`, the `name=` form is used. Calling `setMeta("og:title", "Z")` a second time updates the existing `property=` element rather than creating a duplicate. | Must |
| REQ-012 | Ubiquitous | The system shall render share controls as ghost (text-only) elements in the existing Geist Mono eyebrow style — uppercase, tracking-widest, neutral-500 by default, `#8C3A1E` rust on hover/focus — separated by mid-dot `·` glyphs in `text-neutral-300`. Icons (14×14, `currentColor`, `aria-hidden`) sit to the left of each label. | Visual: a Playwright (or component) snapshot of the row at desktop width matches the documented Tailwind classes. Hover over each control switches text color to `#8C3A1E`. No filled background, no border, no shadow. | Must |
| REQ-013 | Ubiquitous | The system shall ensure each share control has a minimum 44 × 44 CSS-pixel touch target at any viewport width via `min-h-[44px]` and adequate horizontal padding (`px-2`). | Component test asserts each control has computed `min-height` ≥ 44 px (using `getBoundingClientRect()`-style assertion via Playwright e2e at width 375). | Must |
| REQ-014 | Ubiquitous | The system shall provide accessible names: LinkedIn anchor → `aria-label="Share this issue on LinkedIn"`; X anchor → `aria-label="Share this issue on X"`; Copy button → `aria-label="Copy archive link"`. After successful copy, the success label change is announced via `aria-live="polite"`. | Tests assert each `aria-label` and that the live region renders `"Copied"` after the click. | Must |
| REQ-015 | Ubiquitous | The system shall not introduce new runtime dependencies in `packages/web`. All logic lives in two new files (`src/lib/shareLinks.ts`, `src/components/ArchiveShareRow.tsx`) plus a small extension to `src/lib/meta.ts` and a small wiring change in `src/pages/ArchivePage.tsx`. | `git diff main -- packages/web/package.json` shows no `dependencies`/`devDependencies` additions. | Must |
| REQ-016 | Ubiquitous | The system shall keep the share controls absent on routes other than `/archive/:runId` (root listing `/`, admin pages, login, settings, dashboard, review). | Manual / e2e: visiting `/`, `/admin`, `/admin/login`, `/admin/review/:runId`, `/admin/settings` shows no element with `data-testid="archive-share-row"`. | Must |
| REQ-017 | Ubiquitous | The system shall preserve all existing baseline lint, typecheck, and unit-test pass states (per `docs/spec/share-archive-on-social/baseline.json`). | `pnpm lint && pnpm typecheck && pnpm test:unit` passes from a clean checkout of the branch. | Must |

## Edge Cases

| ID | Scenario | Expected Behavior | Derived From |
|----|----------|-------------------|--------------|
| EDGE-001 | The archive URL contains characters that need encoding (none in practice; `/archive/<uuid>` is ASCII). | The URL builders pass `archiveUrl` through `encodeURIComponent`; e.g., the UUID dashes are not double-escaped. | REQ-003, REQ-004 |
| EDGE-002 | The user opens the page in an SPA navigation (no full reload), then clicks share. | `window.location.href` is current at click time because the share-URL builders are evaluated inside the click-handling code path; the anchor `href` is recomputed on each render via the component's `archiveUrl` prop derived from `window.location.href`. | REQ-003, REQ-004 |
| EDGE-003 | The archive's `startedAt` falls in a non-en-US locale browser. | `formatIssueDate` continues to use `en-US` (existing helper) so the share text is always `"AI news - May 6, 2026"` — predictable across users and matches the og:title shown on social previews. | REQ-005, REQ-010 |
| EDGE-004 | The user double-clicks Copy-link before the 1500 ms revert. | Each click triggers a write and resets the timer; the label stays at `"COPIED ✓"` until 1500 ms after the *last* click. (The success effect is implemented with a single `useEffect` cleanup that clears any previous timeout before scheduling the next.) | REQ-007 |
| EDGE-005 | The user is offline when they click LinkedIn or X. | The browser handles the navigation (anchor target=_blank). Offline → empty/error tab on the social site; our app is unaffected. | REQ-003, REQ-004 |
| EDGE-006 | The page mounts in JSDOM during unit tests (`navigator.clipboard` and `document.execCommand` absent). | Tests must inject mocks via `Object.defineProperty(...)` per the documented pattern; real browsers always have at least one. | REQ-007, REQ-008 |
| EDGE-007 | A future archive has a title-format change that produces a `text` longer than 256 chars. | `truncateForX` shortens it to 255 chars + `"…"`; the X composer remains within 280 chars including the `t.co`-shortened URL. | REQ-006 |
| EDGE-008 | A scraper (LinkedIn / X bot) hits the URL but does not execute JavaScript. | The static `index.html` `<title>` (`"Newsletter"`) is shown. **Documented limitation; future SSR work tracked in `design.md` § Future work.** Out of scope for this PR. | REQ-010 |
| EDGE-009 | The component re-renders mid-`COPIED ✓` flash because of an unrelated query refetch. | The label state is local to `ArchiveShareRow` (useState), not tied to query data, so the flash persists for the full 1500 ms. The cleanup function in `useEffect` clears the timeout on unmount. | REQ-007 |
| EDGE-010 | A pop-up blocker prevents `target="_blank"` from opening a new tab (rare on direct anchors, more common on scripted `window.open`). | Using `<a>` anchors avoids the scripted-popup case. If a browser still blocks, the in-page navigation falls through (user clicks → browser handles per its own policy). | REQ-003, REQ-004 |

## Verification Scenarios

These probes from Stage 1.5 (`docs/spec/share-archive-on-social/probes/`) re-run during Stage 5 functional verification:

### VS-0-linkedin: LinkedIn share-offsite endpoint reachable
- **Type:** http (curl)
- **Run:** `bash docs/spec/share-archive-on-social/probes/probe-linkedin.sh`
- **Expected:** exit 0; HTTP 2xx/3xx for `https://www.linkedin.com/sharing/share-offsite/?url=...`

### VS-0-x: X (Twitter) intent endpoint reachable
- **Type:** http (curl)
- **Run:** `bash docs/spec/share-archive-on-social/probes/probe-x.sh`
- **Expected:** exit 0; HTTP 2xx/3xx for `https://twitter.com/intent/tweet?text=...&url=...`

### VS-0-clipboard: Clipboard / execCommand absence in JSDOM 29 (informational)
- **Type:** vitest
- **Run:** `bash docs/spec/share-archive-on-social/probes/probe-clipboard.sh`
- **Expected:** exit 0. Confirms tests need to inject mocks.

### VS-0-meta-FIXED: setMeta supports `<meta property="og:title">` after fix
- **Type:** vitest (replaces VS-0-meta-CURRENT after coder phase)
- **Run:** the new unit test in `packages/web/tests/unit/lib/meta.test.ts` from REQ-011.
- **Expected:** all assertions pass.

### VS-0-anchor: Anchor target=_blank + window.open work in JSDOM
- **Type:** vitest
- **Run:** `bash docs/spec/share-archive-on-social/probes/probe-anchor.sh`
- **Expected:** exit 0.

### VS-1-render-share-row: archive page renders share row at completed status
- **Type:** vitest (component) + Playwright (e2e)
- **Run:** unit — render `ArchivePage` with mock `useArchive` returning a completed run; assert `data-testid="archive-share-row"` is present and contains three children with `data-share-target` of `linkedin`, `x`, `copy`. e2e — navigate to `/archive/<seed-runId>` in a real browser; assert the same.
- **Expected:** all assertions pass.

### VS-2-share-urls-match-pattern: anchor hrefs are correct
- **Type:** vitest
- **Run:** render `ArchiveShareRow` with `archiveUrl="https://example.com/archive/abc"` and `shareText="AI news - May 6, 2026"`; assert LinkedIn anchor `href` and X anchor `href` exactly match REQ-003 / REQ-004 patterns.
- **Expected:** assertions pass.

### VS-3-copy-success: clipboard primary path
- **Type:** vitest (component)
- **Run:** mock `navigator.clipboard.writeText`; click Copy; assert single call with the URL and label swap to `"COPIED ✓"`; advance 1500 ms; assert revert to `"COPY LINK"`.
- **Expected:** pass.

### VS-4-copy-fallback: execCommand fallback path
- **Type:** vitest (component)
- **Run:** stub `navigator.clipboard = undefined`; stub `document.execCommand = vi.fn(() => true)`; click Copy; assert `execCommand("copy")` invoked and label swap to `"COPIED ✓"`; assert no orphan textarea remains in DOM.
- **Expected:** pass.

### VS-5-og-title-set: og:title renders after archive load
- **Type:** vitest (page) or Playwright
- **Run:** mount `ArchivePage` with `data.startedAt = "2026-05-06T..."` completed; assert `document.title === "AI news - May 6, 2026"` and `<meta property="og:title" content="AI news - May 6, 2026">` is present.
- **Expected:** pass.

### VS-6-share-row-absent-on-other-routes: scoped only to archive
- **Type:** Playwright (e2e)
- **Run:** navigate to `/`, `/admin/login`; assert no element with `data-testid="archive-share-row"` exists.
- **Expected:** pass.

### VS-7-baseline-preserved: typecheck/lint/unit still pass
- **Type:** ci
- **Run:** `pnpm lint && pnpm typecheck && pnpm test:unit` from a clean branch checkout.
- **Expected:** all green; warning count ≤ 6 (the recorded baseline).
