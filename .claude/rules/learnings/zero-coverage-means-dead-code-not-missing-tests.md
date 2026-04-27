# 0% coverage on a file despite a named test file means the file is dead code

When a coverage report shows 0% on `foo.ts` even though `foo.test.ts` exists and passes, the test file is importing from a *different* module — usually a composite barrel or a renamed/inlined copy — not from `foo.ts` directly. The source file is dead code: nothing imports it, so the instrumented version is never loaded.

Before writing more tests to fix a 0% file, run:

```bash
# Check what actually imports the file
rg "from.*foo" packages/ --include="*.ts"

# Check what the test actually imports
grep "import" packages/.../foo.test.ts
```

If nothing imports `foo.ts` except tests that reference it by a different path, the file is dead code. The fix is to delete it (or consolidate it into the active module), not to add tests.

Why: In the tech-debt coverage run, `web-image-fallback.ts` showed 0% despite 16 passing tests in `web-image-fallback.test.ts`. The tests imported `extractFallbackImage` from `web.js` (where the function was inlined), not from the original source file. The original was never imported anywhere — it was dead code left over from a refactor.

Enforced by: manual check when coverage shows 0% on a file that has a test file
