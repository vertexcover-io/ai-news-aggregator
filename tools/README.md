# tools/

Repo-wide scripts that run outside of any single package. Currently this directory hosts the non-AST invariant checker that complements the custom ESLint plugin.

## `check-repo-invariants.ts`

Entry point script run by `pnpm check:invariants` (and chained into `pnpm lint`). It validates file-shape and configuration rules that can't reasonably be expressed as ESLint rules because they operate on `package.json`, `tsconfig.json`, or arbitrary text files rather than parsed TypeScript ASTs.

The script composes independent checks from `tools/invariants/` via `runAllInvariants()` and exits non-zero if any check reports violations. Each violation includes the invariant name, file path, optional line number, and a human-readable message.

### Current checks

| Check | File | Purpose |
|-------|------|---------|
| `package-json-pinning` | `invariants/package-json-pinning.ts` | All runtime and dev dependencies across workspace `package.json` files must use exact versions (no `^`/`~`/ranges). |
| `ai-sdk-alignment` | `invariants/ai-sdk-alignment.ts` | All `@ai-sdk/*` provider packages must share the same major version so they stay mutually compatible. |
| `vitest-config-excluded` | `invariants/vitest-config-excluded.ts` | Any package with a `vitest.config.ts` must list it in its `tsconfig.json` `exclude` array so `tsc -b` doesn't type-check it against the wrong bundled `vite`. |
| `no-docker-references` | `invariants/no-docker-references.ts` | Docs and configs must use `podman`/`podman-compose`, not `docker`/`docker-compose`. Allowlisted via `<!-- invariants:allow docker -->` markers in files that legitimately need to discuss docker. |

### When to add a check here vs. ESLint

Use the decision tree in [`packages/eslint-plugin/docs/rules/README.md`](../packages/eslint-plugin/docs/rules/README.md#where-to-put-a-new-rule):

- **Source-code AST / type-information checks** → custom ESLint rule under `packages/eslint-plugin/`
- **Import-boundary declarative rules** → `no-restricted-imports` in the root `eslint.config.mjs`
- **File shape, package.json, env, directory structure** → add a check here

### Adding a new check

1. Create `tools/invariants/<name>.ts` exporting a function with signature `(context: InvariantContext) => InvariantResult`. The context provides `cwd`; use helpers in `fs-utils.ts` for file discovery.
2. Return `{ violations: Violation[] }`. Each `Violation` has `invariant`, `file`, optional `line`, and `message`. Shared types live in `invariants/types.ts`.
3. Register the check in `invariants/index.ts` by importing it and spreading its violations into the `runAllInvariants` return value.
4. Add unit tests under `tools/tests/<name>.test.ts` using fixture directories under `tools/tests/fixtures/<name>-good` and `<name>-bad`. Follow the existing patterns — tests should cover at least one passing and one failing fixture.
5. Update the table above and, if the check enforces a `.claude/rules/learnings/` entry, add an `Enforced by: tools/check-repo-invariants.ts (<name>)` footer to that learning file.

### Commands

```bash
pnpm check:invariants   # Run the full invariant suite
pnpm test:tools         # Run tools/ unit tests (vitest, config at tools/vitest.config.ts)
```
<!-- invariants:allow docker -->
