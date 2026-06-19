# Design — Multi-Tenant Chrome Extension

## Problem

The Chrome extension built on `main` (#289/#290) is single-tenant on three
counts: login checks one global `ADMIN_PASSWORD`; the `ext|<ts>` token carries no
identity; the submission inserts a `raw_items` row with no `tenant_id`. On the
multi-tenant schema such a row would be tenant-less (the column is nullable) and
never reach any tenant's run. The package also does not exist on
`feature/multi-tenant` (the branch forked before #289 landed).

## Goal

Port the feature and make it seamlessly multi-tenant by reusing the branch's
existing per-user/per-tenant auth — not inventing a parallel one.

## Key decisions

- **D1 — Token carries identity, namespaced.** The extension bearer token has the
  same body as the session cookie (`{userId, tenantId, role, issuedAt}`) but the
  HMAC is computed over `"ext|" + body`. This makes the two token kinds disjoint:
  a session token fails `verifyExtensionToken` and an ext token fails
  `verifyToken`. Rationale: a leaked extension token must not be replayable as a
  full admin web session (blast-radius containment), preserving the original
  design's isolation intent while upgrading to a tenant-aware payload.

- **D2 — `requireExtensionAuth` sets `tenantCtx`.** The middleware mirrors
  `requireAuth`: it verifies the bearer and does `c.set("tenantCtx", payload)`.
  This is the whole bridge — every downstream repo built from
  `tenantScopeFromContext(c)` is then tenant-correct with no further work.

- **D3 — v1 is tenant_admin only.** A `tenant_admin` has a concrete `tenantId`,
  so the flow is seamless (implicit tenant, zero picking). A `super_admin`
  (tenantId = null) has no implicit tenant; login returns `403 select_tenant`.
  Deferring the in-popup tenant picker keeps the PR focused; super_admins use the
  web app / impersonation for now.

- **D4 — Single `manual` write, reuse the tenant-aware pipeline repo.** The
  pipeline `raw_items` repo already stamps `tenant_id` (`scopedTenantId(ctx)`) and
  dedupes on `(tenant_id, source_type, external_id)`. The submission service
  builds one `RawItemInsert` with `sourceType: "manual"` and calls
  `upsertItems` + `findBySourceAndExternalId` on that scoped repo. No new DB code,
  no double-write. (On `main` the flow wrote two rows; this is cleaner.)

- **D5 — Light enrichment.** The extension sends the page's own `<title>`, so
  server-side enrichment is a no-op by default (injectable for the future).
  Richer content/recap is produced by the pipeline's normal rank stage during the
  next run, exactly as for collected items. Avoids LLM cost + a duplicate row at
  submit time.

## Flow

```
popup ──POST /api/extension/login {email,password}──► login() → user
        ◄── {token: ext|{userId,tenantId,role}, user} ── (403 select_tenant if super_admin)
popup ──POST /api/extension/submissions  Bearer ext|…  {url,title}──►
        requireExtensionAuth → c.set(tenantCtx)
        → createUserSubmission(scoped repo): canonicalize → per-tenant dedupe
          → upsert manual row stamped tenant_id
        → next run for THAT tenant ranks it
```

## Alternatives rejected

- **Reuse the session cookie token as a bearer** — least code, but a leaked token
  equals a full admin session. Rejected (see D1).
- **Add write methods to the API raw-items repo** — viable, but duplicates the
  tenant-stamping logic the pipeline repo already has correctly. Rejected (D4).
- **Resolve tenant from the Host** — forbidden for app-host requests (REQ-020);
  the extension is an app-host client, so tenant must come from the token.
