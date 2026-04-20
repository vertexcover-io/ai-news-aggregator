# @newsletter/web

React + Vite frontend for the admin review dashboard and public archive.

## Responsibilities
- Archive listing (`/`): PUBLIC — Ledger-layout listing of reviewed archives, month-grouped, with filter chips, client-side "Load more", and a featured first row when a lead summary is available
- Archive detail (`/archive/:runId`): PUBLIC — Ledger-aesthetic read-only view of a completed run: serif/mono typography, 3-column story sections with numbered N° rail, image plates, and rust-accented recap blocks; wrapped by `PublicLayout` (shared Nav + Footer)
- Admin login (`/admin/login`): password gate for operator pages
- Dashboard (`/admin`): shows recent runs table, schedule status banner, and "Run Now" button
- Review (`/admin/review/:runId`): curate ranked items before publishing — reorder (DnD), remove, add by URL
- Settings (`/admin/settings`): configure schedule and HN/Reddit source config
- Communicates with `@newsletter/api` via HTTP only

## Layout
- `src/pages/` — top-level route components (`ArchiveListingPage.tsx`, `ArchivePage.tsx`, `DashboardPage.tsx`, `ReviewPage.tsx`, `SettingsPage.tsx`, `AdminLoginPage.tsx`)
- `src/components/` — presentational pieces:
  - `archive-listing/` — `ArchiveRow.tsx`, `FilterChip.tsx`, `MonthHeader.tsx`, `format.ts` (Ledger listing components)
  - `RunForm/`, `StatusPanel.tsx`, `ResultList.tsx` — run-page components
  - `review/` — `ReviewList.tsx` (DnD list), `ReviewCard.tsx`, `AddPostPanel.tsx`, `SaveBar.tsx`
  - `dashboard/` — dashboard-specific components
  - `settings/` — settings-specific components
  - `ui/` — shadcn base components (Button, Input, etc.)
- `src/api/` — typed API client (`client.ts` for the fetch wrapper, `runs.ts`, `settings.ts`, `archives.ts`)
- `src/hooks/` — custom hooks (`useRunPolling.ts`, and hooks for settings and review mutations)
- `src/layouts/` — `PublicLayout.tsx` (wraps `/` and `/archive/:runId`), `AdminLayout.tsx`, `RequireAdmin.tsx`

## Stack notes
- Tailwind CSS via `@tailwindcss/vite`; global styles in `src/index.css`; `@theme` tokens expose `font-serif` (Newsreader) and `font-mono` (Geist Mono) utilities loaded via Google Fonts in `index.html`
- Routing via `react-router-dom` using `createBrowserRouter` + `RouterProvider` (required for `useBlocker` in the review page); root route is `ArchiveListingPage` (`/`)
- Data fetching/polling via `@tanstack/react-query`
- Forms via `react-hook-form`

## Rules
- No direct DB access — all data comes through the API
- No direct Redis/BullMQ access
- Use the typed API client (`src/api/`) for backend communication — never call `fetch` from components
- Pages compose components and hooks; keep business logic out of JSX

## Commands
pnpm dev          # Start Vite dev server
pnpm build        # Production build
pnpm typecheck    # Type check
pnpm test:unit    # Run unit tests (vitest + jsdom)
