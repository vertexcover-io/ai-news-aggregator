---
id: S-web
applies_to: ["packages/web/src/**", "packages/web/tests/e2e/**", "packages/web/playwright.config.ts"]
enforced_by: convention
decisions: [D-100]
last_verified_sha: 226dc6e8b93a852b425cc426ef9dc4a27505bdf4
status: active
---

# Web standards

## S-web-01 — Subpath-only shared imports

**Rule:** All imports from `@newsletter/shared` must use subpaths (`@newsletter/shared/types`, `@newsletter/shared/constants`). Never import from the root `@newsletter/shared` barrel — it pulls `postgres` into the browser bundle.

**Enforced by:** convention (not linted, enforced by learnings rule and code review)

**Smell:** `import { RunSummary } from "@newsletter/shared"` — missing subpath.

## S-web-02 — API calls through client wrappers

**Rule:** All HTTP calls go through `api/client.ts` wrappers (`apiFetch`, `apiFetchAdmin`). Components and hooks never call `fetch` directly — except `api/eval.ts::runEval` which needs `ReadableStream` for SSE.

**Enforced by:** convention (not linted)

**Smell:** `await fetch("/api/...")` in a component or hook file.

## S-web-03 — Pages are thin

**Rule:** Page components compose hooks (data fetching + state) with presentational components. Business logic lives in hooks; rendering logic lives in components.

**Enforced by:** convention (not linted)

**Smell:** A page component with >50 lines of inline data fetching or state management logic.

## S-web-04 — E2E sends no real external messages

**Rule:** E2E tests must never trigger a real outbound message to a third-party service (Slack, email, LinkedIn, X). The hermetic harness neutralizes these at the API `webServer.env` allowlist in `packages/web/playwright.config.ts` by force-blanking the relevant env var (e.g. `SLACK_WEBHOOK_URL: ""`). Because the API runs `dotenv.config()`, which leaves already-set keys intact, pre-setting the key to `""` in the webServer env wins over `.env` and the integration self-disables (`createSlackNotifier` no-ops on `""`/undefined). To assert that a path *would* trigger Slack, check logs or DB state (`slack.notify.*` events, `slackNotifiedAt`), never a live webhook. New e2e specs that touch a notify path inherit this automatically — never add a real webhook URL or live API key to the e2e env to "test" it.

**Enforced by:** convention (the webServer env allowlist in `playwright.config.ts` + code review of new e2e specs)

**Smell:** a real `https://hooks.slack.com/...` URL or live API key reaching an e2e-spawned server; a passthrough (`SLACK_WEBHOOK_URL: process.env.SLACK_WEBHOOK_URL ?? ""`) instead of a hard `""` in `playwright.config.ts`.
