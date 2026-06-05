# Learnings

## Targeted Vitest commands in this workspace

When a package-level targeted test is needed, use Vitest directly through the
package filter:

```bash
pnpm --filter @newsletter/web exec vitest run --project unit tests/unit/EvalIndexPage.test.tsx
pnpm --filter @newsletter/api exec vitest run --project unit src/routes/__tests__/admin-eval.test.ts
```

The package `test:unit -- <file>` form can still expand into the full unit
project depending on the script wiring. The direct `exec vitest run --project`
form is the reliable command for single-file regression loops.

## Vitest JSON output path is package-relative

With `pnpm --filter <package> exec vitest ... --outputFile=.harness/...`,
Vitest writes the JSON file relative to the filtered package's current working
directory, not the repository root. For root-level harness aggregation, either
use an absolute `--outputFile` path or copy the generated package-local report
into `.harness/<spec>/` before combining evidence.
