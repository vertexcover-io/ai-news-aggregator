# Phase 4: Admin API — must-read CRUD + preview

> **Status:** pending

## Overview

Five admin-gated endpoints: paste-URL preview (read-only), create, list, partial update, delete. Mounted under `/api/admin/must-read/*`.

## Implementation

**Files:**

- Create: `packages/api/src/routes/admin-must-read.ts`
  - `POST /preview` — body `{ url }`, calls shared `fetchPageStatic` + `extractPageMetadata`
  - `POST /` — create
  - `GET /` — admin list (includes `updatedAt`)
  - `PATCH /:id` — partial update
  - `DELETE /:id` — delete
- Create: `packages/api/src/lib/validate-must-read.ts` — zod schemas for the bodies
- Modify: `packages/api/src/app.ts` — mount under `/api/admin/must-read` inside the admin gate
- Modify: `packages/api/src/index.ts` — wire deps
- Create: `packages/api/tests/e2e/admin-must-read.test.ts`

**Tests (REQ traceability):**

- **REQ-020:** valid public URL preview → 200 `{ status: "extracted", suggested: {...} }`
- **REQ-021 / EDGE-004:** unreachable URL preview → 200 `{ status: "extraction_failed", error: <string> }`
- **REQ-022:** before/after preview call, row count of `must_read_entries` unchanged
- **REQ-023:** valid POST `/` → 201 with full `MustReadEntry`; row count +1
- **REQ-024 / EDGE-006:** POST `/` with duplicate URL → 409 `{ error: "duplicate_url", existingId }`; row count unchanged
- **REQ-025:** GET `/` returns full rows including `updatedAt`
- **REQ-026 / EDGE-009:** PATCH `/:id` updates fields; `addedAt` unchanged; `updatedAt` strictly greater than before
- **REQ-027:** DELETE `/:id` → 204; subsequent GET `/` does not contain the row
- **NF-002:** mocked slow fetch (>15s) → preview returns `{ status: "extraction_failed", error: "timeout" }`
- **NF-008 / EDGE-010:** POST `/preview` with `http://10.0.0.1/` → 200 `{ status: "extraction_failed", error: "<SSRF message>" }`, NO outbound fetch performed (assert via mocked fetch call counter)
- **NF-006:** verify the admin session cookie set on `/api/admin/login` has `SameSite=Lax` in the `Set-Cookie` header (this asserts existing behavior — write the test, fail loudly if the cookie is somehow `None`)
- **EDGE-008:** abort the request mid-extraction → server-side no row created; subsequent GET `/` empty (use AbortController on the test client)

**Pattern to follow:** `packages/api/src/routes/admin-runs.ts` for admin route shape; `packages/api/tests/e2e/admin-runs.test.ts` for the test harness.

**Traces to:** REQ-020, REQ-021, REQ-022, REQ-023, REQ-024, REQ-025, REQ-026, REQ-027, NF-002, NF-006, NF-007, NF-008, EDGE-004, EDGE-006, EDGE-008, EDGE-009, EDGE-010

**What to build (preview endpoint):**

```ts
adminMustRead.post("/preview", zValidator("json", PreviewSchema), async (c) => {
  const { url } = c.req.valid("json");
  const fetched = await fetchPageStatic(url, { timeoutMs: 15_000 });
  if ("error" in fetched) {
    return c.json({ status: "extraction_failed", error: fetched.error }, 200);
  }
  const meta = extractPageMetadata(fetched.html, fetched.finalUrl);
  if (!meta.title) {
    return c.json({ status: "extraction_failed", error: "no_title" }, 200);
  }
  return c.json({
    status: "extracted",
    suggested: { title: meta.title, author: meta.author, year: meta.year },
  }, 200);
});
```

**Create endpoint** uses `repo.findByUrl(url)` first → 409 if present; otherwise `repo.create()`.

**NF-007 note:** the existing `isPrivateOrLoopbackHost` already blocks `10.0.0.0/8` and `172.16.0.0/12`. Phase 1 already moved it to shared. The unit test for that lives in Phase 1; the integration test that the preview endpoint *uses* it lives here (NF-008).

**Commit:** `feat(api): admin must-read CRUD + URL preview endpoint`

## Done When

- [ ] All five endpoints reachable; unauthenticated calls return 401
- [ ] All listed REQs/NFs/EDGEs covered by passing e2e tests
- [ ] `pnpm --filter @newsletter/api test:e2e` green
- [ ] `pnpm typecheck` green
- [ ] `pnpm lint` green
