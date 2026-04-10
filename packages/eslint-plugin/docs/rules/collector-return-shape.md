# `newsletter/collector-return-shape`

Require every exported **collector function** declared under `packages/pipeline/src/collectors/**` to return a type assignable to `Promise<CollectorResult>`.

A "collector function" is an exported function whose identifier starts with `collect` (e.g. `collectHn`, `collectReddit`, `collectWeb`). Other exported helpers in collector files (e.g. `buildRawItem`, `parseDateOrNull`, `processSource`) are out of scope — they support the collector but are not the entry point the run worker invokes.

This is the first **type-aware** rule in the plugin. It uses
`ESLintUtils.getParserServices(context)` and the TypeScript type checker to
inspect the resolved return type of each exported function — including type
aliases and subtype relationships.

## Rationale

Collectors are the entry points the `run-process` worker calls. The worker
relies on every collector function returning a `CollectorResult` (with
`itemsFetched` and `errors`) so it can aggregate results across sources. A
collector that drifts to `Promise<void>` or `Promise<{ items: number }>` will
silently break the run loop's accounting.

This rule pins the contract at lint time so the drift is impossible.

## Examples

### Valid

Direct return type:

```ts
import type { CollectorResult } from "@newsletter/shared/types";

export async function collectX(): Promise<CollectorResult> {
  return { itemsFetched: 0, errors: 0 };
}
```

Arrow function form:

```ts
export const collectX = async (): Promise<CollectorResult> => ({
  itemsFetched: 0,
  errors: 0,
});
```

Type alias resolving to `CollectorResult` (EDGE-005):

```ts
type MyAlias = CollectorResult;
export async function collectX(): Promise<MyAlias> {
  return { itemsFetched: 0, errors: 0 };
}
```

Subtype that `extends CollectorResult` (e.g. `WebCollectorResult`):

```ts
interface ExtendedResult extends CollectorResult {
  failures?: string[];
}
export async function collectX(): Promise<ExtendedResult> {
  return { itemsFetched: 0, errors: 0 };
}
```

Non-exported helpers are out of scope:

```ts
async function helper(): Promise<number> { return 1; }
```

Exported helpers whose name does not start with `collect` are also out of scope:

```ts
export function buildRawItem(): { id: number } { return { id: 1 }; }
export async function fetchMarkdown(): Promise<string> { return "x"; }
```

### Invalid

```ts
export async function collectX(): Promise<{ items: number }> {
  return { items: 0 };
}
// => wrongReturnType
```

```ts
export async function collectX(): Promise<void> {}
// => wrongReturnType
```

```ts
export function collectX(): CollectorResult {
  return { itemsFetched: 0, errors: 0 };
}
// => wrongReturnType (must be wrapped in Promise)
```

## How the rule resolves the type

1. Bail out immediately if the file ends in `.d.ts` (EDGE-012) — there is no
   executable code to validate.
2. Match only exported function/arrow declarations whose identifier starts
   with `collect` (e.g. `collectHn`). Other exports are skipped.
3. Get the function's TypeScript type via `services.getTypeAtLocation`.
4. Read the first call signature; skip if there is none.
5. Resolve the return type via `checker.getReturnTypeOfSignature`.
6. Verify the return type's symbol name is `Promise` and read its type
   argument.
7. Accept the inner type if **any** of the following are true:
   - Its `symbol.name` is `CollectorResult`
   - Its `aliasSymbol.name` is `CollectorResult` (handles `type Foo = CollectorResult`)
   - Any of its base types (recursively) satisfies the same check (handles
     `interface WebCollectorResult extends CollectorResult`)

## Limitations

- **Name-based scoping.** The rule only inspects exports whose name starts
  with `collect`. A collector entry point that violates this convention would
  silently bypass the rule. Keep the convention.
- **Name-based type resolution.** The rule matches the return type by name
  (`CollectorResult`) rather than running full structural assignability via
  `checker.isTypeAssignableTo`. This is fast and works for the
  collector convention but means a structurally identical type with a
  different name would not be accepted.
- **First call signature only.** Functions with overloads are checked against
  their first signature.

## Scope

Wired in the root `eslint.config.mjs` for:
- `packages/pipeline/src/collectors/**/*.ts`

## RuleTester setup

Type-aware rules require `parserOptions.projectService` so the parser exposes
TypeScript services. The test file uses:

```ts
new RuleTester({
  languageOptions: {
    parserOptions: {
      projectService: {
        allowDefaultProject: ["*.ts"],
        defaultProject: "tsconfig.json",
      },
      tsconfigRootDir: path.resolve(__dirname, "../fixtures"),
    },
  },
});
```

The fixtures directory contains a minimal `tsconfig.json` that enables
`strict` mode under `Bundler` module resolution.
