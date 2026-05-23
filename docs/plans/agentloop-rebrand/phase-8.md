# Phase 8: Playwright e2e + manual verify + cleanup

> **Status:** pending

## Overview

Add Playwright for the admin must-read flow (the one part of this feature that's hard to verify any other way), perform manual UI verification against the four HTML previews using Chrome MCP, run the full quality gate, and clean up.

## Implementation

**Files:**

- Create: `packages/web/playwright.config.ts`
  - Use `@playwright/test`
  - `baseURL: http://localhost:5173` (Vite dev server)
  - `webServer: { command: "pnpm dev", port: 5173, reuseExistingServer: true }`
  - Single chromium project, no parallelization to start
- Create: `packages/web/tests/e2e/admin-must-read.spec.ts`
  - Test 1 (REQ-029, REQ-030, EDGE-004): "admin adds a new entry via paste-URL flow"
    - Login as admin (use the password from `.env`)
    - Navigate to `/admin/must-read/new`
    - Paste URL `https://example.com/test` (a known-static page) → assert Save disabled, "Extracting…" visible
    - Wait for prefill → assert title field non-empty
    - Type annotation → click Save → assert redirected to `/admin/must-read`
    - Assert new entry appears in the list
  - Test 2 (REQ-031, EDGE-006): "admin sees duplicate-URL message"
    - Pre-seed an entry via the API
    - Navigate to `/admin/must-read/new`, paste the same URL, prefill, save → assert `URL already exists` message + link to the existing entry
  - Test 3 (REQ-027): "admin deletes an entry"
    - Seed entry, navigate to list, click Delete, confirm → assert row disappears
- Add: `@playwright/test` to `packages/web/package.json` devDependencies; `pnpm dlx playwright install chromium` for CI/local
- Modify: `packages/web/package.json` — add `test:e2e` script: `playwright test`

**Manual verification (use Chrome MCP via `mcp__claude-in-chrome__*`):**

1. Start `pnpm dev`, navigate to `http://localhost:5173/`
2. Compare against `/tmp/agentloop-previews/home.html` — typography, spacing, From-the-canon block, Elsewhere strip
3. Navigate to `/must-read` — compare against `must-read.html`
4. Navigate to `/built` — compare against `built.html`
5. Navigate to `/admin/must-read` (login first), paste a real URL, observe two-step flow
6. Capture screenshots of each page in viewport sizes 1440 (desktop) and 375 (mobile)
7. Verify mobile collapse: at 375px, only `SUBSCRIBE →` is visible in the masthead top-right

**Quality gate:**

```bash
pnpm install                          # install Playwright + node-html-parser if missing
pnpm --filter @newsletter/shared db:migrate  # apply 0027
pnpm typecheck                        # all packages
pnpm lint                             # all packages
pnpm --filter @newsletter/shared test:unit
pnpm --filter @newsletter/api test:unit
pnpm --filter @newsletter/api test:e2e        # requires `pnpm infra:up`
pnpm --filter @newsletter/web test:unit
pnpm --filter @newsletter/web test:e2e        # Playwright; needs dev server
pnpm build                            # all packages
```

All commands must exit 0.

**Manual NF-001 latency check:**

```bash
# Baseline:
for i in {1..10}; do curl -w "%{time_starttransfer}\n" -o /dev/null -s http://localhost:3000/api/archives; done | sort -n | sed -n '5p'
# Compare to:
for i in {1..10}; do curl -w "%{time_starttransfer}\n" -o /dev/null -s http://localhost:3000/api/home; done | sort -n | sed -n '5p'
```

p50 (median of 10) of `/api/home` MUST be within 100ms of `/api/archives` baseline. If not, investigate (likely a missing index).

**Cleanup:**

- Remove the old `ArchiveListingPage` test file if not removed in Phase 6
- Remove unused exports from `packages/web/src/components/archive-listing/` if any are now orphaned (the `ArchiveRow` etc. are still used by the home page; check carefully)
- Update `packages/web/CLAUDE.md` to reflect: `/` is now `HomePage` (not `ArchiveListingPage`), new pages, new components
- Update `packages/api/CLAUDE.md` to reflect: new `/api/home`, `/api/must-read`, `/api/admin/must-read/*` routes
- Update the root `CLAUDE.md` "Routing" section to describe the new home structure briefly

**Traces to:** REQ-027, REQ-029, REQ-030, REQ-031, NF-001, EDGE-004, EDGE-006, plus all REQs verified manually via Chrome MCP

**Commit:** `test(web): add Playwright e2e for admin must-read; update CLAUDE.md docs`

## Done When

- [ ] Playwright config in place; three e2e tests passing
- [ ] All manual UI checks complete with screenshots captured
- [ ] NF-001 latency check passed (within 100ms of baseline)
- [ ] Full quality gate (typecheck + lint + all tests + build) green
- [ ] CLAUDE.md files updated
- [ ] `git status` clean apart from the feature changes; ready for PR

## E2E Verification

- **Infrastructure needed:** PostgreSQL + Redis via `pnpm infra:up`; the API dev server (`pnpm --filter @newsletter/api dev`); the Vite dev server (`pnpm --filter @newsletter/web dev`)
- **E2E tests to run:** `pnpm --filter @newsletter/web test:e2e` and `pnpm --filter @newsletter/api test:e2e`
- **Browser verification:** visit `/`, `/must-read`, `/built`, `/admin/must-read`, `/admin/must-read/new` at desktop (1440) and mobile (375) widths; screenshot each
