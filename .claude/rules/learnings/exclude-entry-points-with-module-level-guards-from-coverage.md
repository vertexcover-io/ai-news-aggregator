# Exclude entry-point files with module-level env-var guards from coverage collection

`src/index.ts` files that throw at module load time when a required env var is missing will crash vitest's test collection — not just the test file, but the entire collection phase. The error fires before any test runs.

When adding a package entry point to coverage, check whether it has module-level guards:

```ts
// src/index.ts — this throws during vitest collection if ANTHROPIC_API_KEY is unset
if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error("ANTHROPIC_API_KEY is required");
}
```

If it does, exclude it from coverage in `vitest.config.ts`:

```ts
coverage: {
  exclude: [
    "src/index.ts",  // module-level env guard throws during collection
    // ...
  ],
}
```

Entry points have no unit-testable logic of their own — they wire up workers and start processes. Excluding them from coverage is correct, not a coverage gap.

Why: In the tech-debt coverage run, `packages/pipeline/src/index.ts` had a module-level `ANTHROPIC_API_KEY` guard that fired during vitest collection, crashing the whole test run. Excluding the file resolved it.

Enforced by: manual review when adding entry-point files to coverage
