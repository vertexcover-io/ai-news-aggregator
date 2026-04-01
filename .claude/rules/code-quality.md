# Code Quality

## TypeScript standards

- Strict mode is non-negotiable — no `any` types, no `@ts-ignore`, no `as unknown as X` casts
- Define explicit return types on exported functions
- Use `const` by default, `let` only when reassignment is necessary, never `var`
- Prefer `interface` for object shapes, `type` for unions and intersections
- Use exhaustive switch statements with `never` checks for discriminated unions

## Keep code simple

- No premature abstractions — don't create util helpers, wrapper classes, or generic abstractions for things used only once. Three similar lines of code is better than a premature abstraction.
- No speculative features — don't add configurability, feature flags, or extension points "for later"
- No defensive error handling on internal code paths — only validate at system boundaries (API request input, external API responses, scraper outputs). Trust internal functions.
- No unnecessary comments — don't add docstrings or comments to self-explanatory code. Only comment when the "why" isn't obvious from the code itself.

## Logging

- Log at service boundaries: job started/completed/failed, API requests, external API calls
- Include structured context (job ID, source name, duration, item count)
- Don't log inside tight loops or internal helper functions
- Use appropriate log levels: `error` for failures requiring attention, `warn` for recoverable issues, `info` for operational events
