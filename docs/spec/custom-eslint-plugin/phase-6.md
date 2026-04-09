# Phase 6: `newsletter/collector-return-shape` (type-aware)

> **Status:** pending

## Overview

Ship the first type-aware custom rule. Uses `ESLintUtils.getParserServices(context)` and the TypeScript type checker to verify every exported function under `packages/pipeline/src/collectors/**` returns a type assignable to `Promise<CollectorResult>`. This validates that the plugin's type-aware infrastructure works — all future rules that need type information follow the same pattern.

## Implementation

**Files to create:**
- `packages/eslint-plugin/src/rules/collector-return-shape.ts`
- `packages/eslint-plugin/tests/rules/collector-return-shape.test.ts`
- `packages/eslint-plugin/tests/fixtures/tsconfig.json` — minimal tsconfig for the RuleTester type-aware setup
- `packages/eslint-plugin/tests/fixtures/collector-valid.ts` — fixture with the correct return type
- `packages/eslint-plugin/tests/fixtures/collector-invalid.ts` — fixture with a wrong return type
- `packages/eslint-plugin/tests/fixtures/types.ts` — local stubs for `CollectorResult` and related types so the fixtures don't need the real `@newsletter/shared` package
- `packages/eslint-plugin/docs/rules/collector-return-shape.md`

**Files to modify:**
- `packages/eslint-plugin/src/index.ts` — register the rule
- `eslint.config.mjs` (root) — wire at `"warn"` scoped to `packages/pipeline/src/collectors/**`
- `packages/eslint-plugin/docs/rules/README.md` — add to index

### Rule logic

**Selector:** `ExportNamedDeclaration > FunctionDeclaration` and `ExportNamedDeclaration > VariableDeclaration > VariableDeclarator[init.type="ArrowFunctionExpression"]`.

For each exported function:
1. Use `ESLintUtils.getParserServices(context)` to get parser services.
2. Use `services.getTypeAtLocation(functionNode)` to get the function type.
3. Get the call signatures and extract the return type.
4. Check that the return type is assignable to `Promise<CollectorResult>` — in practice: return type is a `Promise<T>` where `T` is a type named `CollectorResult` (or an alias resolving to it).

**Simplified check (v1):** rather than use full type assignability (which is expensive), use a name-based check on the resolved return type:
- Unwrap `Promise<T>` to get `T`
- Ask the checker for `T.symbol.name` (or equivalent)
- Accept if the name is `CollectorResult`, or if the type's aliasSymbol resolves to `CollectorResult`

This is good enough for v1 — collectors either return `Promise<CollectorResult>` literally or via an alias. Edge case EDGE-005 (type alias) works because `getTypeAtLocation` resolves aliases.

**Bail out early (EDGE-012):** if `context.filename.endsWith(".d.ts")`, return without running.

**Skeleton:**
```ts
import { ESLintUtils, type TSESTree } from "@typescript-eslint/utils";
import * as ts from "typescript";
import { createRule } from "../utils/create-rule.js";

export default createRule({
  name: "collector-return-shape",
  meta: {
    type: "problem",
    docs: {
      description: "Collector functions must return Promise<CollectorResult>.",
      requiresTypeChecking: true,
    },
    messages: {
      wrongReturnType:
        "Collector `{{name}}` must return `Promise<CollectorResult>`, found `{{actual}}`.",
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    if (context.filename.endsWith(".d.ts")) return {};
    const services = ESLintUtils.getParserServices(context);
    const checker = services.program.getTypeChecker();

    const checkFunction = (
      fnNode: TSESTree.FunctionDeclaration | TSESTree.ArrowFunctionExpression,
      name: string,
    ) => {
      const type = services.getTypeAtLocation(fnNode);
      const signature = type.getCallSignatures()[0];
      if (!signature) return;
      const returnType = checker.getReturnTypeOfSignature(signature);
      // Expect Promise<CollectorResult>
      const typeArgs = (returnType as ts.TypeReference).typeArguments;
      const isPromise = returnType.symbol?.name === "Promise";
      if (!isPromise || !typeArgs || typeArgs.length === 0) {
        context.report({
          node: fnNode,
          messageId: "wrongReturnType",
          data: { name, actual: checker.typeToString(returnType) },
        });
        return;
      }
      const inner = typeArgs[0];
      const innerName = inner.aliasSymbol?.name ?? inner.symbol?.name;
      if (innerName !== "CollectorResult") {
        context.report({
          node: fnNode,
          messageId: "wrongReturnType",
          data: { name, actual: checker.typeToString(returnType) },
        });
      }
    };

    return {
      "ExportNamedDeclaration > FunctionDeclaration"(node: TSESTree.FunctionDeclaration) {
        if (node.id) checkFunction(node, node.id.name);
      },
      "ExportNamedDeclaration > VariableDeclaration > VariableDeclarator"(
        node: TSESTree.VariableDeclarator,
      ) {
        if (
          node.init?.type === "ArrowFunctionExpression" &&
          node.id.type === "Identifier"
        ) {
          checkFunction(node.init, node.id.name);
        }
      },
    };
  },
});
```

### RuleTester type-aware setup

The key learning for this phase is that `RuleTester` needs `parserOptions.projectService: true` (or an explicit `project` array) to give type-aware rules access to `parserServices`. Example setup:

```ts
import { RuleTester } from "@typescript-eslint/rule-tester";
import * as path from "path";

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: {
      projectService: {
        allowDefaultProject: ["*.ts"],
      },
      tsconfigRootDir: path.resolve(__dirname, "../fixtures"),
    },
  },
});
```

The fixture tsconfig is minimal:
```jsonc
// packages/eslint-plugin/tests/fixtures/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["**/*.ts"]
}
```

`fixtures/types.ts`:
```ts
export interface CollectorResult {
  itemsFetched: number;
  errors: number;
}
```

## What to test (RuleTester)

**Valid:**
- `export async function collectX(): Promise<CollectorResult> { ... }`
- `export const collectX = async (): Promise<CollectorResult> => { ... }`
- `type MyAlias = CollectorResult; export async function collectX(): Promise<MyAlias> { ... }` (EDGE-005 — alias)
- A non-exported function in the same file with a wrong return type (rule only flags exported functions)

**Invalid:**
- `export async function collectX(): Promise<{ items: number }> { ... }` → `wrongReturnType`
- `export async function collectX(): Promise<void> { ... }` → `wrongReturnType`
- `export async function collectX() { return 42; }` (inferred Promise<number>) → `wrongReturnType`
- `export function collectX(): CollectorResult { ... }` (not wrapped in Promise) → `wrongReturnType`

**Traces to:** REQ-060, REQ-061, REQ-062, EDGE-005, EDGE-012, EDGE-015

**Commit:** `feat(VER): add newsletter/collector-return-shape type-aware rule`

## Done When

- [ ] Rule + tests + docs + fixtures exist
- [ ] Type-aware RuleTester setup works — no "parserServices not found" errors
- [ ] `pnpm --filter @newsletter/eslint-plugin test:unit` passes the new suite
- [ ] Meta walker confirms the rule has docs URL + docs file + messages
- [ ] `pnpm lint` at root runs clean — all existing collectors (`hn.ts`, `reddit.ts`, `web.ts`) already return `Promise<CollectorResult>` so zero new warnings
- [ ] `pnpm typecheck`, `pnpm test:unit` still pass monorepo-wide
