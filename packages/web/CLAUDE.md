# @newsletter/web

React + Vite frontend for the admin review dashboard and public archive.

## Responsibilities
- `/run` page (currently the only implemented page): authenticated user configures HN + Reddit, submits, polls, and views ranked results with rationale
- Future: admin review/approval UI and public archive of past digests
- Communicates with `@newsletter/api` via HTTP only

## Layout
- `src/pages/` — top-level route components (`RunPage.tsx`)
- `src/components/` — presentational pieces (`RunForm/`, `StatusPanel.tsx`, `ResultList.tsx`)
- `src/api/` — typed API client (`client.ts` for the fetch wrapper, `runs.ts` for run endpoints)
- `src/auth/` — `PasswordGate` component and `useAuth` hook for the MVP password flow
- `src/hooks/` — custom hooks (`useRunPolling.ts` wraps react-query polling against `GET /api/runs/:runId`)

## Stack notes
- Tailwind CSS via `@tailwindcss/vite`; global styles in `src/index.css`
- Routing via `react-router-dom` (root redirects `/` -> `/run`)
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
