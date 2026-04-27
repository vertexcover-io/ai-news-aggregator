# Install `@vitest/coverage-v8` at the same version as vitest, never latest

`@vitest/coverage-v8` and `@vitest/coverage-istanbul` are vitest sub-packages. Running coverage with a mismatched major (e.g. coverage-v8@4.x against vitest@3.x) fails immediately with a cryptic internal API error — the plugins call vitest hooks that changed between majors.

Always install the coverage plugin pinned to the exact same version as `vitest`:

```bash
# Check existing vitest version first
grep '"vitest"' package.json   # e.g. "3.2.1"

# Install coverage at the SAME version — never `pnpm add @vitest/coverage-v8` (installs latest)
pnpm add -D @vitest/coverage-v8@3.2.1
```

Why: In the tech-debt coverage run, `@vitest/coverage-v8@4.1.5` was installed into a project using `vitest@3.2.1`. Coverage failed immediately with an internal error. Downgrading to `3.2.1` fixed it.

Enforced by: manual review when adding coverage tooling
