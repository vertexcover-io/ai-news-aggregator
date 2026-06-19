# Plan / Implementation map — Multi-Tenant Chrome Extension

Built on branch `feature/extension-multitenant` (off `feature/multi-tenant`),
in an isolated worktree. PR targets `feature/multi-tenant`.

## Changes by package

### shared
- `src/db/schema.ts` — add `"manual"` to the `SourceType` union (text column →
  no migration).
- `src/constants/sources.ts`, `src/services/summary-source.ts`,
  `src/services/source-identifier.ts` — exhaustive maps/switches gain `manual`.

### api
- `src/auth/extension-token.ts` — `issueExtensionToken` / `verifyExtensionToken`
  (base64url JSON body + `ext|`-domain-separated HMAC; 30d expiry).
- `src/auth/extension-middleware.ts` — `requireExtensionAuth` → sets `tenantCtx`.
- `src/lib/validate.ts` — `extensionLoginSchema {email,password}`, `submitUrlSchema`.
- `src/services/user-submissions.ts` — `createUserSubmission` (canonical dedupe,
  title fallback, single tenant-stamped `manual` upsert via the scoped repo).
- `src/routes/extension.ts` — `/login` (tenant_admin → token, super_admin → 403)
  and `/submissions` (bearer-gated, builds tenant-scoped repos); CORS scoped to
  `chrome-extension://`. Default factory wires the pipeline repo + `canonicalizeUrl`.
- `src/app.ts` + `src/index.ts` — mount `/api/extension` ungated (own bearer auth).

### pipeline
- `src/add-post-entry.ts` — export `canonicalizeUrl` (consumed by the api route).

### web
- `src/lib/sourceDisplay.ts` — `manual` label + badge class (exhaustive maps).

### extension (ported from `origin/main`, then adapted)
- `src/lib/api.ts` — `login(email, password)`; `SubmitResponse` shape.
- `src/popup/LoginView.tsx` — email + password fields; `403 select_tenant` message.
- (AddView already auto-fills the tab title — used as the submission title.)
- Manifest already `AgentLoop Collector` with deterministic id + `build:prod`.

## Tests
- api unit: `extension-token`, `extension-middleware`, `user-submissions`,
  `extension-route` (login 200/401/403/400, bearer gating, tenant scope, CORS).
- extension unit: `api.test.ts` (email login + 403), `storage.test.ts`.
- extension e2e (real browser, hermetic PG+Redis): login, tenant-stamped row,
  per-tenant dedupe, **cross-tenant isolation**, stale-token 401, deterministic id.
  Two tenants seeded via the signup API. `run-e2e.mjs` env gains a dummy
  `RESEND_API_KEY` (the API constructs an email provider at boot).
