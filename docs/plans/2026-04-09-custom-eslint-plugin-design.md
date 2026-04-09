# Custom ESLint Plugin — `@newsletter/eslint-plugin`

**Date:** 2026-04-09
**Status:** Design — not yet implemented
**Related:** `.claude/rules/` (all files), `.claude/rules/learnings/` (all files), `eslint.config.mjs`

## Problem Statement

Project-specific rules live in `.claude/rules/` and `.claude/rules/learnings/` as
markdown. Agents (and humans) can and do ignore them. Several recurring issues —
`DATABASE_URL` crash from missing dotenv bootstrap, `readFileSync` breaking after
tsup bundling, AI SDK major-version drift, cross-package imports, direct DB access
from route handlers — have all either shipped once or been caught late in review.

Markdown rules are necessary (they explain *why*), but they aren't executable.
We need a second layer: machine-enforced checks that fail the build when a known
trap is hit, so the feedback loop runs during coding, not during review.

## Context

- Monorepo: `pnpm` + Turborepo, packages `shared`, `api`, `pipeline`, `web`.
- Existing linting: ESLint 9 flat config (`eslint.config.mjs`) with
  `@typescript-eslint/strictTypeChecked` and `stylisticTypeChecked`. Parser services
  are already wired for type-aware rules — no extra setup cost.
- Pre-commit: Husky + lint-staged runs lint + typecheck on staged files.
- Known violations, paraphrased from `.claude/rules/learnings/`:
  - Missing dotenv bootstrap at package entrypoint → latent runtime crash.
  - `readFileSync(new URL(...))` for bundled assets → breaks under tsup.
  - Loose `^5.0.0` on `ai` / `@ai-sdk/*` → silent major bump.
  - `vitest.config.ts` type-checked by `tsc -b` → vite version conflict.
  - Not-yet-formalized but equally important: direct Drizzle access bypassing
    `repositories/` (the user's call-out for v1), HTTP frameworks creeping into
    `pipeline`, raw `ALTER TABLE` via `db.execute`, thick route handlers.

## Requirements

### Functional

1. A local workspace package exports an ESLint plugin consumable from
   `eslint.config.mjs`.
2. Rules run as part of `pnpm lint` (Turborepo task) and via lint-staged on
   pre-commit — no separate invocation.
3. Each rule has: `meta.docs.url` pointing at an in-repo markdown doc, clear error
   messages, unit tests using `@typescript-eslint/rule-tester`, and a severity that
   starts at `"warn"` and is promoted to `"error"` after a sprint without false
   positives.
4. Rules are path-scoped via flat-config overrides — `pipeline` rules only run on
   `packages/pipeline/**`, etc. Rule code never hardcodes package paths.
5. New rule additions follow a PR workflow: agents propose (rule code + tests +
   docs), humans review and merge. The `/extract-learnings` skill is updated so
   that when a learning is captured it also drafts a rule stub in this plugin.

### Non-functional

- **Type-aware where needed**, AST-only where sufficient. Reuse the existing
  `projectService: true` config; no extra TypeScript program spin-up.
- **Fast**. Rules are local, small, and scoped — lint wall time should not
  noticeably increase. Benchmark before/after on each rule.
- **Low false-positive rate.** A rule that cries wolf is worse than no rule. Every
  new rule ships at `warn` first, and is promoted to `error` only after real use.
- **Discoverable.** Each rule has a one-page doc under
  `packages/eslint-plugin/docs/rules/<name>.md` explaining the why (with a link to
  the originating learning), the good/bad examples, and how to disable it if it's
  wrong.
- **Testable.** `RuleTester` fixtures live next to the rule. Every rule has both
  `valid` and `invalid` cases before merge.

### Edge cases

- **Generated code / migrations.** Drizzle-generated migration SQL and any
  `dist/` output must be globbed out — already handled by the top-level
  `ignores`, but each new rule must not assume source layout.
- **Test files.** Test files have relaxed typing rules today. Lint rules must not
  re-apply the strict repository pattern to tests that legitimately touch the DB
  directly for setup.
- **Dev scripts.** `packages/*/src/scripts/**` and demo files may legitimately
  break rules (e.g. a one-off debug script reading a local fixture). Either scope
  the rules away from `scripts/**` or require an explicit `// eslint-disable-next-line`
  with a rationale comment.
- **Worktrees.** `.worktrees/` already ignored. Confirm.
- **Third-party code inside `packages/web/`** (Vite-specific patterns) needs its
  own scope — don't force Node conventions onto React code.

## Key Insights

1. **Off-the-shelf beats custom.** For cross-package import restrictions and "no
   Hono in pipeline" type rules, ESLint core's `no-restricted-imports` and
   `eslint-plugin-boundaries` already handle the job declaratively. The custom
   plugin should cover only what those cannot express.
2. **Not every rule belongs in ESLint.** `package.json` version pinning and
   "`vitest.config.ts` excluded from `tsc -b`" are file-shape checks, not AST
   checks. A small `tools/check-repo-invariants.ts` script running in Turborepo
   alongside lint fits those better.
3. **The repository pattern is the highest-leverage rule.** It subsumes several
   smaller concerns (thin route handlers, no DB in workers, no drizzle in web) by
   forcing all DB access through a single layer.
4. **Warn first, error later.** Promotion from `warn` → `error` is the single
   biggest protection against false-positive backlash.

## Architectural Challenges

### C1. Plugin package location and layout

Options:
- `packages/eslint-plugin` as a first-class workspace package. Gets type-checked,
  versioned, built like the others.
- `tools/eslint-plugin` outside the workspace. Less ceremony, slightly harder to
  wire into Turborepo pipelines.

**Decision:** `packages/eslint-plugin` (workspace package, published name
`@newsletter/eslint-plugin`). Consistency with the rest of the monorepo
outweighs the directory-naming nit.

### C2. Type-aware vs. syntactic rules

Type-aware rules need `ESLintUtils.getParserServices(context)` and a TypeScript
program. The root config already sets `projectService: true`, so this is free.
Use type-aware where it materially reduces false positives (e.g. checking that a
collector's return type assignable to `RawItemInsert[]`); use syntactic rules
where a selector is enough (e.g. import source is `"hono"`).

### C3. Rule path scoping

Two ways to scope:
1. Inside the rule, check `context.filename` and bail out early.
2. Outside the rule, use flat-config `files` globs to only apply the rule to the
   relevant paths.

**Decision:** Use flat-config `files` globs. Rules stay generic and reusable;
pathing lives where paths already live (`eslint.config.mjs`).

### C4. Promotion workflow (`warn` → `error`)

Hard-coding severity in the plugin defaults is wrong — severity is a consumer
decision. Every new rule gets added to `eslint.config.mjs` at `"warn"`. A
follow-up PR (blocked on "one sprint clean") flips it to `"error"`. CI won't
fail on warnings, but the line count shows up in the lint output.

### C5. Repository pattern enforcement details

The rule `enforce-repository-access` must:
- Forbid imports of `@newsletter/shared/db` (or whatever the drizzle client
  re-export path is) from anywhere except `**/repositories/**` and `**/tests/**`.
- Allow repository files to import whatever they need.
- Report on direct use of `db.` calls where `db` was imported from a disallowed
  path — but this is dead code if the import rule is enforced, so the import check
  alone is enough for v1.
- Be scoped by flat-config to `packages/api/**` and `packages/pipeline/**` only.
  `packages/web/**` never sees a DB client, `packages/shared/**` *is* the DB layer.

This is mostly expressible with `no-restricted-imports` — start there. Custom
code only if we need more nuance later.

## Approaches Considered

### Approach A — Pure off-the-shelf (no custom plugin)

Lean entirely on `no-restricted-imports`, `eslint-plugin-boundaries`, and
`eslint-plugin-jsonc`, plus a Node script for structural checks. No custom AST
code at all.

- ✅ Zero maintenance burden on custom rule code.
- ✅ Fast to set up — a single PR.
- ❌ Cannot express the interesting checks: dotenv-at-entrypoint, no-readFileSync
  on `import.meta.url` URLs, collector return type assignability, repository
  pattern when the "disallowed imports" list grows unwieldy.
- ❌ The .claude/rules/learnings/ backlog keeps accumulating with no path to
  automation.

### Approach B — Custom plugin, greenfield, all rules from day one

Write every rule we've ever wanted up front. Cover learnings, conventions,
repository pattern, tests, tooling — the lot.

- ✅ One big lift, done.
- ❌ High false-positive risk. Multiple rules land simultaneously with no
  per-rule validation period.
- ❌ Large upfront cost, low incremental learning.
- ❌ Rules we imagined but don't actually need bloat the plugin.

### Approach C — Custom plugin + off-the-shelf hybrid, rolled out incrementally (recommended)

Stand up the plugin package with the plumbing + one proof rule, then add rules
over successive PRs, each at `warn` first. Use `no-restricted-imports` for
simple boundary rules; reach for custom code only when a rule genuinely needs
AST or type information. Use a separate `tools/check-repo-invariants.ts` script
for non-code checks (package.json version pinning, vitest config exclusion).

- ✅ Small, verifiable PRs. Each new rule can be validated on real code before
  promotion.
- ✅ The plugin grows to match actual pain, not imagined pain.
- ✅ Mix of mechanisms — each problem uses the lightest tool that fits.
- ❌ More rollout coordination (multiple PRs instead of one).
- ❌ For a while, some rules live in the plugin and some in declarative config —
  contributors need to know where to look. Mitigate with `docs/rules/README.md`.

**Recommendation:** Approach C. The false-positive and scope-creep risk of B is
not worth the "done in one PR" upside; A leaves too much on the table.

## Chosen Approach: C (incremental custom plugin + hybrid)

### High-level structure

```
packages/eslint-plugin/
  src/
    index.ts                  // plugin export: { meta, rules }
    rules/
      dotenv-bootstrap.ts
      no-bundled-readfilesync.ts
      enforce-repository-access.ts  // may just re-export a preset of no-restricted-imports
      collector-return-shape.ts
      ... (one file per rule)
    utils/
      create-rule.ts          // ESLintUtils.RuleCreator wrapper, sets docs URL base
  tests/
    rules/
      dotenv-bootstrap.test.ts
      ...
  docs/
    rules/
      README.md               // index
      dotenv-bootstrap.md
      ...
  package.json
  tsconfig.json
  eslint.config.mjs           // lints the plugin itself

tools/
  check-repo-invariants.ts    // package.json pinning, vitest config, etc.
```

Root `eslint.config.mjs` imports the plugin and applies rules under path-scoped
blocks:

```js
import newsletter from "@newsletter/eslint-plugin";

export default tseslint.config(
  // ... existing config ...
  {
    files: ["packages/api/src/**/*.ts", "packages/pipeline/src/**/*.ts"],
    plugins: { newsletter },
    rules: {
      "newsletter/enforce-repository-access": "warn",
    },
  },
  {
    files: ["packages/pipeline/src/**/*.ts"],
    plugins: { newsletter },
    rules: {
      "newsletter/no-bundled-readfilesync": "warn",
      "no-restricted-imports": ["warn", {
        paths: [
          { name: "hono", message: "Pipeline package must not import HTTP frameworks." },
          { name: "@newsletter/api", message: "Pipeline cannot depend on API." },
        ],
      }],
    },
  },
  {
    files: ["packages/api/src/index.ts", "packages/pipeline/src/index.ts"],
    plugins: { newsletter },
    rules: { "newsletter/dotenv-bootstrap": "warn" },
  },
);
```

### Rule inventory for v1

Bucket the rules into three layers.

#### Layer 1 — off-the-shelf `no-restricted-imports` (no custom code)

| Check | Scope | Source rule |
|---|---|---|
| Pipeline cannot import HTTP frameworks (`hono`, `express`, `fastify`) | `packages/pipeline/**` | `no-restricted-imports` |
| Pipeline cannot import `@newsletter/api` | `packages/pipeline/**` | `no-restricted-imports` |
| Web cannot import `drizzle-orm` or `@newsletter/shared/db` | `packages/web/**` | `no-restricted-imports` |
| API routes cannot import `@newsletter/shared/db` directly (must go through services → repositories) | `packages/api/src/routes/**` | `no-restricted-imports` |

These land in the root `eslint.config.mjs` and need zero custom rule code. Ship
them in the same PR that scaffolds the plugin.

#### Layer 2 — custom plugin rules (v1 must-haves)

| Rule | Motivation | Type-aware? |
|---|---|---|
| `newsletter/dotenv-bootstrap` | `always-load-dotenv-in-package-entrypoint.md` | No — checks first two statements of the file |
| `newsletter/no-bundled-readfilesync` | `bundled-assets-need-import-not-readfilesync.md` | No — syntactic: flag `readFileSync` whose first argument is a `new URL(..., import.meta.url)` or contains `__dirname` |
| `newsletter/enforce-repository-access` | user's call-out + architecture.md | No — but easier as custom rule than giant `no-restricted-imports` list because the allowed-path glob (`**/repositories/**`) is more expressive |
| `newsletter/collector-return-shape` | collector pattern in architecture.md | **Yes** — exported functions in `packages/pipeline/src/collectors/**` must return `Promise<RawItemInsert[]>` or `Promise<CollectorResult>`. Uses parserServices.getTypeAtLocation |
| `newsletter/no-raw-alter-table` | database.md | No — `db.execute` with a template literal matching `/ALTER\s+TABLE/i` |

Each rule ships in its own PR with: code + RuleTester fixtures + docs page +
addition to `eslint.config.mjs` at `"warn"` severity.

#### Layer 3 — `tools/check-repo-invariants.ts` script (not ESLint)

A small `tsx` script run as part of `pnpm lint` (added to the `turbo.json`
pipeline). Exits non-zero on violation. Checks:

| Check | Source |
|---|---|
| No `^` or `~` version ranges in any `package.json` | `.claude/rules/tooling.md` |
| `ai` and `@ai-sdk/*` exist at exact matching major across workspace | `lock-ai-sdk-versions-explicitly.md` |
| Every package with a `vitest.config.ts` excludes it from its `tsconfig.json` `exclude` | `exclude-vitest-config-from-tsc-build.md` |
| No `docker` or `docker-compose` references in scripts, docs, or `compose.yml` top-level keys | `tooling.md` | <!-- invariants:allow docker -->
| `.env.example` and `.env` have the same keys (warn on drift) | implicit from tooling.md |

These can run in milliseconds and give immediate feedback. Shipping them as a
plain script sidesteps ESLint's JSON/YAML awkwardness.

### What's explicitly out of scope for v1

- API "thin route handlers" rule (too fuzzy; repository-access rule covers the
  worst version of this).
- "Structured logging at boundaries" rule (subjective; let code review handle it).
- "Test files must assert exact SPEC strings" rule (requires SPEC cross-reference;
  defer until we have a stable SPEC-linking convention).
- Repository function naming conventions (`findX`, `upsertX`) — too opinionated.
- Frontend-specific rules — none in v1.

These can be added later in Layer 2 once the plumbing is proven.

## Rollout plan (sketch — belongs to a later planning stage)

1. **PR 1 — Scaffold the plugin package + Layer 1 rules.** Workspace package,
   one trivial custom rule (`dotenv-bootstrap`) to prove plumbing end-to-end,
   all Layer 1 `no-restricted-imports` rules. Wire into `eslint.config.mjs` at
   `"warn"`. Add rule-tester dependency and a `test:rules` script.
2. **PR 2 — `no-bundled-readfilesync` + `no-raw-alter-table`.**
3. **PR 3 — `enforce-repository-access`** (the user's priority rule).
4. **PR 4 — `collector-return-shape`** (first type-aware rule; validates we can
   use parserServices cheaply).
5. **PR 5 — `tools/check-repo-invariants.ts`** with the Layer 3 checks, wired
   into the `lint` task in `turbo.json`.
6. **Promotion PRs** — one per rule, flipping severity from `"warn"` to
   `"error"` after observed clean.
7. **Docs update** — `.claude/rules/learnings/` files get a "Enforced by:
   `newsletter/<rule-name>`" footer once a rule covers them.
8. **Workflow update** — `/extract-learnings` skill gains a step: "if the
   learning can be mechanically enforced, draft a rule stub in
   `packages/eslint-plugin/src/rules/` alongside the markdown".

## Open Questions

1. **Plugin package name** — `@newsletter/eslint-plugin` or
   `eslint-plugin-newsletter`? The ESLint ecosystem convention is
   `eslint-plugin-<name>`. Workspace convention says `@newsletter/*`. Leaning
   toward the workspace convention for consistency, but this decision affects
   publishability (we're not publishing, so it probably doesn't matter).
2. **`enforce-repository-access` — custom rule or styled `no-restricted-imports`
   preset?** Start with `no-restricted-imports`. If the allowed/disallowed
   patterns get unwieldy (more than ~10 entries or needing per-directory
   allowances), promote it to a custom rule.
3. **Should lint failures block commit via the pre-commit hook, or only CI?**
   Currently lint-staged runs on pre-commit. Keeping `warn` rules non-blocking
   but `error` rules blocking is the natural split; confirm that's acceptable
   friction.
4. **Monorepo-wide rule vs package-level rule files?** Keeping everything in
   the root `eslint.config.mjs` is simpler today, but it grows fast. Consider
   splitting into a per-package `eslint.config.mjs` once the root file exceeds
   ~200 lines.
5. **Do we want to enforce anything on the `web` package in v1?** No clear
   pain signal yet. Suggest skipping and revisiting after one round of
   frontend review.

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| False positives erode trust; contributors start disabling rules | Medium | High | Ship every new rule at `warn`. Promote to `error` only after one sprint of real use without disables. |
| Type-aware rules slow down lint noticeably | Low | Medium | `projectService` is already enabled, so parserServices are free. Benchmark each rule and bail out of expensive selectors fast. |
| Rule logic encodes paths that move (e.g. `src/repositories`) | Medium | Low | Scope via flat-config globs, not in-rule path checks. |
| The plugin diverges from `.claude/rules/learnings/` — one side says one thing, the other says the opposite | Medium | Medium | Each rule doc links to its originating learning. `/extract-learnings` skill updated to draft rule stubs; reviewers check for contradictions. |
| Contributors don't know where to add a new rule vs a learning vs the invariants script | High | Low | Add `packages/eslint-plugin/docs/rules/README.md` with a decision tree: "Can you express it as `no-restricted-imports`? → config. Does it need AST? → custom rule. Is it a file-shape / package.json / env check? → invariants script." |
| Review bottleneck if every new rule needs a human PR approver (per ownership decision) | Medium | Low | Keep rule additions small (single rule per PR) so review is quick. Humans review; agents do the work. |

## Assumptions

1. ESLint 9 flat config stays the linter — no migration in flight.
2. TypeScript project service continues to work across the monorepo; we do not
   need to manage a separate `parserOptions.project` array.
3. `@typescript-eslint/rule-tester` works under Vitest 3 (verified by existing
   tests in `@typescript-eslint/utils` docs and context7 fetch).
4. We never publish `@newsletter/eslint-plugin` externally — it lives in the
   workspace and is only consumed by the root config.
5. The `/extract-learnings` skill is editable and we're willing to extend it with
   a "also draft a lint rule" step.
6. Humans have bandwidth to review rule PRs on a reasonable cadence; otherwise
   the "humans curate, agents propose" model stalls.
