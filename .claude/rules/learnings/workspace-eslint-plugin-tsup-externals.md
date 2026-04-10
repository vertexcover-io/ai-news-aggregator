# Workspace ESLint plugins must externalize eslint/typescript and be a root devDep

When a custom ESLint plugin lives inside a pnpm workspace and is bundled with tsup, two things must both be true or the root `eslint.config.mjs` will fail to load the plugin with `ERR_MODULE_NOT_FOUND`:

1. The plugin's `tsup.config.ts` must list `eslint`, `typescript`, and `@typescript-eslint/utils` in `external`. Otherwise tsup inlines them into the bundle and the inlined copy is not the same identity as the eslint runtime loading the plugin, so rule types and parser services break at resolve time.
2. The plugin package must be added as a `devDependencies` entry on the workspace **root** `package.json` (e.g. `"@newsletter/eslint-plugin": "workspace:*"`). A flat ESLint config at the root can only resolve plugin imports that are installed as dependencies of the root — being a workspace package alone is not enough.

```ts
// packages/eslint-plugin/tsup.config.ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  external: ["eslint", "typescript", "@typescript-eslint/utils"],
});
```

```jsonc
// package.json (workspace root)
{
  "devDependencies": {
    "@newsletter/eslint-plugin": "workspace:*"
  }
}
```

Why: In the custom-eslint-plugin run, Phase 1 shipped the plugin without externals and without the root devDep. `pnpm lint` failed with `ERR_MODULE_NOT_FOUND` when the root config tried to import the plugin, because (a) the plugin bundle contained a second copy of `@typescript-eslint/utils` that conflicted with the parser loaded by eslint itself, and (b) the root's flat config resolver could not find the package without it being declared as a root devDep. Phase 2 had to add both pieces before lint would run.