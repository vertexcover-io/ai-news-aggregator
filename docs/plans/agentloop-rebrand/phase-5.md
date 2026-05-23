# Phase 5: Web shell — Masthead + Footer + PublicLayout

> **Status:** pending

## Overview

Build the shared chrome: `Masthead` with the three-item top-right nav (MUST READ · BUILT · SUBSCRIBE →), `Footer` with the colophon line + masthead row + inline subscribe field, and refactor `PublicLayout` to use both. This phase delivers no new pages — just the chrome they'll wear.

## Implementation

**Files:**

- Create: `packages/web/src/components/shell/Masthead.tsx`
  - Props: `{ activeNavItem?: "must-read" | "built" }` — controls the rust+underline active state
  - Renders: `AGENTLOOP` wordmark, `A Vertexcover Labs publication` sub-line, top-right `MUST READ · BUILT · SUBSCRIBE →` nav
- Create: `packages/web/src/components/shell/Footer.tsx`
  - Renders: hairline rule, colophon italic line (with `See how it's built →` linking to `/built`), hairline rule, three-column row (masthead repeat / inline subscribe field / `ABOUT · BUILT · RSS` links)
- Create: `packages/web/src/components/shell/DirectoryNav.tsx`
  - Renders the full nav row `TODAY · ARCHIVE · MUST READ · SOURCES · TOOLS · BUILT`
  - Used on `/must-read` and `/built` only (NOT on `/` per REQ-009)
- Create: `packages/web/src/components/shell/InlineSubscribeCard.tsx`
  - Reusable: renders the editorial subscribe card (serif headline `Read AgentLoop every morning.`, mono `What we read so you don't have to. 7am daily, free.`, email input, rust `SUBSCRIBE →` button)
  - On submit, calls the same API the existing `SubscribeWidget.tsx` uses (extract the API call into `packages/web/src/api/subscribe.ts` if not already there)
  - Has `data-section="inline-subscribe"` and `data-purpose="subscribe"` for test assertions
- Modify: `packages/web/src/layouts/PublicLayout.tsx`
  - Replace the inline `Footer` block with `<Masthead activeNavItem={...} />` + `<Outlet />` + `<Footer />`
  - Accept an optional `activeNavItem` prop OR derive it from `useLocation()` (prefer the latter — keeps the route table clean)
- Create: `packages/web/tests/unit/components/shell/Masthead.test.tsx`
- Create: `packages/web/tests/unit/components/shell/Footer.test.tsx`
- Create: `packages/web/tests/unit/components/shell/InlineSubscribeCard.test.tsx`

**Tests (REQ traceability):**

- **REQ-001:** Masthead renders the four literal strings (`AGENTLOOP`, `A Vertexcover Labs publication`, `MUST READ`, `BUILT`, `SUBSCRIBE →`)
- **REQ-001 (mobile collapse):** at `<640px` viewport, only `SUBSCRIBE →` is visible from the top-right nav
- **REQ-005:** InlineSubscribeCard renders the two literal copy strings; form has `action="/api/subscribe"` and `method="POST"`
- **REQ-008:** Footer renders the colophon literal; the `See how it's built →` link's `href` equals `/built`
- **REQ-032:** every `[data-purpose="subscribe"]` form on the rendered page has the right action/method
- **REQ-012 (rel/target — partial — full coverage in P6):** the InlineSubscribeCard does not need this, but verify the shell components don't strip the props when set on children

**Pattern to follow:**
- `packages/web/src/layouts/PublicLayout.tsx` for current layout shape
- `packages/web/src/components/SubscribeWidget.tsx` for the subscribe API call (extract its core into `api/subscribe.ts` if needed)
- `.claude/rules/learnings/web-shared-subpath-imports.md` — any import from `@newsletter/shared` MUST use subpath form

**Traces to:** REQ-001, REQ-005, REQ-008, REQ-012 (partial), REQ-032

**Visual reference:** `/tmp/agentloop-previews/home.html` is authoritative for typography, spacing, colors. Transcribe class names and inline styles literally rather than reinventing.

**Commit:** `feat(web): add Masthead, Footer, DirectoryNav, InlineSubscribeCard shell components`

## Done When

- [ ] All four new components built with passing unit tests
- [ ] PublicLayout refactored; existing pages (`/`, `/archive/:runId`) still render (they'll be replaced in P6 but must not break in the meantime)
- [ ] `pnpm --filter @newsletter/web test:unit` green
- [ ] `pnpm --filter @newsletter/web build` green (catches Buffer-in-browser regressions per the shared-subpath-imports learning)
- [ ] `pnpm typecheck` and `pnpm lint` green
