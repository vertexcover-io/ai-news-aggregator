---
title: "Hermetic + serial Playwright e2e: the five authoring traps that waste a RED cycle"
date: 2026-06-12
category: gotchas
tags: [playwright, e2e, hermetic, vite, flaky-tests, waitForResponse, text-transform, rate-limit, resend-mock]
component: web e2e suite
severity: medium
status: documented
applies_to: ["packages/web/tests/e2e/**", "**/run-e2e.mjs", "**/playwright.config.*"]
stage: [code, verify]
evidence_count: 6
last_validated: 2026-06-12
source: test-authoring-trap@multi-tenant
related: [".harness/knowledge/lessons/gotchas/stale-db-false-green-per-purpose-postgres-20260612.md"]
---

# Hermetic + serial Playwright e2e: the five authoring traps that waste a RED cycle

## Problem

A hermetic Playwright suite (one shared Postgres/Redis, `workers:1`, real API via `tsx watch`, Vite dev server) repeatedly produced confusing RED runs whose cause was the *test*, not the code. Five distinct traps recurred across phases of one feature.

## Insight

**In a hermetic+serial suite the test harness shares mutable state and a dev toolchain with the app, so several "obvious" assertions are subtly wrong.** The five that bit, each with its fix:

1. **`waitForResponse(r => r.url().includes("/api/home"))` matches the Vite module request `/src/api/home.ts` first** — yielding `SyntaxError: Unexpected token i, "import {…" is not valid JSON`. Match the pathname exactly: `new URL(r.url()).pathname === "/api/home"`. Never `includes()` a path under a Vite dev server.
2. **`innerText` on uppercase-styled chrome leaks `text-transform`** — a header rendered `MUST READ` via CSS `text-transform: uppercase` returns `"MUST READ"` from `innerText` even though the DOM text is `Must Read`. Normalize case in the assertion, or assert against the accessibility name, not `innerText`.
3. **An assertion that is ALREADY true races the in-flight mutation.** Asserting a badge/text that happens to match the pre-mutation state passes before the save completes. Await the network response (`page.waitForResponse(...)` on the mutation) or a state *transition*, not a static text match.
4. **Per-IP auth rate limits throttle the whole serial suite from one IP.** Dozens of logins from `127.0.0.1` hit the production token-bucket (10 burst / 0.5 tok/s) and 429 mid-suite. Make the limiter env-tunable and crank it in the e2e webServer env (`AUTH_RATE_LIMIT_CAPACITY`, `AUTH_RATE_LIMIT_REFILL_PER_SEC`); cover the 429 path in an API integration test instead.
5. **Editing `src/` while the suite runs restarts the API mid-run.** `tsx watch` reloads the API on any source change, killing in-flight requests and corrupting the shared DB state — never touch `src/` while a hermetic suite is running.

Bonus seam rules: mock Resend end-to-end via `RESEND_BASE_URL` pointed at a fake server + a hard fake `RESEND_API_KEY` in the e2e allowlist (so a real key can never leak a send, S-web-04); and in web unit tests this repo uses RTL `fireEvent`, not `@testing-library/user-event` (not installed) — and page-chrome text can collide with fixture data, so scope queries to the component.

## Solution

```ts
// 1. pathname match, not includes()
await page.waitForResponse(r => new URL(r.url()).pathname === "/api/home" && r.status() === 200);

// 2. normalize CSS-uppercased text
expect((await nav.innerText()).toLowerCase()).toContain("must read");

// 3. await the mutation, not the (already-true) text
const [res] = await Promise.all([
  page.waitForResponse(r => r.url().endsWith("/api/sources") && r.request().method() === "PATCH"),
  toggle.click(),
]);
expect(res.ok()).toBe(true);
```

```js
// 4. e2e webServer env (run-e2e.mjs / playwright.config.ts)
env: { AUTH_RATE_LIMIT_CAPACITY: "100000", AUTH_RATE_LIMIT_REFILL_PER_SEC: "1000",
       SLACK_WEBHOOK_URL: "", RESEND_BASE_URL: `http://127.0.0.1:${fakePort}`, RESEND_API_KEY: "re_e2e_fake_key" }
```

## Prevention / Reuse

- Default to pathname-exact + status in every `waitForResponse`/`waitForRequest` under Vite.
- Assert state *transitions* (await the mutation response) rather than static text that may already match.
- Treat any per-IP/per-session production limit as something the serial suite will trip — make it env-tunable and relax it for e2e, test the limit itself in isolation.
- Force-blank every outbound channel (`SLACK_WEBHOOK_URL=""`) and point SDKs at fakes via their base-URL env in the webServer block — never rely on `.env` not having a real key.
- Recurrence signal: a RED that passes in isolation but fails in full-suite order, or a JSON-parse error on what should be an API response.

## Related

- `.harness/knowledge/lessons/gotchas/playwright-getbyrole-heading-level-must-match-component-20260605.md` — sibling Playwright selector gotcha
