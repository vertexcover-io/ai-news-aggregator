# `export * from "..."` is ExportAllDeclaration, not ExportNamedDeclaration

When writing ESLint rules that need to cover all `export ... from "..."` forms, you must handle two distinct AST node types:

- `ExportNamedDeclaration` — covers `export { Foo } from "..."` and `export { Foo as Bar } from "..."`
- `ExportAllDeclaration` — covers `export * from "..."` and `export * as ns from "..."`

They do NOT share a single node type. If your rule visitor only registers `ExportNamedDeclaration`, it will silently miss all `export *` re-exports.

```ts
// GOOD: handles both forms
create(context) {
  return {
    ImportDeclaration(node) { checkSource(context, node.source); },
    ExportNamedDeclaration(node) {
      if (node.source) checkSource(context, node.source);
    },
    ExportAllDeclaration(node) { checkSource(context, node.source); },
  };
}
```

**Before writing a rule that touches import/export sources, verify the AST shape at astexplorer.net** — set the parser to `@typescript-eslint/parser` and paste the exact syntax you need to handle.

Why: In the no-relative-imports run, the SPEC said "any `ExportNamedDeclaration` with a source" as the example for `export * from "../db/schema.js"` — but that construct parses as `ExportAllDeclaration`. The coder caught this during implementation. Any future rule SPEC or implementation that mentions `export * from` must explicitly include `ExportAllDeclaration` in the visitor.
