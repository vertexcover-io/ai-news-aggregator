# Use `context.filename` not `context.getFilename()` in ESLint v10 rules

`context.getFilename()` is deprecated in ESLint v10. Use the `context.filename` property directly.

```ts
// DEPRECATED — works but triggers deprecation warning in ESLint v10
const filename = context.getFilename();

// CORRECT — ESLint v10+ property access
const filename = context.filename;
```

All custom rules in `@newsletter/eslint-plugin` that need the current file path should use `context.filename`.

Why: In the no-relative-imports run, the coder caught this at implementation time when writing the alias resolution logic. The project uses ESLint v10 (`"eslint": "10.1.0"` in root package.json). Using the deprecated API still works today but will break in a future ESLint major — use the property form consistently.
