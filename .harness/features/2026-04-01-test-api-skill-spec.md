# Skill Spec: /test-api

> Test Hono API endpoints by making real HTTP requests and validating responses. Helps verify that routes work correctly after implementation or modification.

---

## What problem does this solve?

The API package (`@newsletter/api`) exposes REST endpoints for the frontend — review dashboard, admin settings, digest assembly, job triggering, etc. After implementing or modifying a route, you need to verify:

- Does the endpoint return the expected status code?
- Is the response body shaped correctly?
- Does auth middleware block unauthenticated requests?
- Do validation rules reject bad input?
- Does the endpoint actually talk to the database / enqueue jobs correctly?

Without this skill, testing means manually writing `curl` commands, remembering auth headers, and eyeballing JSON responses. This skill makes it systematic.

---

## When should this skill trigger?

- User says "test the API", "test this endpoint", "verify the route", "check if the API works"
- User just finished implementing an API route and wants to verify it
- User says "hit the health endpoint", "test the review API", "check auth"
- User reports the frontend is getting errors from the backend

---

## What should it do?

### 1. Endpoint Discovery

Before testing, understand what's available:

- Read the route files in `packages/api/src/routes/` to discover all registered endpoints
- List them with their method, path, and whether they require auth
- This gives context for what can be tested

Example output:
```
Available endpoints:
  GET  /health          — no auth
  GET  /api/candidates  — auth required
  POST /api/review      — auth required
  GET  /api/digest/:date — no auth
  POST /api/pipeline/trigger — auth required
  GET  /api/settings    — auth required
  PUT  /api/settings    — auth required
```

### 2. Single Endpoint Test

Test a specific endpoint with:

- **Method** (GET, POST, PUT, DELETE)
- **URL path** (e.g., `/api/candidates`)
- **Request body** (for POST/PUT — as JSON)
- **Auth header** (automatically added if the endpoint requires auth, using password from `.env`)
- **Query params** (if applicable)

Show the result:
- **Status code** and whether it's expected (200, 201, 400, 401, 404, 500)
- **Response headers** (content-type, etc.)
- **Response body** (formatted JSON)
- **Response time** (in milliseconds)

Flag issues:
- 500 errors — show the error message, suggest checking server logs
- 401 on an auth-required route — confirm auth is configured correctly
- Unexpected response shape — compare against what the route handler should return

### 3. Auth Testing

Specifically test the auth middleware:

- Hit an auth-required endpoint **without** the password — expect 401
- Hit it **with** the correct password — expect 200
- Hit a public endpoint **without** auth — expect 200 (not accidentally protected)

This catches misconfigured middleware that either blocks too much or too little.

### 4. Validation Testing

For endpoints that accept input (POST/PUT), test edge cases:

- Send a valid payload — expect success
- Send an empty body — expect 400 with validation error
- Send a payload with missing required fields — expect 400
- Send a payload with wrong types — expect 400

The skill should read the route handler's validation schema (Hono's validator) to know what fields are expected, then generate these test cases automatically.

### 5. Full API Smoke Test

Run all discovered endpoints in sequence:

- Hit every GET endpoint (no body needed)
- For POST/PUT endpoints, use sensible test payloads based on the validation schema
- Report a pass/fail summary

```
API Smoke Test Results:
  GET  /health             — 200 OK (12ms)
  GET  /api/candidates     — 200 OK (45ms)
  POST /api/review         — 200 OK (89ms)
  GET  /api/digest/2026-04-01 — 200 OK (34ms)
  POST /api/pipeline/trigger  — 200 OK (23ms)
  GET  /api/settings       — 200 OK (18ms)

6/6 passed
```

### 6. Response Type Validation

If TypeScript response types are defined in `@newsletter/shared`, validate that the actual JSON response matches the expected type shape. Flag any mismatches:

- Missing fields
- Extra unexpected fields
- Wrong types (string where number expected, etc.)

---

## Input

- `/test-api` — discover all endpoints, run full smoke test
- `/test-api <endpoint>` — test a specific endpoint (e.g., `/test-api /api/candidates`)
- `/test-api auth` — run auth-specific tests on all protected routes
- `/test-api validate <endpoint>` — run validation edge case tests on a specific endpoint

---

## Prerequisites

- The API server must be running (`pnpm dev` in the api package, or `pnpm dev` from root)
- The database must be up (`pnpm infra:up`)
- The skill should check these and warn if the server isn't reachable before running tests

---

## How it works under the hood

- Read route files to discover endpoints and their configuration
- Read `.env` for the auth password and API port
- Use `fetch` (via Bash with `curl`) or the Hono test client to make HTTP requests
- Parse and format responses
- Compare response shapes against shared types if available

---

## Output format

- Tables for smoke test summaries
- Formatted JSON for response bodies (truncate large responses, show first 20 lines)
- Color-code: green for passing, red for failures, yellow for warnings
- Always show response time to catch slow endpoints
- For failures, show both the expected and actual result side by side
