# Learnings — Manual Social Post Trigger

## The worker already had the parameter

`resolvePublishTarget({ runId })` in both `linkedin-post` and `twitter-post` workers already
accepted an optional `runId`. When `runId` is present the worker posts that specific archive;
when absent it falls back to `findLatestTerminal()`. The entire feature (manual trigger of a
specific run's social post) required **zero changes to the pipeline workers** — only:

1. A new API route (`POST /api/runs/:runId/post/:channel`) that validates eligibility and enqueues
   the job with `{ runId }`.
2. Extended `RunSummary` serialization in `run-list.ts` (social posted-at + permalink fields).
3. A new `SocialOverflowMenu` UI component wiring the mutation to the dashboard rows.

**Principle:** Before designing new worker functionality, always check whether existing workers
are already parameterized for the new use-case. The scheduled vs. targeted path split in these
workers was built for exactly this. See the global pattern doc for how to apply this check
systematically.

Global doc: `docs/solutions/design-patterns/check-existing-worker-parameterization-before-new-code-20260526.md`

## node:crypto browser stub (pre-existing regression)

The Vite dev server crashed on load because `@newsletter/shared`'s root barrel re-exports
`credential-cipher.ts`, which imports `node:crypto`. This is a pre-existing regression on
`origin/main`. Fix applied in `vite.config.ts`: added a `resolve.alias` mapping `"node:crypto"`
to `packages/web/src/stubs/node-crypto.ts` (a stub that throws on call). See the existing
rule in `.claude/rules/learnings/web-shared-subpath-imports.md` for why web should import
from subpaths rather than the root barrel.
