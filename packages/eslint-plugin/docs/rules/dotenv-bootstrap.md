# `newsletter/dotenv-bootstrap`

Package entrypoints must load the root `.env` before any other code runs.

## Rationale

Every runnable package (`api`, `pipeline`, any future service) is its own Node
process. `pnpm dev` at the root does not inject dotenv into spawned children,
so each package entrypoint is responsible for loading `../../.env` explicitly,
before any other import that might read `process.env`.

A package that "works" without this bootstrap is only working because the
missing env var happens to not be read yet. The bug is latent until a
lazily-initialized code path first runs (e.g., the first DB call against
`DATABASE_URL`), which typically surfaces in production long after the code
was shipped.

See the recurring-pattern learning:
[`always-load-dotenv-in-package-entrypoint.md`](../../../../.claude/rules/learnings/always-load-dotenv-in-package-entrypoint.md)

This rule enforces that every `packages/*/src/index.ts` starts with the exact
two-line bootstrap below.

## Required snippet

```ts
import { config } from "dotenv";
config({ path: "../../.env" });

// ...rest of imports
```

## Examples

### Valid

```ts
import { config } from "dotenv";
config({ path: "../../.env" });

import { Hono } from "hono";

const app = new Hono();
```

### Invalid

First statement is a different import:

```ts
import { Hono } from "hono";
import { config } from "dotenv";
config({ path: "../../.env" });
// => missingBootstrap
```

Dotenv import present but second statement is not the `config` call:

```ts
import { config } from "dotenv";
const x = 1;
// => missingBootstrap
```

`config(...)` called with the wrong path:

```ts
import { config } from "dotenv";
config({ path: "./.env" });
// => wrongPath
```

CommonJS `require` instead of ESM `import`:

```ts
const { config } = require("dotenv");
config({ path: "../../.env" });
// => missingBootstrap
```

`config()` called with no arguments:

```ts
import { config } from "dotenv";
config();
// => wrongPath
```

## When to disable

Disable (via `/* eslint-disable-next-line newsletter/dotenv-bootstrap */`) only
for files scoped by `files: ["packages/*/src/index.ts"]` that genuinely should
not load env vars — e.g., a package that is a pure library with no runtime
behavior. In practice, every runnable service entrypoint must keep this rule
enabled.
