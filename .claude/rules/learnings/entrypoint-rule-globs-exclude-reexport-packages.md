# Entry-point lint rules must scope to runnable packages, not every `src/index.ts`

Rules that enforce something about a package's entry point (e.g. "every entry file must load dotenv first", "every entry file must register a signal handler") should glob only the packages that are actually runnable Node processes — not every `packages/*/src/index.ts`.

Re-export barrel packages like `@newsletter/shared` have a `src/index.ts` that only re-exports types/utilities. They are never executed as a process, so enforcing "first statement must be `dotenv.config(...)`" on them is a false positive that forces garbage code into a library.

Use an explicit allowlist of runnable services in the rule's `files` glob:

```js
// eslint.config.mjs
{
  files: ["packages/{api,pipeline}/src/index.ts"],
  rules: { "newsletter/dotenv-bootstrap": "error" },
}
```

Not:

```js
// BAD — matches packages/shared/src/index.ts which is a library barrel
{ files: ["packages/*/src/index.ts"], ... }
```

Why: In the custom-eslint-plugin run, the SPEC said `packages/*/src/index.ts` for the `dotenv-bootstrap` rule scope. Phase 2 correctly narrowed it to `packages/{api,pipeline}/src/index.ts` because `packages/shared/src/index.ts` is a pure re-export file and adding `dotenv.config()` there would be nonsense. The lesson is to treat the "runnable vs re-export" distinction as part of rule scoping from the start — don't trust a SPEC-provided glob that sweeps in library packages.