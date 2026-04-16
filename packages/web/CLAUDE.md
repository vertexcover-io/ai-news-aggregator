# @newsletter/web

React + Vite frontend for the admin review dashboard and public archive.

## Responsibilities
- Dashboard (`/`): shows recent runs table, schedule status banner, and "Run Now" button
- Settings (`/settings`): configure schedule and HN/Reddit source config
- Review (`/review/:runId`): curate ranked items before publishing — reorder (DnD), remove, add by URL
- Run page (`/run`): legacy ad-hoc run with custom config; kept for backwards compat
- Archive (`/archive/:runId`): recap-style read-only view of a completed run
- Communicates with `@newsletter/api` via HTTP only

## Layout
- `src/pages/` — top-level route components (`DashboardPage.tsx`, `SettingsPage.tsx`, `ReviewPage.tsx`, `RunPage.tsx`, `ArchivePage.tsx`)
- `src/components/` — presentational pieces:
  - `RunForm/`, `StatusPanel.tsx`, `ResultList.tsx` — existing run-page components
  - `review/` — `ReviewList.tsx` (DnD list), `ReviewCard.tsx`, `AddPostPanel.tsx`, `SaveBar.tsx`
  - `dashboard/` — dashboard-specific components
  - `settings/` — settings-specific components
  - `ui/` — shadcn base components (Button, Input, etc.)
- `src/api/` — typed API client (`client.ts` for the fetch wrapper, `runs.ts`, `settings.ts`, `archives.ts`)
- `src/hooks/` — custom hooks (`useRunPolling.ts`, and hooks for settings and review mutations)

## Stack notes
- Tailwind CSS via `@tailwindcss/vite`; global styles in `src/index.css`
- Routing via `react-router-dom` using `createBrowserRouter` + `RouterProvider` (required for `useBlocker` in the review page); root route is DashboardPage (`/`)
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
