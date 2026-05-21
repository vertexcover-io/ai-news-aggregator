# Learnings — e2e-archives-social-collectors

## Target E2E Commands Directly For Spec Gates

The first quality-gate attempt used:

```bash
pnpm --filter @newsletter/api test:e2e -- tests/e2e/archives.e2e.test.ts
```

That command pulled unrelated API E2E files into this spec gate and failed on out-of-scope behavior. For targeted spec verification, use the direct runner invocation that the phase and review stages used:

```bash
pnpm --filter @newsletter/api exec vitest run --project e2e tests/e2e/archives.e2e.test.ts
pnpm --filter @newsletter/pipeline exec vitest run --project seam <new seam files>
pnpm --filter @newsletter/web exec playwright test tests/e2e/review-remove.spec.ts tests/e2e/review-inline-edit.spec.ts
```

This keeps the gate faithful to the spec while still running full typecheck and lint at the repo level.

## Treat Podman Proxy Errors As Port-State Evidence

`pnpm infra:up` returned `proxy already running` because healthy containers from another compose project were already bound to the expected Postgres and Redis ports. The useful next step was not a blind restart; it was to inspect `podman ps` and `podman-compose ps`, then verify that `localhost:5433` and `localhost:6379` were already serving the test dependencies.

For this repo's E2E work, a compose start failure with already-bound ports should be debugged as environment state first. If the required services are healthy on the configured `.env` URLs, proceed with migrations and tests rather than disrupting another running compose project.
