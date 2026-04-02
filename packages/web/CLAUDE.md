# @newsletter/web

React + Vite frontend for the admin review dashboard and public archive.

## Responsibilities
- Admin UI for reviewing and approving newsletter items
- Public archive of past digests
- Communicates with @newsletter/api via HTTP only

## Rules
- No direct DB access — all data comes through the API
- No direct Redis/BullMQ access
- Use the typed API client for backend communication

## Commands
pnpm dev          # Start Vite dev server
pnpm build        # Production build
pnpm typecheck    # Type check
