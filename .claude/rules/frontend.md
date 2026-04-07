---
paths:
  - "packages/web/**/*.{ts,tsx}"
---

# Frontend Rules

## API communication

- All API calls go through the typed API client in `src/api/` — never call `fetch` directly from components
- The API client should mirror the backend's route structure for discoverability

## Component structure

- Pages are thin — they compose components and connect to the API client, but don't contain business logic
- Delegate data fetching and state logic to custom hooks
- Keep components focused on rendering — if a component is doing data transformation, extract it

## Routes

- `/archive` and `/digest/:date` are public
