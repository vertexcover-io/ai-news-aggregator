# @newsletter/shared

Drizzle DB schema, shared types, constants, utils, and cross-cutting services (credential crypto, Slack, scheduling). Single source of truth for the data layer — every other package depends on it.

Detailed surface, data flows, and decisions: `.harness/knowledge/context/packages/shared/PACKAGE.md` (+ sub-package docs for `db/`, `types/`, `scheduling/`, `slack/`, …).

## Rules
- This package defines tables — no other package should
- Export only types that are used by 2+ packages
- Use `.$type<T>()` on jsonb columns for type safety
- Schema changes require `pnpm drizzle-kit generate` to create migrations
- Never modify a migration file after it has been applied; inspect generated migrations for bare `ADD COLUMN ... NOT NULL` on populated tables
- Web code must use subpath imports (`@newsletter/shared/<sub>`) — the root barrel leaks the DB client into the browser
- Rotating `SESSION_SECRET` invalidates all encrypted credentials at rest (it is the HKDF KEK for the credential cipher)
- New `MODEL_PRICING` entries must include all five rate fields (`inputPerMTok`, `outputPerMTok`, `cacheReadPerMTok`, `cacheWrite5mPerMTok`, `cacheWrite1hPerMTok`); thinking tokens bill at the output rate

## Commands
pnpm drizzle-kit generate   # Generate migration from schema changes
pnpm drizzle-kit migrate    # Apply pending migrations
pnpm build                  # Build with tsup
pnpm typecheck              # Type check
