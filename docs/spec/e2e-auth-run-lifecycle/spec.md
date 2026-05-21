# SPEC — E2E test coverage for auth and run lifecycle

**Spec name:** `e2e-auth-run-lifecycle`
**Status:** Draft → ready for planning
**Source design:** `docs/spec/e2e-auth-run-lifecycle/design.md`
**Library probe:** `docs/spec/e2e-auth-run-lifecycle/library-probe.md` (NOT_APPLICABLE)
**Date:** 2026-05-21

## Summary

Add e2e test coverage for the admin authentication endpoints and the
run-lifecycle endpoints that were identified as gaps in the audit at the
start of this orchestrate run. No product code changes — only test files
and the spec artefact tree.

## Acceptance criteria (EARS)

### Admin authentication

- **REQ-A1:** When `POST /api/admin/login` is called with body
  `{ password: <correct value> }`, the system shall respond with HTTP
  200, JSON body `{ ok: true }`, and a `Set-Cookie` header whose value
  starts with `admin_session=` followed by a non-empty token.
- **REQ-A2:** When `POST /api/admin/login` is called with body
  `{ password: "wrong" }`, the system shall respond with HTTP 401 and
  JSON body `{ error: "invalid_password" }`.
- **REQ-A3:** When `POST /api/admin/login` is called with a body that
  fails the `loginSchema` (`{ password: "" }` or `{}`), the system
  shall respond with HTTP 400 and JSON body `{ error: "invalid_body" }`.
- **REQ-A4:** When `POST /api/admin/logout` is called, the system shall
  respond with HTTP 200, JSON body `{ ok: true }`, and a `Set-Cookie`
  header whose value contains `admin_session=` followed by an empty
  value AND `Max-Age=0` (cookie clearing).
- **REQ-A5:** When `GET /api/admin/me` is called against the admin
  router, the system shall respond with HTTP 200 and JSON body
  `{ admin: true }`. (Cookie gating is upstream of this router and
  is verified separately by the web spec REQ-W1.)

### Run lifecycle — POST /api/runs/now

- **REQ-N1:** When `POST /api/runs/now` is called with no body and the
  injected settings repo returns a `UserSettings` row with at least one
  source enabled (`hnEnabled && hnConfig !== null`, or equivalent for
  reddit/web/twitter/web_search), the system shall respond with HTTP
  202 and JSON body `{ runId: "<uuid>" }`, AND the processing queue
  shall receive exactly one `add()` call whose `opts.jobId === runId`.
- **REQ-N2:** When `POST /api/runs/now` is called and the settings repo
  returns `null`, the system shall respond with HTTP 409 and JSON body
  `{ error: "settings not configured" }`.
- **REQ-N3:** When `POST /api/runs/now` is called and the settings row
  has every source disabled (all `*Enabled` flags `false` or `*Config`
  null), the system shall respond with HTTP 409 and JSON body
  `{ error: "no sources enabled" }`.
- **REQ-N4:** When `POST /api/runs/now` is called with body
  `{ dryRun: true }`, the enqueued job payload shall include
  `dryRun: true`.
- **REQ-N5:** When `POST /api/runs/now` is called with body
  `{ dryRun: "yes" }` (non-boolean), the system shall respond with
  HTTP 400. (zod strict-object rejection of the wrong type.)

### Run lifecycle — POST /api/runs/:runId/cancel

- **REQ-C1:** When `POST /api/runs/:runId/cancel` is called for a runId
  whose Redis key holds a `RunState` with `status: "running"`, the
  system shall respond with HTTP 200, the Redis key shall be updated
  so that `status === "cancelling"`, and exactly one message shall be
  published on the `run:cancel:<runId>` pub/sub channel within 1
  second.
- **REQ-C2:** When `POST /api/runs/:runId/cancel` is called for a runId
  that does not exist in Redis AND has no archive row, the system
  shall respond with HTTP 404 and JSON body `{ error: "not found" }`.
- **REQ-C3:** When `POST /api/runs/:runId/cancel` is called for a runId
  whose Redis state has terminal status (`completed`, `failed`, or
  `cancelled`), the system shall respond with HTTP 409 and JSON body
  `{ error: "run is not cancellable", status: <terminalStatus> }`.

### Run lifecycle — GET /api/runs (list)

- **REQ-L1:** When `GET /api/runs` is called with no `limit` query
  param, the system shall respond with HTTP 200 and JSON body
  `{ runs: RunSummary[] }`. The array may be empty.
- **REQ-L2:** When `GET /api/runs?limit=5` is called, the response
  shall be HTTP 200. (Limit semantics — actual sort + slice — are
  service-layer concerns covered by existing unit tests of
  `listRuns()`; the e2e simply confirms the route returns 200 and
  the array length is `≤ limit`.)
- **REQ-L3:** When `GET /api/runs?limit=0`, `GET /api/runs?limit=101`,
  or `GET /api/runs?limit=abc` is called, the system shall respond
  with HTTP 400 and JSON body whose `error` field starts with
  `"limit must be an integer"`.

### Web — dashboard Run Now button

- **REQ-W1:** When an authenticated admin navigates to `/admin`,
  clicks the "Run Now" button (variant: non-dry), the system shall
  call `POST /api/runs/now` and within 5 seconds the recent-runs
  table shall display a row for the returned `runId` with status
  `running` (or `queued`).

## Verification scenarios

| ID | Maps to | What is exercised | Where |
|---|---|---|---|
| VS-1 | REQ-A1 .. REQ-A5 | Login, logout, me — happy and error paths | `packages/api/tests/e2e/admin.e2e.test.ts` |
| VS-2 | REQ-N1 .. REQ-N5 | POST /api/runs/now — settings/source matrix + dryRun | `packages/api/tests/e2e/runs-now.e2e.test.ts` |
| VS-3 | REQ-C1 .. REQ-C3 | POST /api/runs/:runId/cancel — running, missing, terminal | `packages/api/tests/e2e/runs-cancel.e2e.test.ts` |
| VS-4 | REQ-L1 .. REQ-L3 | GET /api/runs — limit validation | `packages/api/tests/e2e/runs-list.e2e.test.ts` |
| VS-5 | REQ-W1 | Dashboard Run Now button → API → row | `packages/web/tests/e2e/dashboard-run-now.spec.ts` |

No VS-0 (probe re-run) scenarios — see `library-probe.md`.

## Out of scope

- HMAC cookie tampering scenarios for `/api/admin/me` (covered by
  existing `session.ts` unit tests).
- Cancel of a run with concurrent racers (service-layer concern).
- Run-now dispatch with dryRun across all source-enable permutations
  (single happy-path test is enough — we are not testing the source
  enablement logic itself, that's in `startRun`'s shared package).
- Any social posting / email send / collector / pipeline-worker
  e2e coverage (those are bundles 2–4 of the audit).

## Non-functional constraints

- All tests must pass under `pnpm --filter @newsletter/api test:e2e`
  and `pnpm --filter @newsletter/web test:e2e` with the existing
  `pnpm infra:up` prereq. No new env vars, no new packages.
- Tests must follow the project's `code-quality.md`: strict TypeScript,
  no `any`, no `as unknown as X`, explicit return types on exported
  functions.

## Definition of done

1. Five new test files exist at the paths in the verification matrix.
2. `pnpm --filter @newsletter/api test:e2e` runs the new vitest e2e
   tests and they all pass.
3. `pnpm --filter @newsletter/web test:e2e -- dashboard-run-now`
   passes against the live web + api dev servers.
4. `pnpm typecheck` and `pnpm lint` exit 0.
5. The spec artefact tree (`design.md`, `library-probe.md`, `spec.md`,
   `verification/proof-report.md`, `verification/adversarial-findings.md`,
   `README.md`) is committed alongside the tests.
