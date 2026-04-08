# Exclude vitest.config.ts from `tsc -b` when vitest's bundled vite differs from the app's

Vitest ships its own pinned `vite` as a transitive dependency. When the workspace also has a different major of `vite` (e.g. the web package on a newer version), `tsc -b` tries to type-check `vitest.config.ts` against both copies and fails with type-mismatch errors on `defineConfig`/plugin types.

Fix: add `vitest.config.ts` (and `vitest.workspace.ts` if present) to the `exclude` array of the package's `tsconfig.json` used by project references. Vitest type-checks its own config at runtime via `vite-node`; `tsc -b` doesn't need to.

```jsonc
{
  "exclude": ["vitest.config.ts", "dist", "node_modules"]
}
```

Why: Hit during the run-ui run — vitest 3.2.1 bundles vite 7 while the web app uses vite 8, and `tsc -b` surfaced the conflict even though runtime worked. Excluding the config file is the minimal fix; bumping vitest or vite to align majors is a heavier change with no functional benefit.
