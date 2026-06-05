# Collector Health Checks — Learnings

Captured during the functional-verify + quality-gate run for this feature (verification PASSED, quality gate PASS).

## 1. `as never` in a test deps object hid the newly-required `collectorHealthQueue` (the one real defect)

The settings router gained a **required** `collectorHealthQueue` dep. Production wired it; the e2e test
(`packages/api/tests/e2e/settings.e2e.test.ts`) used `processingQueue: queue as never` and omitted the new
field, so `tsc` stayed green but `PUT /api/settings` 500'd at runtime (`reconcileCollectorHealthSchedule(undefined, …)`).
Caught at the quality gate's e2e check, not at typecheck. Fixed by wiring a **separate** mock
`collectorHealthQueue` (separate so the processing-queue `toHaveBeenCalledTimes(5)` assertions stay correct).

→ Generalised to a reusable doc: `docs/solutions/gotchas/as-never-cast-hides-missing-required-dep-20260603.md`.
When adding a required field to any `*Deps` interface in this repo, grep every test construction site — casts hide the gap.

## 2. Lint must run AFTER `pnpm build` in a fresh worktree

`baseline.json` notes it explicitly: `pnpm lint` requires `@newsletter/eslint-plugin/dist` to be compiled
first (the custom-rule plugin is consumed from `dist`). In a fresh worktree, run `pnpm build` (or `pnpm typecheck`,
which builds shared deps) before `pnpm lint`, or the lint task fails to load the plugin. During this run `pnpm typecheck`
built the pipeline/shared dists first, so the subsequent `pnpm lint` was clean (5/5, 0 errors). Agents that skip lint
entirely let the 6 integration-time lint errors (seen in the original coder pass) slip to the gate — run `pnpm lint`
per-package as you go.

## 3. Shared-machine infra: port conflicts + inotify ENOSPC blocked the standard service lifecycle

This worktree's compose maps Postgres→5433 and Redis→6379, but those host ports were already held by sibling
worktrees' containers that reject the `newsletter` password. And the host `fs.inotify.max_user_watches` (65536) was
exhausted, so `tsx watch` (the `pnpm dev` API/pipeline command) and the Vite dev server both crashed with
`ENOSPC: System limit for number of file watchers reached`. Workarounds used for live verification + quality-gate Check 8:

- Started **dedicated** containers on free ports: `chc-verify-pg` (5455) + `chc-verify-redis` (6399); pointed
  `DATABASE_URL` / `REDIS_URL` at them via env override (the symlinked `.env` is shared, so override per-command, don't edit it).
- Ran the API + pipeline worker via `tsx src/index.ts` (NO `watch`) to avoid the file-watcher crash.
- Served the **built** web `dist` from a tiny Node static-+-`/api`-proxy server on :5173 (Vite dev/preview unusable
  under the inotify limit; `vite preview` also lacks the `server.proxy` block).
- The pipeline boot gate `assertChromiumInstalled()` requires `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` — set it to an
  existing `~/.cache/ms-playwright/chromium-*/chrome-linux*/chrome` (the blog health strategy genuinely crawls).
- The pipeline e2e suite reads `.env.test` (DB on 5433/`newsletter_test`) and connects to the `postgres` maintenance DB
  to create the test DB; override `DATABASE_URL`/`REDIS_URL`/`SESSION_SECRET` (not in `.env.test`) to the working ports.
- A long-running pipeline worker on the shared Redis **pollutes the e2e seam tests** (it consumes/competes for queue
  jobs). Kill the verification worker before running `pnpm test:e2e`.

## 4. Pre-existing / environmental e2e failures (NOT this feature)

Out-of-feature e2e failures observed and confirmed unrelated (none in this feature's diff):
- `collection.e2e.test.ts` ×4 — the **legacy** collection worker test wires `new Worker(name, handleCollectionJob)`
  passing the handler directly, so BullMQ calls it `(job, token)` and the `deps` default becomes the token string →
  `deps.rawItemsRepo` undefined → `upsertItems` on undefined. Only manifests when live HN/Reddit network fetch succeeds.
- `sns-webhook.e2e.test.ts` ×3 — require real AWS SNS signature/cert verification.
- `admin-must-read.e2e.test.ts` (SameSite cookie) ×1 — env/config-dependent cookie attribute.

## 5. `.harness/` path resolution in worktrees recurred

Phase-claims again landed against the main checkout rather than the worktree `.harness/` (the documented
`harness-path-resolution-in-worktrees.md` failure mode). Aggregation found them via the worktree `.harness/` this time,
but the recurrence confirms the rule: pass the worktree-absolute `.harness/<SPEC>/` path explicitly to sub-agents.

## 6. Decision IDs: avoid colliding with un-indexed package-local D-ids

When adding cross-package decisions to `docs/context/DECISIONS.md`, `packages/pipeline/services/PACKAGE.md` already
used package-local `D-070/D-071/D-072` that were never registered in the root index. The new cross-package
decisions were assigned **D-110 / D-111** to avoid the collision. (Flagged the un-indexed local ids in `.sync-report.md`
as a pre-existing gap for a future whole-codebase sync.)
