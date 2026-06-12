# Newsletter ESLint Rules

`@newsletter/eslint-plugin` hosts project-specific lint rules that enforce architectural invariants and recurring bug patterns that can be detected statically. Rules are scoped via flat-config `files` globs in the root `eslint.config.mjs` — rule implementations never hardcode paths.

## Where to put a new rule

Use this decision tree before writing any new enforcement logic:

1. **Can it be expressed with `no-restricted-imports`?** (forbidding specific imports in specific paths)
   → Add a block to the root `eslint.config.mjs`. No code needed.

2. **Does it need AST matching or type information?**
   → Add a custom rule under `packages/eslint-plugin/src/rules/<name>.ts`. Include a docs page at `docs/rules/<name>.md` and a RuleTester test at `tests/rules/<name>.test.ts`.

## Rule index

| Rule | Description |
|------|-------------|
| [`collector-return-shape`](./collector-return-shape.md) | Exported functions in `packages/pipeline/src/collectors/**` must return `Promise<CollectorResult>` (type-aware). |
| [`enforce-repository-access`](./enforce-repository-access.md) | Value imports of `@newsletter/shared/db` and `drizzle-orm` are only allowed inside repository modules (type-only imports allowed everywhere); inside repositories, queries against tenant-owned tables must carry a tenant scope (`tenantScoped`/`scopedTenantId`/`withAllTenants`). |

## Shipping a new rule

Every new custom rule follows a two-phase promotion workflow to avoid breaking the tree on rollout:

1. **Land at severity `"warn"`.** Wire the rule into `eslint.config.mjs` at `"warn"` in the same PR that adds the rule implementation, tests, and docs page. This is required by REQ-014. Running `pnpm lint` will surface any existing violations without failing CI, giving you a clean list to triage.
2. **Fix the reported violations.** Either fix the code or add targeted `eslint-disable-next-line` comments with a rationale. Do this in follow-up PRs if the violation list is large; each fix PR should be small and reviewable.
3. **Promote to `"error"`.** Once the tree is clean, flip the severity to `"error"` in a dedicated promotion PR. The commit message should link back to the original rule PR and any fix PRs so the audit trail is obvious.

Checklist for a new rule PR:

- [ ] Rule implementation under `packages/eslint-plugin/src/rules/<name>.ts`
- [ ] `meta.type`, `meta.docs.description`, `meta.docs.url`, and `meta.messages` all defined
- [ ] Docs page at `packages/eslint-plugin/docs/rules/<name>.md` describing the rule, rationale, examples, and any escape hatches
- [ ] Rule added to the index above
- [ ] RuleTester test at `packages/eslint-plugin/tests/rules/<name>.test.ts` with at least one `valid` and one `invalid` case
- [ ] Wired into `eslint.config.mjs` with an appropriate `files` glob and severity `"warn"`
- [ ] If the rule codifies an existing entry in `.claude/rules/learnings/`, add a `Enforced by: newsletter/<name>` footer to that learning file

## Related enforcement layers

- **`eslint.config.mjs` `no-restricted-imports` blocks** — declarative boundary rules (pipeline→hono, pipeline→@newsletter/api, web→drizzle-orm, api/routes→@newsletter/shared/db).
