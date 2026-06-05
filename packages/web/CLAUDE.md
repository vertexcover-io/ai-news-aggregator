# @newsletter/web

React + Vite frontend: public archive (Ledger aesthetic) + admin dashboard/review/settings/observability under `/admin/*`.

Page/component/hook surface and decisions: `.harness/knowledge/context/packages/web/PACKAGE.md` (+ sub-docs for `pages/`, `components/*`, `hooks/`, `layouts/`).

## Rules
- No direct DB access — all data comes through the API
- No direct Redis/BullMQ access
- Use the typed API client (`src/api/`) for backend communication — never call `fetch` from components
- Pages compose components and hooks; keep business logic out of JSX

## Stack notes
- Tailwind via `@tailwindcss/vite`; `@theme` tokens expose `font-serif` (Newsreader) and `font-mono` (Geist Mono); global styles in `src/index.css`
- Routing via `createBrowserRouter` + `RouterProvider` (required for `useBlocker` on the review page); root route is the public archive listing
- Data fetching/polling via `@tanstack/react-query`; forms via `react-hook-form`
- Markdown from external content must go through `SafeMarkdown` (DOMPurify-sanitized `react-markdown`, no `rehype-raw`)

## Mobile layout conventions
- Responsive horizontal padding `px-4 sm:px-6 md:px-8` on all in-scope pages (`/` and `/archive/:runId` use `md:px-20`)
- The `120px / 1fr / 120px` three-column grids reflow to a single column at `< md` via responsive `grid-template-columns` on a single DOM element — no duplicate markup
- The dashboard runs list uses a two-representation pattern: `RunsTable` at `sm:` and above, `RunsCardList` below 640 px — both receive the same `runs` prop
- DnD lists register `TouchSensor` with `activationConstraint: { delay: 250, tolerance: 5 }` so mobile users can scroll without dragging; drag handles need a ≥44×44 px touch target

## Commands
pnpm dev          # Start Vite dev server
pnpm build        # Production build
pnpm typecheck    # Type check
pnpm test:unit    # Run unit tests (vitest + jsdom)
