---
title: "Platform-level secrets belong in app_credentials, not social_credentials"
date: 2026-06-18
category: architecture
tags: [multi-tenant, super-admin, app-credentials, social-credentials, platform-secret, encryption]
component: packages/shared/src/db/schema.ts
severity: design
status: implemented
applies_to: ["packages/shared/src/db/schema.ts", "packages/api/src/routes/super-app-credentials.ts", "packages/pipeline/src/repositories/app-credentials.ts"]
stage: [plan, code]
evidence_count: 1
last_validated: 2026-06-18
source: apify-integration@reddit-collector-apify
related: [".harness/knowledge/lessons/architecture/db-first-credential-resolver-pattern-20260618.md"]
---

# Platform-level secrets belong in app_credentials, not social_credentials

## Insight

**The codebase has two credential tables with different ownership models; choosing the wrong one breaks the multi-tenant security boundary.**

| Table | Owner | Scope | Set by | Examples |
|---|---|---|---|---|
| `social_credentials` | Per-tenant | `(tenant_id, platform)` unique | Tenant admin via `/admin/settings` | Twitter OAuth tokens, LinkedIn access token |
| `app_credentials` | Platform-wide | `key TEXT PRIMARY KEY` (no tenant_id) | Super-admin via `/api/super/app-credentials` | Apify API token, LinkedIn OAuth client ID/secret, Rettiwt cookie |

A secret is platform-level when:
- It is shared by every tenant (one API key serves all runs).
- Exposing it to tenant admins would be a privilege escalation.
- It is set once by the operator, not per-tenant-onboarding.

## Solution

To add a new platform-level secret:

1. **Schema** — add a literal to `AppCredentialKey` in `packages/shared/src/db/schema.ts`:
   ```typescript
   // file: packages/shared/src/db/schema.ts
   export type AppCredentialKey =
     | "linkedin_client"
     | "twitter_collector"
     | "twitter_client"
     | "apify_api_token"   // ← new entry
   ```

2. **Repository** — add `get<Platform>()` to `AppCredentialsRepo` in `packages/pipeline/src/repositories/app-credentials.ts`. It must call `decryptFields` — never return raw JSONB to the caller.

3. **API route** — add to `packages/api/src/routes/super-app-credentials.ts`:
   - `PUT /api/super/app-credentials/<key>` — validate body, encrypt, upsert row.
   - `DELETE /api/super/app-credentials/<key>` — delete row.
   - `GET /api/super/app-credentials` returns status booleans only (`configured: boolean`) — never the token value.
   - All three routes behind `requireSuperAdmin(secret)` from `packages/api/src/auth/middleware.ts`.

4. **Resolver** — follow the DB-first resolver pattern (see related lesson).

5. **Web panel** — show the panel only when `role === "super_admin"`. Use `configured` boolean from `GET /api/super/app-credentials` to render a "key set" indicator; never fetch or display the raw token.

## Prevention / Reuse

- Before storing a new secret, ask: "Can a tenant admin see this?" If yes → `social_credentials` + tenant-scoped routes. If no → `app_credentials` + `requireSuperAdmin`.
- The `AppCredentialKey` union is the canonical list of platform secrets. Adding a key without adding it to the union will fail TypeScript at compile time.
- `GET /api/super/app-credentials` deliberately returns `{ configured: boolean }` only. Never add a field that returns the raw secret or even a partial value — the token is write-only from the UI's perspective.
- A super-admin navigating to `/admin/settings` will be redirected to `/admin/tenants` by `RequireOnboarding`. To verify the Apify panel in a browser, the super-admin must first impersonate a tenant via "Open →", then navigate to `/admin/settings`.

## Related

- `.harness/knowledge/lessons/architecture/db-first-credential-resolver-pattern-20260618.md` — how to resolve the credential at pipeline time
- `packages/api/src/auth/middleware.ts` — `requireSuperAdmin` implementation
- `packages/shared/src/db/schema.ts` — `AppCredentialKey` union + `app_credentials` table definition
