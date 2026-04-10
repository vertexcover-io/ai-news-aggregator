# `newsletter/no-bundled-readfilesync`

Disallow `readFileSync` calls that resolve their path via `new URL(..., import.meta.url)`, `fileURLToPath`, or `__dirname`. These break after tsup (or any bundler) rewrites the source layout.

## Rationale

When a Node package is built with tsup, `readFileSync` calls that resolve
paths via `import.meta.url` or `__dirname` break at runtime — the bundler
rewrites the source layout, so the asset file is no longer where the resolved
path points. The code works in dev (tsx) and fails in the built artifact.

For any non-code asset that needs to ship with a bundled Node package
(prompts, templates, SQL strings, fixtures), convert it to a `.ts` file that
exports the content as a `const` string. The bundler then inlines it into the
output and there's no filesystem lookup at runtime.

See the recurring-pattern learning:
[`bundled-assets-need-import-not-readfilesync.md`](../../../../.claude/rules/learnings/bundled-assets-need-import-not-readfilesync.md)

## Examples

### Valid

Literal path arguments are fine — the bundler doesn't rewrite them:

```ts
import { readFileSync } from "node:fs";
const x = readFileSync("./static-path.txt");
```

Variable arguments are out of scope (the rule does not track values):

```ts
function load(p: string) {
  return fs.readFileSync(p, "utf8");
}
```

### Invalid

`readFileSync` with `new URL(..., import.meta.url)`:

```ts
import { readFileSync } from "node:fs";
const x = readFileSync(new URL("./prompt.md", import.meta.url), "utf8");
// => bundledUrlRead
```

Wrapped in `fileURLToPath`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const x = readFileSync(
  fileURLToPath(new URL("./prompt.md", import.meta.url)),
  "utf8",
);
// => bundledUrlRead
```

Member-call shape (`fs.readFileSync`):

```ts
import * as fs from "node:fs";
const x = fs.readFileSync(new URL("./x", import.meta.url));
// => bundledUrlRead
```

`path.join(__dirname, ...)`:

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
const x = readFileSync(path.join(__dirname, "file.txt"), "utf8");
// => bundledDirnameRead
```

## How to fix

Convert the asset into a TypeScript module that exports the content as a
constant string:

```ts
// prompt.ts
export const PROMPT = `...inlined content...`;

// caller.ts
import { PROMPT } from "./prompt.js";
```

The bundler then inlines `PROMPT` into the output and there is no filesystem
lookup at runtime.

## Limitations

- **No alias tracking.** The rule matches the literal identifier
  `readFileSync` (or `.readFileSync` member access). Aliased imports such as
  `import { readFileSync as rfs } from "node:fs"; rfs(new URL(...))` are
  **not** detected. Tracking renamed bindings would require scope analysis
  and is intentionally out of scope for v1.
- **No value tracking for the path argument.** Only syntactic shapes that
  contain `import.meta.url`, `fileURLToPath(...)`, `new URL(...)`, or a
  literal `__dirname` reference are flagged. A path stored in a variable
  first (`const p = new URL(...); readFileSync(p)`) is not detected.

## Scope

Wired in the root `eslint.config.mjs` for:
- `packages/pipeline/src/**/*.ts`
- `packages/api/src/**/*.ts`

## When to disable

Disable per-line (`/* eslint-disable-next-line newsletter/no-bundled-readfilesync */`)
only when the file is intentionally **not** bundled by tsup (e.g., a raw
script run via `tsx`). For all bundled package source, the rule must stay
enabled.
