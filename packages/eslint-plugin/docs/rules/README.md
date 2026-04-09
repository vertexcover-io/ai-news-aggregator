# Newsletter ESLint Rules

## Where to put a new rule

1. **Can it be expressed with `no-restricted-imports`?** (forbidding specific imports in specific paths)
   → Add a block to the root `eslint.config.mjs`. No code needed.

2. **Does it need AST matching or type information?**
   → Add a custom rule under `packages/eslint-plugin/src/rules/<name>.ts`. Include a docs page at `docs/rules/<name>.md` and a RuleTester test at `tests/rules/<name>.test.ts`.

3. **Is it a file-shape / package.json / env / directory structure check?** (not source code)
   → Add a check to `tools/check-repo-invariants.ts`. Not an ESLint rule.

## Rule index

| Rule | Description |
|------|-------------|
| [`dotenv-bootstrap`](./dotenv-bootstrap.md) | Package entrypoints must load the root `.env` before any other code runs. |
