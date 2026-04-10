# no-relative-imports

Disallow `../` imports in `api` and `pipeline` packages. Use `@api/` or `@pipeline/` path aliases instead.

## Rule Details

This rule reports any `ImportDeclaration` or re-export whose source specifier starts with `..` in `packages/api/src/**` or `packages/pipeline/src/**`. It auto-fixes the violation by replacing the relative path with the appropriate alias.

Examples of **incorrect** code:

```ts
// packages/api/src/routes/runs.ts
import { validate } from "../lib/validate.js";
export * from "../db/schema.js";
```

Examples of **correct** code:

```ts
// packages/api/src/routes/runs.ts
import { validate } from "@api/lib/validate.js";
export * from "@api/db/schema.js";
import { schema } from "./schema.js"; // same-dir imports are fine
```

## When Not To Use It

This rule is scoped to `packages/api/src/**` and `packages/pipeline/src/**` via `eslint.config.mjs`. It is not enabled for `shared`, `web`, or `eslint-plugin`.
