# Run monorepo-wide commands, not package-specific filters

When writing scripts, hooks, or CI steps that run tests, lint, or build, always use the Turborepo-level command (e.g. `pnpm test:unit` via `turbo test:unit`) rather than filtering to a single package (e.g. `pnpm --filter @newsletter/pipeline test:unit`). Even if only one package currently has tests, other packages will add them later, and the hook/script should automatically pick them up.

Why: Targeting a single package means new packages with tests get silently skipped — the monorepo command scales automatically.
