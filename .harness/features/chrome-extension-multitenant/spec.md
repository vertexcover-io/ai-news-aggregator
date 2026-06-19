# Spec — Multi-Tenant Chrome Extension

## Requirements (EARS)

- **REQ-01** When the extension `POST /api/extension/login` receives valid
  credentials for a **tenant_admin**, the system shall return an `ext|` bearer
  token embedding `{userId, tenantId, role}` and `200`.
- **REQ-02** When login credentials are unknown or the password is wrong, the
  system shall return `401 invalid_credentials`.
- **REQ-03** When a **super_admin** (tenantId = null) logs in, the system shall
  return `403 select_tenant` and issue no token (v1 scope).
- **REQ-04** The extension token's HMAC shall be domain-separated (`ext|`) so a
  session cookie token never verifies as an extension token, and vice versa.
- **REQ-05** `requireExtensionAuth` shall verify the bearer token and set
  `tenantCtx = {userId, tenantId, role}`; a missing/invalid/expired token shall
  yield `401`.
- **REQ-06** When `POST /api/extension/submissions` is called with a valid token,
  the system shall write exactly one `raw_items` row with `source_type = 'manual'`
  stamped with the token's `tenant_id`.
- **REQ-07** Submission dedupe shall be **per tenant**: the same canonical URL
  re-submitted by the same tenant reports `alreadyExisted = true` and adds no row;
  a different tenant submitting the same URL gets its own row.
- **REQ-08** The submitted URL shall be canonicalized (tracking params stripped)
  before hashing to the dedupe `external_id`.
- **REQ-09** The next pipeline run for the tenant shall pick up the `manual` row
  as a candidate automatically (no pipeline change).
- **REQ-10** The extension popup shall log in with email + password and, on
  `403 select_tenant`, show a "use the web app" message.

## Edge cases

- **EDGE-01** Enrichment failure → fall back to the page title, then the URL; the
  row is still written.
- **EDGE-02** Expired token (>30d) → `verifyExtensionToken` returns null → `401`.
- **EDGE-03** Tampered token (flipped MAC / mutated body) → `401`.
- **EDGE-04** Stale token in the popup → submission `401` → token cleared → login
  view.
- **EDGE-05** CORS: only `chrome-extension://` origins are allowed on
  `/api/extension/*`.

## Verification matrix

| Req | Verified by |
|-----|-------------|
| REQ-01/02/03/10 | unit `extension-route.test.ts`; e2e login flow |
| REQ-04 | unit `extension-token.test.ts` (both-direction isolation) |
| REQ-05, EDGE-02/03 | unit `extension-token.test.ts`, `extension-middleware.test.ts` |
| REQ-06/08 | unit `user-submissions.test.ts`; e2e tenant-stamped row |
| REQ-07 | unit `user-submissions.test.ts`; **e2e cross-tenant isolation** |
| REQ-09 | candidate query already tenant-fenced (`candidates.findSince`) |
| EDGE-01 | unit `user-submissions.test.ts` (enrichment-failure case) |
| EDGE-04 | e2e stale-token returns to login |
| EDGE-05 | unit `extension-route.test.ts` (CORS preflight) |
