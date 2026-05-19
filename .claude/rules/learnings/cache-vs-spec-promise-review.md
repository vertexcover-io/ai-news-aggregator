# Code review must explicitly compare "cache for performance" patterns against spec freshness promises

When a feature's design or spec promises that an external mutation (admin save, config change, DB write) takes effect "on the next job" or "without a restart," any caching layer that resolves the affected resource at process / worker startup silently violates the contract.

## What bit us

The admin-social-config feature (PR feat/admin-social-config) promised in the design doc §3 and §4.4:

> Saving credentials via /admin/settings takes effect on the next pipeline job WITHOUT a worker restart.

The first code-review pass (`REVIEW-pass1.md`) approved a worker that constructed `publishDeps` (LinkedIn + Twitter notifiers, with credentials embedded at construction time) **once** at worker startup. That worker would have served stale credentials forever. The second review pass (`REVIEW-pass2.md`) caught this and the fix moved the resolution into a per-job closure (`buildPublishDeps` invoked inside the worker's processor function).

## Rule

When reviewing code that adds caching, memoization, or once-at-startup resolution of any resource that downstream features may mutate at runtime, **explicitly cross-reference the spec/design "freshness" promises** before approving.

Concrete review checklist when you see a `Map`-cached, module-level-const, or constructor-time-resolved dependency:

1. **Identify the resource:** what is being cached (credentials, config, settings, schedule, feature flags)?
2. **Search the spec / design for freshness language:** "takes effect on next", "without a restart", "picks up new", "live", "current". If any of these exist for this resource, the cache is a defect.
3. **Confirm the cache key matches the freshness boundary:** request-scoped (fine), per-job (fine), per-process (suspect — must be justified).
4. **Verify with a concrete probe in the test suite:** "save X via API, then trigger Y, then save X' via API, then trigger Y again — does Y see X'?" If the test doesn't exist, ask for it.

## Heuristic for the original author

If your design doc says "no restart required" for a config change, write a test before merge that *proves* it: mutate the config via the public API, trigger the downstream job, mutate again, trigger again, assert the second invocation observed the second mutation. If you can't write that test cheaply, your caching is probably wrong.

## How it failed the first review

The pass-1 reviewer focused on the unit-level correctness of each piece (cipher correct, resolver correct, route handlers correct) without checking the assembly point in `processing.ts` against the design doc's freshness promise. The pass-2 reviewer started from "what does the design doc promise the user?" and walked the call graph forward — the cached `publishDeps` jumped out immediately.

**Generalisation:** code review for spec-driven features should always include one pass that *starts from the user-visible promise* and walks forward into the implementation, not just an inside-out unit-correctness pass.
