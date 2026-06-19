# Chrome Extension — Multi-Tenant URL Collector

Ports the single-tenant Chrome extension (`main` PRs #289/#290) onto
`feature/multi-tenant` and makes it **seamlessly multi-tenant**: a logged-in
operator adds the current tab's URL and it becomes a ranked candidate in **their
tenant's** next newsletter run.

## The core idea

The multi-tenant system already keys everything off `tenantCtx.tenantId` (repos
stamp `tenant_id`; the candidate query is tenant-fenced; the `raw_items` dedupe
key is `(tenantId, sourceType, externalId)`). So the only thing this change has
to make true is: **the extension's bearer token carries the same
`{userId, tenantId, role}` identity the session cookie does.** Once it does,
ingestion and the pipeline are tenant-correct with zero pipeline changes.

## What shipped

- **Auth** — `POST /api/extension/login` takes **email + password** (reuses the
  existing `login()` service). It issues an `ext|`-namespaced HMAC bearer token
  embedding `{userId, tenantId, role}`. The namespace domain-separates it from
  the `admin_session` cookie token (neither can be replayed as the other).
  `requireExtensionAuth` verifies it and lifts the identity onto `tenantCtx`.
- **v1 scope** — **tenant_admin only**. A super_admin (tenantId = null) login is
  declined with `403 select_tenant` ("choose a tenant in the web app").
- **Ingestion** — `POST /api/extension/submissions` writes one `manual`
  `raw_items` row via the tenant-scoped pipeline repo (stamps `tenant_id`,
  dedupes per-tenant). The page title is the submitted title; richer content is
  left to the pipeline's normal rank stage.
- **Extension** — MV3 popup ported; login is now email+password; `403` shows the
  "use the web app" message. Deterministic id + prod build retained.

## Files

Design / spec / plan / verification in this directory. Implementation across
`packages/{shared,api,pipeline,extension,web}` — see `plan.md` for the map.

## PR

Targets **`feature/multi-tenant`** (not `main`). _PR link added on open._
