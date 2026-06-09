---
governs: packages/shared/src/analytics/
last_verified_sha: abbc2469ab05df29b744dde2701d59a7803124e9
key_files: [posthog-config.ts, run-health.ts, index.ts]
flow_fns: [posthog-config.ts::resolvePostHogConfig, run-health.ts::evaluateRunHealth]
decisions: [D-141, D-142]
status: active
---

# analytics/ — pure PostHog config resolver and run-health degradation evaluator

## Purpose

Server-safe subpath (`@newsletter/shared/analytics`) exporting two pure functions used by both
`@newsletter/api` and `@newsletter/pipeline`. No DB, no browser APIs, no IO — safe to import
in any server context. Exported via the `./analytics` subpath in `package.json` + `tsup.config.ts`.

**Not for web** — the subpath avoids pulling server deps into the browser bundle (D-100).

## Public surface

### posthog-config.ts
- `resolvePostHogConfig(settings, env?) → PublicPostHogConfig` — single authoritative resolver for PostHog config:
  - `settings !== null` → uses DB values: `posthogEnabled`, `posthogProjectToken`, `posthogHost` (whitespace-cleaned); `enabled` only when all three present and truthy
  - `settings === null` → reads env: `POSTHOG_PROJECT_TOKEN` (or `POSTHOG_API_KEY` alias), `POSTHOG_HOST` (default `https://us.i.posthog.com`), `POSTHOG_ENABLED` (default `"true"`); `enabled` only when token present
  - Returns `{ posthogEnabled: boolean, posthogProjectToken: string|null, posthogHost: string|null }`
- `PublicPostHogConfig` — output type
- `PostHogSettings` — input settings type (Pick of UserSettings)
- `DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com"`

### run-health.ts
- `evaluateRunHealth(input: RunHealthInput) → RunHealthFinding[]` — pure degradation evaluator; no IO:
  - Returns `[]` immediately for `input.isDryRun === true` (backward-compat for dry runs)
  - Rule 1: `enrichment_failure_rate` — if `failed / (ok + failed) > ENRICHMENT_FAILURE_RATE_THRESHOLD` and `total > 0`
  - Rule 2: `zero_yield_source` — one finding per source where `historicalYield === true && collected === 0`
  - Rule 3: `partial_publish` — if `ok >= 1 && failed >= 1`
- `ENRICHMENT_FAILURE_RATE_THRESHOLD = 0.3` — default threshold; tune empirically
- `RunHealthInput`, `RunHealthFinding`, `RunHealthKind` — pure value types (no DB)

## Depends on / used by
- Uses: only `@newsletter/shared/types` (for `UserSettings` pick) — no DB, no ioredis, no third-party deps
- Used by:
  - `@newsletter/api/src/lib/posthog.ts` — `resolvePostHogConfig(settings)` for settings-backed client resolution
  - `@newsletter/pipeline/src/lib/posthog.ts` — `resolvePostHogConfig(null)` for env-only client resolution
  - `@newsletter/pipeline/src/services/finalize-run.ts` — `evaluateRunHealth` for run degradation events

## Data flows

### resolvePostHogConfig(settings, env?) → PublicPostHogConfig
  settings:
    ├─ not null → use DB values:
    │   clean(settings.posthogProjectToken) → token
    │   clean(settings.posthogHost) → host
    │   settings.posthogEnabled && token && host → enabled
    │     ├─ enabled: true  → { posthogEnabled: true, posthogProjectToken: token, posthogHost: host }
    │     └─ enabled: false → { posthogEnabled: false, posthogProjectToken: null, posthogHost: null }
    └─ null → read from env:
        clean(env.POSTHOG_PROJECT_TOKEN ?? env.POSTHOG_API_KEY) → token
        clean(env.POSTHOG_HOST) ?? DEFAULT_POSTHOG_HOST → host
        (env.POSTHOG_ENABLED ?? "true").toLowerCase() !== "false" && token → enabled
          ├─ enabled: true  → { posthogEnabled: true, posthogProjectToken: token, posthogHost: host }
          └─ enabled: false → { posthogEnabled: false, posthogProjectToken: null, posthogHost: null }

### evaluateRunHealth(input) → RunHealthFinding[]
  input.isDryRun:
    ├─ true → []
    └─ false → evaluate three rules in order:
        enrichment (if not null, total > 0, rate > 0.3) → push enrichment_failure_rate finding
        sources (if not null) → per source: historicalYield && collected === 0 → push zero_yield_source
        publish (if not null, ok >= 1 && failed >= 1) → push partial_publish
        → return findings[]

## Gotchas / landmines
- **Zero denominator guard**: `evaluateRunHealth` checks `total > 0` before computing `failed/total` to prevent NaN/Infinity on the enrichment rule. Null telemetry (`enrichment: null`) also returns no finding. (EDGE-006)
- **historicalYield must be true for zero_yield_source to fire**: sources without historical data (`historicalYield: false`) never generate this finding — currently all sources at the `finalizeRun` call site pass `historicalYield: false`, so the `zero_yield_source` rule is effectively disabled there until historical data is available.
- **Dry-run check is first**: `isDryRun: true` returns `[]` before any telemetry is evaluated — no false findings on synthetically-triggered runs.

## Decisions
- D-141: resolvePostHogConfig moved here from packages/api/src/lib/posthog-config.ts. Cross-package — full body in root DECISIONS.md.
- D-142: evaluateRunHealth is pure; degradation signals emitted as PostHog custom events. Cross-package — full body in root DECISIONS.md.
