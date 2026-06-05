# Library Probe — fix-tech-debt-2026-06-04

<!-- LP:VERDICT:PASS -->

**Mode:** No NEW external libraries are introduced. The dependency work stream bumps already-integrated, pinned deps. Probe = registry existence + peer-compat verification (done live below) + the repo's own gates (build/typecheck/lint/unit/e2e) executed in the coder phase, which is the meaningful integration test for in-place version bumps.

## Verified bump targets (live `npm view`, 2026-06-04)

| Dep | Pinned now | Target (exact) | Verdict | Notes |
|-----|-----------|----------------|---------|-------|
| drizzle-orm | 0.42.0 | **0.45.2** | VERIFIED | latest; fixes SQLi advisory |
| drizzle-kit | 0.31.1 | **0.31.10** | VERIFIED | paired tooling bump; 1.0.0-rc line NOT taken |
| hono | 4.7.7 | **4.12.23** | VERIFIED | same-major semver |
| @hono/node-server | 1.14.1 | **1.19.14** | VERIFIED | stays on v1 line (v2.0.4 exists — major, out of scope) |
| react-router-dom | 7.14.0 | **7.16.0** | VERIFIED | ≥7.15.0 CVE patch line |
| vite | 8.0.1 | **8.0.16** | VERIFIED | ≥8.0.5 CVE patch line |
| vitest | 3.2.1 | **4.1.8** | VERIFIED (attempt) | major; peers OK (vite ^8, jsdom *). **Fallback:** stay 3.2.1, finding → `issue` |
| bullmq | 5.51.0 | **5.78.0** | VERIFIED | same-major |
| @tanstack/react-query | 5.96.2 | **5.101.0** | VERIFIED | same-major |
| ws (override) | transitive | **8.21.0** | VERIFIED | root `pnpm.overrides` |
| engine.io (override) | transitive | **6.6.8** | VERIFIED | root `pnpm.overrides` |
| uuid (override) | transitive | — | SKIPPED | latest is v14; consumers (bullmq, svix) pin older majors — forcing ≥11.1.1 risks breaking them for a Low, not-exploitable-here CVE. Disposition `dropped` with this reason. |
| ai / @ai-sdk/* | 5.0.169 / 2.0.74 | — | DEFERRED | major upgrade requires live per-provider cost probes per repo learnings; stays `issue` in #247 |

No `.env.harness` credentials needed — no external service smoke tests apply.
