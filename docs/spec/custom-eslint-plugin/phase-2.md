# Phase 2: Layer 1 boundary rules + `newsletter/dotenv-bootstrap`

> **Status:** pending

## Overview

Land the first enforcement layer: declarative `no-restricted-imports` blocks for cross-package boundaries, plus the first custom rule `newsletter/dotenv-bootstrap`. This is the proof-of-plumbing phase — after this, we know the plugin can ship real rules, the root config can consume them, and RuleTester is wired correctly.

## Implementation

**Files to create:**
- `packages/eslint-plugin/src/rules/dotenv-bootstrap.ts`
- `packages/eslint-plugin/tests/rules/dotenv-bootstrap.test.ts`
- `packages/eslint-plugin/docs/rules/dotenv-bootstrap.md`

**Files to modify:**
- `packages/eslint-plugin/src/index.ts` — register `dotenv-bootstrap` in the `rules` record
- `eslint.config.mjs` (root) — add:
  - `no-restricted-imports` blocks for pipeline, web, and api routes (Layer 1)
  - `newsletter/dotenv-bootstrap` at `"warn"` scoped to package entrypoints
- `packages/eslint-plugin/docs/rules/README.md` — add `dotenv-bootstrap` to the rule index

### Layer 1: `no-restricted-imports` in root `eslint.config.mjs`

Add these three override blocks after the existing base config:

```js
// Pipeline: no HTTP framework, no API import
{
  files: ["packages/pipeline/src/**/*.ts"],
  rules: {
    "no-restricted-imports": ["warn", {
      patterns: [
        { group: ["hono", "hono/*"], message: "Pipeline package must not import HTTP frameworks." },
        { group: ["express", "fastify"], message: "Pipeline package must not import HTTP frameworks." },
      ],
      paths: [
        { name: "@newsletter/api", message: "Pipeline cannot depend on @newsletter/api." },
      ],
    }],
  },
},
// Web: no direct DB access
{
  files: ["packages/web/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-imports": ["warn", {
      paths: [
        { name: "drizzle-orm", message: "Web package must not import drizzle-orm." },
        { name: "@newsletter/shared/db", message: "Web package must not import the DB layer." },
      ],
      patterns: [
        { group: ["@newsletter/shared/db/*"], message: "Web package must not import the DB layer." },
      ],
    }],
  },
},
// API routes: no direct DB access — must go through services → repositories
{
  files: ["packages/api/src/routes/**/*.ts"],
  rules: {
    "no-restricted-imports": ["warn", {
      paths: [
        { name: "drizzle-orm", message: "Route handlers must delegate DB access to services/repositories." },
        { name: "@newsletter/shared/db", message: "Route handlers must delegate DB access to services/repositories." },
      ],
    }],
  },
},
```

### `newsletter/dotenv-bootstrap` rule

**Logic:** Report on the `Program` node if the first two top-level statements are not:
1. `import { config } from "dotenv";`
2. `config({ path: "../../.env" });`

**Selector:** `Program` (whole file)

**Implementation sketch:**
```ts
import { createRule } from "../utils/create-rule.js";
import type { TSESTree } from "@typescript-eslint/utils";

export default createRule({
  name: "dotenv-bootstrap",
  meta: {
    type: "problem",
    docs: {
      description: "Package entrypoints must load the root .env before any other code runs.",
    },
    messages: {
      missingBootstrap:
        "Package entrypoint must start with `import { config } from \"dotenv\"; config({ path: \"../../.env\" });` before any other imports.",
      wrongPath:
        "`config(...)` must be called with `{ path: \"../../.env\" }` as the only option.",
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    return {
      Program(node: TSESTree.Program) {
        const [first, second] = node.body;
        // Check 1: first statement is `import { config } from "dotenv"`
        const isDotenvImport =
          first?.type === "ImportDeclaration" &&
          first.source.value === "dotenv" &&
          first.specifiers.some(
            (s) =>
              s.type === "ImportSpecifier" &&
              s.imported.type === "Identifier" &&
              s.imported.name === "config",
          );
        if (!isDotenvImport) {
          context.report({ node, messageId: "missingBootstrap" });
          return;
        }
        // Check 2: second statement is `config({ path: "../../.env" })`
        const isConfigCall =
          second?.type === "ExpressionStatement" &&
          second.expression.type === "CallExpression" &&
          second.expression.callee.type === "Identifier" &&
          second.expression.callee.name === "config";
        if (!isConfigCall) {
          context.report({ node, messageId: "missingBootstrap" });
          return;
        }
        // Verify the path option literal
        const arg = second.expression.arguments[0];
        if (
          arg?.type !== "ObjectExpression" ||
          !arg.properties.some(
            (p) =>
              p.type === "Property" &&
              p.key.type === "Identifier" &&
              p.key.name === "path" &&
              p.value.type === "Literal" &&
              p.value.value === "../../.env",
          )
        ) {
          context.report({ node, messageId: "wrongPath" });
        }
      },
    };
  },
});
```

**Scope in root `eslint.config.mjs`:**
```js
{
  files: ["packages/*/src/index.ts"],
  plugins: { newsletter },
  rules: { "newsletter/dotenv-bootstrap": "warn" },
},
```

### `dotenv-bootstrap.md` docs page

Document the rule with: rationale (link to `.claude/rules/learnings/always-load-dotenv-in-package-entrypoint.md`), the required snippet, valid/invalid examples, and "when to disable" guidance.

## What to test (RuleTester)

**Valid cases:**
- File beginning with the exact two-line bootstrap + other imports after
- File beginning with the bootstrap using `config({ path: "../../.env" })` (no extra options)

**Invalid cases:**
- File whose first statement is a different import → `missingBootstrap`
- File with `import { config } from "dotenv"` but second statement is `const x = 1;` → `missingBootstrap`
- File with `import { config } from "dotenv"; config({ path: "./.env" });` → `wrongPath`
- CommonJS `const { config } = require("dotenv")` as first statement → `missingBootstrap` (EDGE-001)
- File with `config()` called with no args → `wrongPath`

Use `RuleTester` from `@typescript-eslint/rule-tester` with minimal `languageOptions` (no parserServices needed — this is a syntactic rule).

**Traces to:** REQ-014, REQ-020, REQ-021, REQ-022, REQ-023, REQ-030, REQ-031, REQ-032, EDGE-001, EDGE-002

**Commit:** `feat(VER): add layer 1 boundary rules + newsletter/dotenv-bootstrap`

## Done When

- [ ] `pnpm --filter @newsletter/eslint-plugin test:unit` passes the new rule suite
- [ ] Meta walker (from Phase 1) now confirms `dotenv-bootstrap` has docs URL + docs file + messages
- [ ] `pnpm lint` at root runs clean — zero new warnings (api + pipeline entrypoints already have the bootstrap)
- [ ] `pnpm typecheck`, `pnpm test:unit` still pass monorepo-wide
- [ ] Adding a temporary hono import to a pipeline file demonstrates the `no-restricted-imports` warning fires; revert before commit
