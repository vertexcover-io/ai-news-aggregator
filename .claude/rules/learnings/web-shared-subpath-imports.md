# Web → shared: always use subpath imports

When `@newsletter/web` imports from `@newsletter/shared`, always use a subpath like `@newsletter/shared/constants` or `@newsletter/shared/types` — **never** the root `@newsletter/shared`.

## Why

The root barrel re-exports everything including the Drizzle DB client (`getDb`, `AppDb`), which transitively pulls `postgres` into the dependency graph. Vite resolves these at build time and Buffer/Node-only modules end up in the browser bundle, breaking at runtime with `Buffer is not defined` or similar.

This regression bit us in the prior admin-pipeline-cost-analysis attempt (the one that got reverted in commit `6180492`). The current attempt fixed it by using subpath imports throughout the new cost code.

## Rule

In any file under `packages/web/`:

- ✅ `import { COST_TRACKING_LAUNCHED_AT } from "@newsletter/shared/constants"`
- ✅ `import type { RunCostBreakdown } from "@newsletter/shared/types"`
- ❌ `import { COST_TRACKING_LAUNCHED_AT, type RunCostBreakdown } from "@newsletter/shared"`

If `@newsletter/shared` doesn't expose the subpath you need, **add the subpath to `packages/shared/tsup.config.ts` and `package.json#exports`** — don't fall back to the root.

## Verification

After any web-package change that touches a new shared import:

```bash
pnpm --filter @newsletter/web build
```

If the bundle silently grows by hundreds of KB or build warns about Node built-ins, you've leaked DB code into the browser. Switch to subpath imports.
