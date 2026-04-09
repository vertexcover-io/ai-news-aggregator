# @newsletter/eslint-plugin

Custom ESLint rules enforcing project conventions for the AI Newsletter Aggregator monorepo. Rules codify architectural invariants and recurring bug patterns documented under `.claude/rules/learnings/` — package boundaries, the repository pattern, dotenv bootstrap, bundled-asset traps, and more.

## Rules

See [`docs/rules/README.md`](./docs/rules/README.md) for the full rule index, per-rule documentation pages, and the decision tree for where new enforcement logic should live (flat-config `no-restricted-imports` vs. custom AST rule vs. `tools/check-repo-invariants.ts`).

Current rules:

- `collector-return-shape` — pipeline collectors must return `Promise<CollectorResult>`
- `dotenv-bootstrap` — package entrypoints must load the root `.env` first
- `enforce-repository-access` — value imports of `@newsletter/shared/db` and `drizzle-orm` are only allowed inside repository modules
- `no-bundled-readfilesync` — no `readFileSync` calls that resolve via `import.meta.url` or `__dirname`
- `no-raw-alter-table` — no raw `ALTER TABLE` via `.execute()`; use Drizzle Kit migrations

## Usage

The plugin is consumed by the root `eslint.config.mjs` (flat config) as `newsletter/*`. File-scoping is done via flat-config `files` globs in that config, not inside rule implementations.

```js
import newsletter from "@newsletter/eslint-plugin";

export default [
  {
    files: ["packages/pipeline/src/collectors/**/*.ts"],
    plugins: { newsletter },
    rules: {
      "newsletter/collector-return-shape": "error",
    },
  },
];
```

## Adding a new rule

Follow the checklist and two-phase promotion workflow (`warn` → fix violations → `error`) documented in [`docs/rules/README.md`](./docs/rules/README.md#shipping-a-new-rule).

## Commands

```bash
pnpm build        # Build with tsup
pnpm typecheck    # Type check
pnpm test:unit    # Run RuleTester tests (vitest)
pnpm lint         # Lint the plugin source itself
```
