---
title: "Every API route file must be imported and mounted in app.ts before it works"
date: 2026-06-10
category: integration
tags: [api, routes, wiring, app.ts, Hono, integration]
component: api
severity: high
status: documented
applies_to: ["packages/api/src/app.ts", "packages/api/src/index.ts", "packages/api/src/routes/**"]
stage: [code, review, verify]
evidence_count: 1
last_validated: 2026-06-10
source: verify-break@multi-tenant
related: []
---

# Every API route file must be imported and mounted in app.ts

## Problem

A well-written and fully tested `createAuthRouter` (signup, login, forgot-password, reset, logout, me) existed in `packages/api/src/routes/auth.ts` but was never imported into `packages/api/src/index.ts` nor mounted in `packages/api/src/app.ts`. All `/api/auth/*` routes returned 404. The web frontend (`AdminLoginPage.tsx`) called `/api/auth/login` which did not exist, breaking all login and signup flows.

## Insight

**Writing a route file is only half the job. Without explicit import + wiring into the app builder, the route is dead code.** In Hono-based backends, each new route module needs: (1) a field in the `BuildAppDeps` interface in `app.ts`, (2) an import and instantiation in `index.ts` with its real dependencies, and (3) the constructor call passed through `buildApp({...})`. Missing any of these three steps produces a silent 404 with no build or test failure to catch it.

Two compounding factors made this especially dangerous:
- The new auth routes coexisted alongside a legacy `/api/admin/login` route (old `ADMIN_PASSWORD` flow), so the server still started and status checks passed.
- The phase-level test suite tested `createAuthRouter` in isolation but never verified the full server mount.

## Solution

Wire the auth router into the app builder (three changes needed):

1. **Add to `BuildAppDeps` in `app.ts`**: Add `authRouter: Hono` to the interface.
2. **Import and instantiate in `index.ts`**: `import { createAuthRouter } from "@api/routes/auth.js"` and create it with deps.
3. **Mount in `app.ts`**: Call `app.route("/api/auth", deps.authRouter)` before the adminApp.

## Prevention

- After adding a new route file, grep `git diff` for `create.*Router` and verify each one is imported + passed to `buildApp({...})`.
- Run `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/<prefix>/<endpoint>` for each new route after server start. A 404 on a newly added route is a sign of missing wiring.
- In the `post-tdd` quality gate, verify that `createXRouter` calls in new/changed files each have a corresponding mounting line in `app.ts` or `index.ts`.
