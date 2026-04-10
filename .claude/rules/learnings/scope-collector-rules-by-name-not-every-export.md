# Scope "collector/processor" lint rules by function name, not by "all exported functions"

When writing an ESLint rule that enforces a return-shape or signature convention on "every collector" or "every processor" in a directory, do NOT target every exported function in the glob. Collector/processor files routinely export helper functions for tests (URL parsers, HTML cleaners, engagement computers) that share the file but are not themselves collectors and should not be held to the collector contract.

Use a name-based selector instead — the convention in this repo is `collect*` for collector entry functions:

```ts
// good — only matches `export function collectHackerNews(...)`, `collectReddit(...)`
ExportNamedDeclaration: (node) => {
  const decl = node.declaration;
  if (decl?.type !== "FunctionDeclaration") return;
  if (!decl.id?.name.startsWith("collect")) return;
  checkReturnShape(decl);
};
```

```ts
// bad — also matches `export function parseRedditUrl(...)`, `export function extractText(...)`
ExportNamedDeclaration: (node) => {
  if (node.declaration?.type === "FunctionDeclaration") {
    checkReturnShape(node.declaration);
  }
};
```

Why: In the custom-eslint-plugin run, the SPEC for `collector-return-shape` said "all exported functions in `packages/pipeline/src/collectors/**`". The `web.ts` collector legitimately exports 10 helper functions used by its unit tests. A literal reading of the SPEC would have flagged every one of them as violating the collector return shape. Phase 6 fixed this by narrowing the selector to functions whose name starts with `collect`. Any future rule that enforces a "role" contract (collector, processor, step) should pick a naming convention and match on it — otherwise test-exported helpers will generate noise and push developers to either suppress the rule or inline helpers back into private scope.